mod auth;
mod config;
mod containers;
mod links;
mod metrics;
mod pages;
mod remote;
mod remote_hosts;
mod routes;
mod settings;
mod share;
mod stream;
mod summary;
mod term;
mod tmux;
mod uploads;
mod webutil;

use axum::Router;
use config::Config;
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub client: reqwest::Client,
    // last successful (non-local) work summary, served if the AI backend briefly fails
    pub summary_cache: Arc<Mutex<Option<summary::WorkSummary>>>,
}

#[tokio::main]
async fn main() {
    let config = Arc::new(Config::from_env());
    if config.unlock_password == "change-me" {
        eprintln!(
            "WARNING: DASHBOARD_UNLOCK_PASSWORD is unset; using the default 'change-me'. \
             Anyone who can reach the dashboard can unlock live shell control — set it."
        );
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(4))
        .build()
        .unwrap_or_default();
    let state = AppState {
        config: config.clone(),
        client,
        summary_cache: Arc::new(Mutex::new(None)),
    };
    let app: Router = routes::router(state);
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("valid dashboard bind address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind dashboard listener");
    println!("ShellDeck listening on http://{}", addr);
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("serve dashboard");
}
