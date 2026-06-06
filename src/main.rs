mod auth;
mod config;
mod container_actions;
mod containers;
mod gh_runs;
mod image_versions;
mod links;
mod metrics;
mod pages;
mod persist;
mod ratelimit;
mod remote;
mod remote_hosts;
mod remote_metrics;
mod routes;
mod settings;
mod share;
mod stream;
mod stt;
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
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub client: reqwest::Client,
    // last successful (non-local) work summary, served if the AI backend briefly fails
    pub summary_cache: Arc<Mutex<Option<summary::WorkSummary>>>,
    // GitHub Actions run summaries, cached so sidebar polling stays within GitHub rate limits
    pub gh_runs_cache: Arc<Mutex<Option<gh_runs::GhRunsCache>>>,
    // caps concurrent speech-to-text jobs so whisper.cpp can't pile up and saturate CPU
    pub stt_limit: Arc<Semaphore>,
    // throttles shell-unlock password guessing (the last gate before live shell control)
    pub unlock_limiter: Arc<Mutex<ratelimit::UnlockLimiter>>,
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
        gh_runs_cache: Arc::new(Mutex::new(None)),
        stt_limit: Arc::new(Semaphore::new(2)),
        unlock_limiter: Arc::new(Mutex::new(ratelimit::UnlockLimiter::default())),
    };
    let app: Router = routes::router(state);
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .expect("valid dashboard bind address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind dashboard listener");
    println!("ShellDeck listening on http://{}", addr);
    #[cfg(feature = "saas")]
    {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("serve dashboard");
    }
    #[cfg(not(feature = "saas"))]
    {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .expect("serve dashboard");
    }
}

#[cfg(feature = "saas")]
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            let _ = signal.recv().await;
        } else {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
