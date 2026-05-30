use crate::{
    auth, config, containers, links, metrics, pages, remote, remote_hosts, settings, share, stream,
    summary, term, tmux, uploads, webutil, AppState,
};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use std::{net::SocketAddr, path::PathBuf};

#[derive(Deserialize)]
struct UnlockBody {
    password: String,
}

#[derive(Deserialize)]
struct InputBody {
    name: String,
    text: String,
    submit: Option<bool>,
}

#[derive(Deserialize)]
struct KeyBody {
    name: String,
    key: String,
}

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

#[derive(Deserialize)]
struct LinesQuery {
    lines: Option<u32>,
}

#[derive(Deserialize)]
struct LinksBody {
    links: Vec<links::QuickLink>,
}

#[derive(Deserialize)]
struct SettingsBody {
    tickers: Vec<String>,
    panels: settings::PanelSettings,
}

#[derive(Deserialize)]
struct RemoteHostsBody {
    hosts: Vec<config::RemoteHostConfig>,
}

pub fn router(state: AppState) -> Router {
    // Honor the configured image cap: base64 inflates ~4/3, so size the body limit to the
    // configured raw cap plus the base64 overhead (axum's 2 MiB default would otherwise
    // silently reject anything over ~1.5 MB raw, making DASHBOARD_MAX_IMAGE_BYTES a no-op).
    let upload_limit = state.config.max_image_bytes / 3 * 4 + 4096;
    let share_limit = 4 * 1024 * 1024 / 3 * 4 + 4096;
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
        .route("/api/metrics", get(api_metrics))
        .route("/api/containers", get(api_containers))
        .route("/api/remote-hosts", get(api_remote_hosts))
        .route(
            "/api/remote-hosts/config",
            get(api_remote_hosts_config).post(api_remote_hosts_save),
        )
        .route("/api/links", get(api_links).post(api_links_save))
        .route(
            "/api/ui-config",
            get(api_ui_config).post(api_ui_config_save),
        )
        .route("/api/tickers", get(api_tickers))
        .route(
            "/api/share-shot",
            post(api_share_shot).layer(DefaultBodyLimit::max(share_limit)),
        )
        .route("/api/shells/stream", get(stream::api_shell_stream))
        .route("/api/term", get(term::term_ws))
        .route("/api/input", post(api_input))
        .route("/api/key", post(api_key))
        .route(
            "/api/upload-image",
            post(api_upload).layer(DefaultBodyLimit::max(upload_limit)),
        )
        .route("/api/start", post(api_start))
        .route("/api/restart", post(api_restart))
        .with_state(state)
}

async fn health() -> Response {
    webutil::json_response(StatusCode::OK, &serde_json::json!({ "ok": true }))
}

fn remote(addr: &ConnectInfo<SocketAddr>) -> String {
    addr.0.ip().to_string()
}

fn allowed(state: &AppState, headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> bool {
    auth::network_allowed(&state.config, headers, Some(&remote(addr)))
}

fn signed_in(state: &AppState, headers: &HeaderMap, addr: &ConnectInfo<SocketAddr>) -> bool {
    auth::authenticated(&state.config, headers, Some(&remote(addr)))
}

fn guard(
    state: &AppState,
    headers: &HeaderMap,
    addr: &ConnectInfo<SocketAddr>,
) -> Option<Response> {
    if !allowed(state, headers, addr) {
        return Some(webutil::html_response(
            StatusCode::FORBIDDEN,
            pages::blocked(),
        ));
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
        Err(webutil::json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({ "error": "Missing action header" }),
        ))
    }
}

fn require_unlock(state: &AppState, headers: &HeaderMap) -> Result<(), Response> {
    if auth::unlocked(&state.config, headers) {
        Ok(())
    } else {
        Err(webutil::json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({ "error": "Shell unlock required" }),
        ))
    }
}

async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if !allowed(&state, &headers, &connect) {
        return webutil::html_response(StatusCode::FORBIDDEN, pages::blocked());
    }
    webutil::html_response(StatusCode::OK, pages::login(&state.config, ""))
}

async fn login_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    body: String,
) -> Response {
    if !allowed(&state, &headers, &connect) {
        return webutil::html_response(StatusCode::FORBIDDEN, pages::blocked());
    }
    let username = webutil::form_value(&body, "username");
    let password = webutil::form_value(&body, "password");
    if username == state.config.user
        && webutil::ct_eq(password.as_bytes(), state.config.password.as_bytes())
    {
        let mut response = webutil::redirect("/");
        auth::set_login_cookie(&mut response, &state.config, &headers, &username);
        return response;
    }
    webutil::html_response(
        StatusCode::UNAUTHORIZED,
        pages::login(&state.config, "That login did not match."),
    )
}

async fn logout() -> Response {
    auth::logout_response()
}

async fn root(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    let model = tmux::session_model(
        state.config.clone(),
        auth::unlocked(&state.config, &headers),
    )
    .await;
    webutil::html_response(StatusCode::OK, pages::dashboard(&model, &state.config))
}

async fn manifest() -> Response {
    webutil::json_response(StatusCode::OK, &pages::manifest())
}

async fn icon() -> Response {
    webutil::text_response(
        StatusCode::OK,
        "image/svg+xml; charset=utf-8",
        pages::icon().as_bytes().to_vec(),
    )
}

async fn asset(State(state): State<AppState>, Path(file): Path<String>) -> Response {
    let content_type = match file.rsplit_once('.').map(|(_, ext)| ext) {
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml; charset=utf-8",
        _ => {
            return webutil::json_response(
                StatusCode::NOT_FOUND,
                &serde_json::json!({ "error": "Not found" }),
            );
        }
    };
    let path = state
        .config
        .root_dir
        .join("public")
        .join(PathBuf::from(&file).file_name().unwrap_or_default());
    match tokio::fs::read(path).await {
        Ok(bytes) => webutil::text_response(StatusCode::OK, content_type, bytes),
        Err(_) => webutil::json_response(
            StatusCode::NOT_FOUND,
            &serde_json::json!({ "error": "Not found" }),
        ),
    }
}

async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    Path(file): Path<String>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    match uploads::load_image(state.config.clone(), &file).await {
        Ok((content_type, bytes)) => webutil::text_response(StatusCode::OK, content_type, bytes),
        Err(response) => response,
    }
}

async fn api_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    let model = tmux::session_model(
        state.config.clone(),
        auth::unlocked(&state.config, &headers),
    )
    .await;
    webutil::json_response(StatusCode::OK, &model)
}

async fn api_unlock(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<UnlockBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_action(&headers) {
        return response;
    }
    let given = body.password.to_lowercase();
    let want = state.config.unlock_password.to_lowercase();
    if !webutil::ct_eq(given.trim().as_bytes(), want.trim().as_bytes()) {
        return webutil::json_response(
            StatusCode::UNAUTHORIZED,
            &serde_json::json!({ "error": "Second password did not match" }),
        );
    }
    let model = tmux::session_model(state.config.clone(), true).await;
    let shells = tmux::shell_previews(state.config.clone(), 80).await;
    let mut response = webutil::json_response(
        StatusCode::OK,
        &serde_json::json!({ "ok": true, "unlocked": true, "message": "Shells unlocked for 30 days", "model": model, "shells": shells["shells"], "shellsUpdatedAt": shells["now"] }),
    );
    auth::set_unlock_cookie(&mut response, &state.config, &headers);
    response
}

async fn api_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    let fresh = summary::get(state.config.clone(), state.client.clone()).await;
    // Cache the last real (non-local) summary; if this turn fell back to `local` (a bridge blip),
    // serve the cached good one so per-shell titles stay meaningful.
    if fresh.provider.starts_with("local") {
        if let Some(cached) = state.summary_cache.lock().ok().and_then(|c| c.clone()) {
            return webutil::json_response(StatusCode::OK, &cached);
        }
    } else if let Ok(mut cache) = state.summary_cache.lock() {
        *cache = Some(fresh.clone());
    }
    webutil::json_response(StatusCode::OK, &fresh)
}

async fn api_shells(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    Query(query): Query<LinesQuery>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    webutil::json_response(
        StatusCode::OK,
        &tmux::shell_previews(state.config.clone(), query.lines.unwrap_or(80)).await,
    )
}

// Live quotes for DASHBOARD_TICKERS via Yahoo's public chart endpoint (login-gated, not unlock —
// market data isn't sensitive). Each symbol is fetched concurrently; failures are dropped.
async fn api_tickers(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if !allowed(&state, &headers, &connect) || !signed_in(&state, &headers, &connect) {
        return webutil::json_response(
            StatusCode::FORBIDDEN,
            &serde_json::json!({ "error": "Forbidden" }),
        );
    }
    let settings = settings::load(state.config.clone()).await;
    if !settings.panels.tickers {
        return webutil::json_response(StatusCode::OK, &serde_json::json!({ "tickers": [] }));
    }
    let fetches = settings.tickers.iter().take(16).cloned().map(|sym| {
        let client = state.client.clone();
        async move {
            let url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1d&interval=1d", urlencoding::encode(&sym));
            let resp = client.get(&url).header("User-Agent", "Mozilla/5.0").send().await.ok()?;
            let body = resp.json::<serde_json::Value>().await.ok()?;
            let meta = &body["chart"]["result"][0]["meta"];
            let price = meta["regularMarketPrice"].as_f64()?;
            let prev = meta["chartPreviousClose"].as_f64().or_else(|| meta["previousClose"].as_f64()).unwrap_or(price);
            let pct = if prev != 0.0 { (price - prev) / prev * 100.0 } else { 0.0 };
            Some(serde_json::json!({ "symbol": sym, "price": price, "changePct": pct, "currency": meta["currency"].as_str().unwrap_or("") }))
        }
    });
    let tickers: Vec<serde_json::Value> = futures_util::future::join_all(fetches)
        .await
        .into_iter()
        .flatten()
        .collect();
    webutil::json_response(StatusCode::OK, &serde_json::json!({ "tickers": tickers }))
}

async fn api_input(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<InputBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    match tmux::paste_text(
        state.config.clone(),
        &body.name,
        &body.text,
        body.submit.unwrap_or(true),
    )
    .await
    {
        Ok(message) => webutil::json_response(
            StatusCode::OK,
            &serde_json::json!({ "ok": true, "message": message, "target": body.name }),
        ),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}

async fn api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<KeyBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    match tmux::send_key(&body.name, &body.key).await {
        Ok(message) => webutil::json_response(
            StatusCode::OK,
            &serde_json::json!({ "ok": true, "message": message, "target": body.name }),
        ),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}

async fn api_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<uploads::ImageUpload>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    match uploads::save_image(state.config.clone(), body).await {
        Ok(image) => webutil::json_response(
            StatusCode::OK,
            &serde_json::json!({ "ok": true, "image": image }),
        ),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}

async fn api_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<NameBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    session_result(tmux::start_session(state.config.clone(), &body.name).await)
}

async fn api_restart(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<NameBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_unlock(&state, &headers).and_then(|_| require_action(&headers)) {
        return response;
    }
    session_result(tmux::restart_session(state.config.clone(), &body.name).await)
}

// Live machine stats (CPU / RAM / temps) for the host ShellDeck runs on. Login-gated
// like the rest of the dashboard, but not behind the shell unlock — they are not sensitive.
async fn api_metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    webutil::json_response(StatusCode::OK, &metrics::gather().await)
}

// Running Docker/Podman containers on the ShellDeck host. Login-gated, not shell-unlock gated.
async fn api_containers(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    webutil::json_response(StatusCode::OK, &containers::running().await)
}

// Remote host checks run from the ShellDeck server, so DNS/VPN/SSH reachability matches
// what the dashboard backend can actually see.
async fn api_remote_hosts(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    let hosts = remote_hosts::load(state.config.clone()).await;
    webutil::json_response(
        StatusCode::OK,
        &remote::check_all(hosts, state.config.remote_container_cap).await,
    )
}

async fn api_remote_hosts_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    let hosts = remote_hosts::load(state.config.clone()).await;
    webutil::json_response(StatusCode::OK, &serde_json::json!({ "hosts": hosts }))
}

async fn api_remote_hosts_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<RemoteHostsBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_action(&headers) {
        return response;
    }
    // Adding a host means the server will SSH to that target, so gate it behind unlock
    // (same bar as sending shell input), not just login.
    if let Err(response) = require_unlock(&state, &headers) {
        return response;
    }
    match remote_hosts::save(state.config.clone(), body.hosts).await {
        Ok(hosts) => webutil::json_response(StatusCode::OK, &serde_json::json!({ "hosts": hosts })),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}

async fn api_links(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    let links = links::load(state.config.clone()).await;
    webutil::json_response(StatusCode::OK, &serde_json::json!({ "links": links }))
}

async fn api_links_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<LinksBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_action(&headers) {
        return response;
    }
    match links::save(state.config.clone(), body.links).await {
        Ok(links) => webutil::json_response(StatusCode::OK, &serde_json::json!({ "links": links })),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}

async fn api_ui_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    webutil::json_response(StatusCode::OK, &settings::load(state.config.clone()).await)
}

async fn api_ui_config_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<SettingsBody>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_action(&headers) {
        return response;
    }
    let settings = settings::DashboardSettings {
        tickers: body.tickers,
        panels: body.panels,
    };
    match settings::save(state.config.clone(), settings).await {
        Ok(settings) => webutil::json_response(StatusCode::OK, &settings),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}

async fn api_share_shot(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect: ConnectInfo<SocketAddr>,
    axum::Json(body): axum::Json<share::ShareShotUpload>,
) -> Response {
    if let Some(response) = guard(&state, &headers, &connect) {
        return response;
    }
    if let Err(response) = require_action(&headers) {
        return response;
    }
    match share::save(state.config.clone(), body).await {
        Ok(saved) => webutil::json_response(
            StatusCode::OK,
            &serde_json::json!({ "ok": true, "shot": saved }),
        ),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}

fn session_result(result: Result<String, String>) -> Response {
    match result {
        Ok(message) => webutil::json_response(
            StatusCode::OK,
            &serde_json::json!({ "ok": true, "message": message }),
        ),
        Err(error) => webutil::json_response(
            StatusCode::BAD_REQUEST,
            &serde_json::json!({ "error": error }),
        ),
    }
}
