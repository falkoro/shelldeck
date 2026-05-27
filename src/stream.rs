use crate::{auth, tmux, webutil, AppState};
use axum::{
    extract::{ConnectInfo, Query, State},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use serde::Deserialize;
use std::{convert::Infallible, net::SocketAddr, time::Duration};

fn remote(addr: &ConnectInfo<SocketAddr>) -> String { addr.0.ip().to_string() }

fn allowed(state: &AppState, headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> bool {
    auth::network_allowed(&state.config, headers, Some(&remote(addr)))
}

fn signed_in(state: &AppState, headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> bool {
    auth::authenticated(&state.config, headers, Some(&remote(addr)))
}

#[derive(Deserialize)]
pub struct LinesQuery { lines: Option<u32> }

pub async fn api_shell_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    Query(query): Query<LinesQuery>,
) -> Response {
    if !allowed(&state, &headers, &connect) || !signed_in(&state, &headers, &connect) {
        return webutil::json_response(StatusCode::FORBIDDEN, &serde_json::json!({ "error": "Forbidden" }));
    }
    if !auth::unlocked(&state.config, &headers) {
        return webutil::json_response(StatusCode::FORBIDDEN, &serde_json::json!({ "error": "Shell unlock required" }));
    }
    let config = state.config.clone();
    let lines = tmux::clean_lines(query.lines.unwrap_or(80));
    let stream = async_stream::stream! {
        loop {
            let payload = tmux::shell_previews(config.clone(), lines).await;
            let data = serde_json::to_string(&payload).unwrap_or_else(|_| "{\"shells\":[]}".to_string());
            yield Ok::<Event, Infallible>(Event::default().event("shells").data(data));
            tokio::time::sleep(Duration::from_millis(1_200)).await;
        }
    };
    Sse::new(stream).keep_alive(KeepAlive::default()).into_response()
}
