use crate::{auth, config::Config, tmux, webutil, AppState};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, PtySize};
use serde::Deserialize;
use std::io::{Read, Write};
use std::net::SocketAddr;
use tokio::sync::mpsc;

#[derive(Deserialize)]
pub struct TermQuery {
    name: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

// Live interactive terminal: a WebSocket bridged to a PTY that runs `tmux attach-session -t <name>`,
// so the browser gets the real session (agent TUI included), not the send-keys preview.
pub async fn term_ws(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    Query(q): Query<TermQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    let remote = connect.0.ip().to_string();
    if !auth::network_allowed(&state.config, &headers, Some(&remote))
        || !auth::authenticated(&state.config, &headers, Some(&remote))
    {
        return webutil::json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({ "error": "Forbidden" }),
        );
    }
    if !auth::unlocked(&state.config, &headers) {
        return webutil::json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({ "error": "Shell unlock required" }),
        );
    }
    // Cross-site WebSocket hijacking guard: the WS handshake can't carry the X-Codex-Action
    // CSRF header, so a malicious cross-origin page could otherwise drive this PTY using the
    // victim's cookies. Reject when a browser Origin is present and doesn't match the host.
    if let Some(reason) = blocked_origin(&state.config, &headers) {
        return webutil::json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({ "error": reason }),
        );
    }
    if !tmux::session_names().await.contains(&q.name) {
        return webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": "Session is not running" }),
        );
    }
    // A window in tmux has one size shared by all clients. "latest" sizes it to whichever client
    // is actively used, so the browser terminal only affects the session while it's focused and
    // hands the size back to your other client (RDP/SSH) when this terminal closes.
    tmux::set_window_size_latest().await;
    let name = q.name.clone();
    let cols = q.cols.unwrap_or(120).clamp(20, 400);
    let rows = q.rows.unwrap_or(34).clamp(6, 200);
    ws.on_upgrade(move |socket| handle_term(socket, name, cols, rows))
}

// Cross-site WebSocket hijacking guard on a shell-granting socket — DEFAULT CLOSED.
// A missing Origin (native/non-browser clients, which can't be driven cross-site by a
// browser) is allowed; a present Origin must match the request Host or an entry in
// DASHBOARD_ALLOWED_ORIGINS, else it is refused.
//
// NB: a reverse proxy that REWRITES the Host header (e.g. cloudflared
// `httpHostHeader: 127.0.0.1`) makes the browser Origin never match the Host the app sees, so
// such deployments MUST set DASHBOARD_ALLOWED_ORIGINS to the public hostname — otherwise the
// browser terminal cannot connect. We deliberately do NOT trust X-Forwarded-Host (a client
// can spoof it where the proxy doesn't strip it) and do NOT fail open on missing config:
// inferring trust from absent configuration on an RCE-class sink is unsafe.
fn blocked_origin(config: &Config, headers: &HeaderMap) -> Option<String> {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok())?;
    let origin_host = origin
        .split_once("://")
        .map(|(_, rest)| rest.split('/').next().unwrap_or(rest))
        .unwrap_or(origin);
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(',').next().unwrap_or(v).trim())
        .unwrap_or_default();
    if !host.is_empty() && origin_host.eq_ignore_ascii_case(host) {
        return None;
    }
    if config.allowed_origins.iter().any(|allowed| {
        allowed.eq_ignore_ascii_case(origin_host) || allowed.eq_ignore_ascii_case(origin)
    }) {
        return None;
    }
    Some(
        "Cross-origin WebSocket blocked (set DASHBOARD_ALLOWED_ORIGINS to the public host)"
            .to_string(),
    )
}

async fn handle_term(socket: WebSocket, name: String, cols: u16, rows: u16) {
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let Ok(pair) = native_pty_system().openpty(size) else {
        return;
    };
    let mut cmd = tmux::tmux_pty_command(&["attach-session", "-t", &name]);
    cmd.env("TERM", "xterm-256color");
    cmd.env("SHELLDECK_TERM", "1");
    cmd.env("TERM_PROGRAM", "ShellDeck");
    let Ok(mut child) = pair.slave.spawn_command(cmd) else {
        return;
    };
    drop(pair.slave);
    let Ok(mut reader) = pair.master.try_clone_reader() else {
        return;
    };
    let Ok(mut writer) = pair.master.take_writer() else {
        return;
    };
    let master = pair.master;

    // PTY output -> channel -> websocket
    let (out_tx, mut out_rx) = mpsc::channel::<Vec<u8>>(256);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // websocket input -> channel -> PTY
    let (in_tx, mut in_rx) = mpsc::channel::<Vec<u8>>(256);
    std::thread::spawn(move || {
        while let Some(bytes) = in_rx.blocking_recv() {
            if writer.write_all(&bytes).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });

    let (mut ws_tx, mut ws_rx) = socket.split();
    let pump = tokio::spawn(async move {
        while let Some(chunk) = out_rx.recv().await {
            if ws_tx.send(Message::Binary(chunk.into())).await.is_err() {
                break;
            }
        }
        let _ = ws_tx.close().await;
    });

    while let Some(Ok(msg)) = ws_rx.next().await {
        match msg {
            Message::Binary(b) => {
                if in_tx.send(b.to_vec()).await.is_err() {
                    break;
                }
            }
            Message::Text(t) => {
                // a JSON {"cols":N,"rows":M} message is a resize; anything else is typed input
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if let (Some(c), Some(r)) = (v["cols"].as_u64(), v["rows"].as_u64()) {
                        let _ = master.resize(PtySize {
                            rows: r as u16,
                            cols: c as u16,
                            pixel_width: 0,
                            pixel_height: 0,
                        });
                        continue;
                    }
                }
                if in_tx.send(t.as_bytes().to_vec()).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    let _ = child.kill();
    pump.abort();
}
