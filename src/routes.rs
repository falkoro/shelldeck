use crate::{auth, pages, stream, summary, term, tmux, uploads, webutil, AppState};
use axum::{extract::{ConnectInfo, Path, Query, State}, http::{HeaderMap, StatusCode}, response::Response, routing::{get, post}, Router};
use serde::Deserialize;
use std::{net::SocketAddr, path::PathBuf};

#[derive(Deserialize)]
struct UnlockBody { password: String }

#[derive(Deserialize)]
struct InputBody { name: String, text: String, submit: Option<bool> }

#[derive(Deserialize)]
struct KeyBody { name: String, key: String }

#[derive(Deserialize)]
struct NameBody { name: String }

#[derive(Deserialize)]
struct LinesQuery { lines: Option<u32> }

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/", get(root))
        .route("/healthz", get(health))
        .route("/login", get(login).post(login_post))
        .route("/logout", get(logout))
        .route("/manifest.webmanifest", get(manifest))
        .route("/icon.svg", get(icon))
        .route("/assets/{file}", get(asset))
        .route("/uploads/{file}", get(upload))
        .route("/api/sessions", get(api_sessions))
        .route("/api/unlock", post(api_unlock))
        .route("/api/summary", get(api_summary))
        .route("/api/shells", get(api_shells))
        .route("/api/agents", get(api_agents))
        .route("/api/shells/stream", get(stream::api_shell_stream))
        .route("/api/term", get(term::term_ws))
        .route("/api/input", post(api_input))
        .route("/api/key", post(api_key))
        .route("/api/upload-image", post(api_upload))
        .route("/api/start", post(api_start))
        .route("/api/restart", post(api_restart))
        .with_state(state)
}

async fn health() -> Response { webutil::json_response(StatusCode::OK, &serde_json::json!({ "ok": true })) }

fn remote(addr: &ConnectInfo<SocketAddr>) -> String { addr.0.ip().to_string() }

fn allowed(state: &AppState, headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> bool { auth::network_allowed(&state.config, headers, Some(&remote(addr))) }

fn signed_in(state: &AppState, headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> bool { auth::authenticated(&state.config, headers, Some(&remote(addr))) }

fn guard(state: &AppState, headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> Option<Response> {
    if !allowed(state, headers, addr) {
        return Some(webutil::html_response(StatusCode::FORBIDDEN, pages::blocked()));
    }
    if !signed_in(state, headers, addr) {
        return Some(webutil::redirect("/login"));
    }
    None
}

fn require_action(headers: &HeaderMap) -> Result<(), Response> {
    if headers.get("x-codex-action").and_then(|v| v.to_str().ok()) == Some("1") {
        Ok(())
    } else {
        Err(webutil::json_response(StatusCode::FORBIDDEN, &serde_json::json!({ "error": "Missing action header" })))
    }
}

fn require_unlock(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    if auth::unlocked(&state.config, headers) {
        Ok(())
    } else {
        Err(webutil::json_response(StatusCode::FORBIDDEN, &serde_json::json!({ "error": "Shell unlock required" })))
    }
}

async fn login(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>) -> Response {
    if !allowed(&state, &headers, &connect) {
        return webutil::html_response(StatusCode::FORBIDDEN, pages::blocked());
    }
    webutil::html_response(StatusCode::OK, pages::login(&state.config, ""))
}

async fn login_post(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, body: String) -> Response {
    if !allowed(&state, &headers, &connect) {
        return webutil::html_response(StatusCode::FORBIDDEN, pages::blocked());
    }
    let username = webutil::form_value(&body, "username");
    let password = webutil::form_value(&body, "password");
    if username == state.config.user && password == state.config.password {
        let mut response = webutil::redirect("/");
        auth::set_login_cookie(&mut response, &state.config, &headers, &username);
        return response;
    }
    webutil::html_response(StatusCode::UNAUTHORIZED, pages::login(&state.config, "That login did not match."))
}

async fn logout() -> Response { auth::logout_response() }

async fn root(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    let model = tmux::session_model(state.config.clone(), auth::unlocked(&state.config, &headers)).await;
    webutil::html_response(StatusCode::OK, pages::dashboard(&model))
}

async fn manifest() -> Response { webutil::json_response(StatusCode::OK, &pages::manifest()) }

async fn icon() -> Response { webutil::text_response(StatusCode::OK, "image/svg+xml; charset=utf-8", pages::icon().as_bytes().to_vec()) }

async fn asset(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    let content_type = match file.rsplit_once('.').map(|(_, ext)| ext) {
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        _ => return webutil::json_response(StatusCode::NOT_FOUND, &serde_json::json!({ "error": "Not found" })),
    };
    let path = state.config.root_dir.join("public").join(PathBuf::from(&file).file_name().unwrap_or_default());
    match tokio::fs::read(path).await {
        Ok(bytes) => webutil::text_response(StatusCode::OK, content_type, bytes),
        Err(_) => webutil::json_response(StatusCode::NOT_FOUND, &serde_json::json!({ "error": "Not found" })),
    }
}

async fn upload(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, Path(file): Path<String>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    match uploads::load_image(state.config.clone(), &file).await {
        Ok((content_type, bytes)) => webutil::text_response(StatusCode::OK, Box::leak(content_type.into_boxed_str()), bytes),
        Err(response) => response,
    }
}

async fn api_sessions(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    let model = tmux::session_model(state.config.clone(), auth::unlocked(&state.config, &headers)).await;
    webutil::json_response(StatusCode::OK, &model)
}

async fn api_unlock(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, axum::Json(body): axum::Json<UnlockBody>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_action(&headers) {
        return response;
    }
    if body.password.to_lowercase().trim() != state.config.unlock_password.to_lowercase().trim() {
        return webutil::json_response(StatusCode::UNAUTHORIZED, &serde_json::json!({ "error": "Second password did not match" }));
    }
    let model = tmux::session_model(state.config.clone(), true).await;
    let shells = tmux::shell_previews(state.config.clone(), 80).await;
    let mut response = webutil::json_response(StatusCode::OK, &serde_json::json!({ "ok": true, "unlocked": true, "message": "Shells unlocked for 30 days", "model": model, "shells": shells["shells"], "shellsUpdatedAt": shells["now"] }));
    auth::set_unlock_cookie(&mut response, &state.config, &headers);
    response
}

async fn api_summary(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    webutil::json_response(StatusCode::OK, &summary::get(state.config.clone(), state.client.clone()).await)
}

async fn api_shells(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, Query(query): Query<LinesQuery>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    webutil::json_response(StatusCode::OK, &tmux::shell_previews(state.config.clone(), query.lines.unwrap_or(80)).await)
}

async fn api_agents(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    let url = format!("{}/api/agents", state.config.agents_url.trim_end_matches('/'));
    let mut payload = match state.client.get(&url).send().await {
        Ok(resp) => resp.json::<serde_json::Value>().await.unwrap_or_else(|_| serde_json::json!({ "agents": [] })),
        Err(error) => return webutil::json_response(StatusCode::OK, &serde_json::json!({ "agents": [], "error": error.to_string() })),
    };
    // Enrich each agent with the tmux session it runs in, matched by controlling tty.
    let tty_session: std::collections::HashMap<String, String> = tmux::list_panes().await.into_iter().filter(|p| !p.tty.is_empty()).map(|p| (p.tty, p.session)).collect();
    if let Some(agents) = payload.get_mut("agents").and_then(|v| v.as_array_mut()) {
        for agent in agents.iter_mut() {
            if let Some((tty, foreground)) = agent.get("pid").and_then(|v| v.as_u64()).and_then(agent_proc) {
                if let Some(session) = tty_session.get(&tty) {
                    agent["session"] = serde_json::json!(session);
                    agent["foreground"] = serde_json::json!(foreground);
                }
            }
        }
    }
    webutil::json_response(StatusCode::OK, &payload)
}

// From /proc/<pid>/stat: the controlling terminal ("/dev/pts/N") and whether the process is the
// terminal's *foreground* group (pgrp == tpgid) — i.e. the agent you're actually interacting with.
fn agent_proc(pid: u64) -> Option<(String, bool)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    let pgrp: i64 = fields.get(2)?.parse().ok()?;
    let tty_nr: i64 = fields.get(4)?.parse().ok()?;
    let tpgid: i64 = fields.get(5)?.parse().ok()?;
    if tty_nr == 0 {
        return None;
    }
    let major = (tty_nr >> 8) & 0xfff;
    let minor = (tty_nr & 0xff) | ((tty_nr >> 12) & 0xfff00);
    if major != 136 {
        return None;
    }
    Some((format!("/dev/pts/{minor}"), pgrp == tpgid))
}

async fn api_input(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, axum::Json(body): axum::Json<InputBody>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    match tmux::paste_text(state.config.clone(), &body.name, &body.text, body.submit.unwrap_or(true)).await {
        Ok(message) => webutil::json_response(StatusCode::OK, &serde_json::json!({ "ok": true, "message": message, "target": body.name })),
        Err(error) => webutil::json_response(StatusCode::BAD_REQUEST, &serde_json::json!({ "error": error })),
    }
}

async fn api_key(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, axum::Json(body): axum::Json<KeyBody>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    match tmux::send_key(&body.name, &body.key).await {
        Ok(message) => webutil::json_response(StatusCode::OK, &serde_json::json!({ "ok": true, "message": message, "target": body.name })),
        Err(error) => webutil::json_response(StatusCode::BAD_REQUEST, &serde_json::json!({ "error": error })),
    }
}

async fn api_upload(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, axum::Json(body): axum::Json<uploads::ImageUpload>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    match uploads::save_image(state.config.clone(), body).await {
        Ok(image) => webutil::json_response(StatusCode::OK, &serde_json::json!({ "ok": true, "image": image })),
        Err(error) => webutil::json_response(StatusCode::BAD_REQUEST, &serde_json::json!({ "error": error })),
    }
}

async fn api_start(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, axum::Json(body): axum::Json<NameBody>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    session_result(tmux::start_session(state.config.clone(), &body.name).await)
}

async fn api_restart(State(state): State<AppState>, headers: HeaderMap, connect: ConnectInfo<SocketAddr>, axum::Json(body): axum::Json<NameBody>) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    session_result(tmux::restart_session(state.config.clone(), &body.name).await)
}

fn session_result(result: Result<String, String>) -> Response {
    match result {
        Ok(message) => webutil::json_response(StatusCode::OK, &serde_json::json!({ "ok": true, "message": message })),
        Err(error) => webutil::json_response(StatusCode::BAD_REQUEST, &serde_json::json!({ "error": error })),
    }
}
