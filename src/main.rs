mod auth;
mod config;
mod pages;
mod routes;
mod stream;
mod summary;
mod term;
mod tmux;
mod uploads;
mod webutil;

use axum::Router;
use config::Config;
use std::{net::SocketAddr, sync::Arc};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub client: reqwest::Client,
}

#[tokio::main]
async fn main() {
    let config = Arc::new(Config::from_env());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .connect_timeout(std::time::Duration::from_secs(4))
        .build()
        .unwrap_or_default();
    let state = AppState {
        config: config.clone(),
        client,
    };
    let app: Router = routes::router(state);
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("valid dashboard bind address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind dashboard listener");
    println!("codex session dashboard listening on http://{}", addr);
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .expect("serve dashboard");
}
