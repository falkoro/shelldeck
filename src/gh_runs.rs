use crate::config::Config;
use chrono::Utc;
use futures_util::future::join_all;
use reqwest::{header::HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const CACHE_TTL: Duration = Duration::from_secs(55);

#[derive(Clone)]
pub struct GhRunsCache {
    repos_key: Vec<String>,
    fetched_at: Instant,
    result: GhRunsResult,
}

#[derive(Clone, Serialize)]
pub struct GhRunsResult {
    pub repos: Vec<GhRepoStatus>,
    pub rate_limit_remaining: Option<u32>,
    pub rate_limit_reset: Option<u64>,
    pub fetched_at: String,
    pub cached: bool,
}

#[derive(Clone, Serialize)]
pub struct GhRepoStatus {
    pub repo: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<GhRun>,
}

#[derive(Clone, Serialize)]
pub struct GhRun {
    pub id: u64,
    pub name: String,
    pub display_title: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub head_branch: Option<String>,
    pub run_number: u64,
    pub html_url: String,
    pub updated_at: String,
    pub event: String,
}

#[derive(Deserialize)]
struct RunsResponse {
    #[serde(default)]
    workflow_runs: Vec<GhRunWire>,
}

#[derive(Deserialize)]
struct GhRunWire {
    id: u64,
    #[serde(default)]
    name: String,
    #[serde(default)]
    display_title: String,
    #[serde(default)]
    status: String,
    conclusion: Option<String>,
    head_branch: Option<String>,
    #[serde(default)]
    run_number: u64,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    updated_at: String,
    #[serde(default)]
    event: String,
}

struct FetchResult {
    status: GhRepoStatus,
    rate_limit_remaining: Option<u32>,
    rate_limit_reset: Option<u64>,
}

pub async fn fetch_all(
    config: Arc<Config>,
    client: reqwest::Client,
    cache: Arc<Mutex<Option<GhRunsCache>>>,
) -> GhRunsResult {
    let repos = config.gh_repos.clone();
    if repos.is_empty() {
        return GhRunsResult {
            repos: Vec::new(),
            rate_limit_remaining: None,
            rate_limit_reset: None,
            fetched_at: Utc::now().to_rfc3339(),
            cached: false,
        };
    }
    if let Some(hit) = cached_hit(cache.clone(), &repos) {
        return hit;
    }
    let previous = cache
        .lock()
        .ok()
        .and_then(|c| c.clone())
        .filter(|c| c.repos_key == repos)
        .map(|c| c.result);
    let token = config.gh_token.clone();
    let fetched = join_all(repos.iter().cloned().map(|repo| {
        let client = client.clone();
        let token = token.clone();
        async move { fetch_repo(repo, client, token).await }
    }))
    .await;

    let rate_limit_remaining = fetched
        .iter()
        .filter_map(|item| item.rate_limit_remaining)
        .min();
    let rate_limit_reset = fetched
        .iter()
        .filter_map(|item| item.rate_limit_reset)
        .max();
    let statuses = fetched
        .into_iter()
        .map(|item| with_last_good(item.status, previous.as_ref()))
        .collect();
    let result = GhRunsResult {
        repos: statuses,
        rate_limit_remaining,
        rate_limit_reset,
        fetched_at: Utc::now().to_rfc3339(),
        cached: false,
    };
    if let Ok(mut slot) = cache.lock() {
        *slot = Some(GhRunsCache {
            repos_key: repos,
            fetched_at: Instant::now(),
            result: result.clone(),
        });
    }
    result
}

fn cached_hit(cache: Arc<Mutex<Option<GhRunsCache>>>, repos: &[String]) -> Option<GhRunsResult> {
    let cache = cache.lock().ok()?;
    let cached = cache.as_ref()?;
    if cached.repos_key != repos || cached.fetched_at.elapsed() >= CACHE_TTL {
        return None;
    }
    let mut result = cached.result.clone();
    result.cached = true;
    Some(result)
}

fn with_last_good(mut status: GhRepoStatus, previous: Option<&GhRunsResult>) -> GhRepoStatus {
    if status.ok {
        return status;
    }
    let Some(prev) = previous
        .and_then(|result| result.repos.iter().find(|item| item.repo == status.repo))
        .and_then(|item| item.run.clone())
    else {
        return status;
    };
    let error = status
        .error
        .clone()
        .unwrap_or_else(|| "GitHub refresh failed".to_string());
    status.run = Some(prev);
    status.error = Some(format!("{error}; showing last known run"));
    status
}

async fn fetch_repo(repo: String, client: reqwest::Client, token: Option<String>) -> FetchResult {
    let Some((owner, name)) = repo.split_once('/') else {
        return fetch_error(repo, "Invalid GitHub repo".to_string(), None, None);
    };
    let url = format!(
        "https://api.github.com/repos/{}/{}/actions/runs?per_page=1&exclude_pull_requests=true",
        urlencoding::encode(owner),
        urlencoding::encode(name)
    );
    let mut request = client
        .get(url)
        .header("User-Agent", "shelldeck")
        .header("Accept", "application/vnd.github+json");
    if let Some(token) = token.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => return fetch_error(repo, clean_error(&error.to_string()), None, None),
    };
    let (remaining, reset) = rate_headers(response.headers());
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return fetch_error(repo, github_error(status, &body), remaining, reset);
    }
    let body = match response.json::<RunsResponse>().await {
        Ok(body) => body,
        Err(error) => return fetch_error(repo, clean_error(&error.to_string()), remaining, reset),
    };
    FetchResult {
        status: GhRepoStatus {
            repo,
            ok: true,
            error: None,
            run: body.workflow_runs.into_iter().next().map(normalize_run),
        },
        rate_limit_remaining: remaining,
        rate_limit_reset: reset,
    }
}

fn fetch_error(
    repo: String,
    error: String,
    remaining: Option<u32>,
    reset: Option<u64>,
) -> FetchResult {
    FetchResult {
        status: GhRepoStatus {
            repo,
            ok: false,
            error: Some(error),
            run: None,
        },
        rate_limit_remaining: remaining,
        rate_limit_reset: reset,
    }
}

fn normalize_run(run: GhRunWire) -> GhRun {
    GhRun {
        id: run.id,
        name: run.name,
        display_title: run.display_title,
        status: run.status,
        conclusion: run.conclusion,
        head_branch: run.head_branch,
        run_number: run.run_number,
        html_url: run.html_url,
        updated_at: run.updated_at,
        event: run.event,
    }
}

fn rate_headers(headers: &HeaderMap) -> (Option<u32>, Option<u64>) {
    let remaining = headers
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u32>().ok());
    let reset = headers
        .get("x-ratelimit-reset")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    (remaining, reset)
}

fn github_error(status: StatusCode, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| clean_error(body));
    if message.is_empty() {
        format!("GitHub returned HTTP {}", status.as_u16())
    } else {
        format!("GitHub HTTP {}: {}", status.as_u16(), message)
    }
}

fn clean_error(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(180)
        .collect()
}
