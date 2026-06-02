use crate::config::Config;
use std::{collections::BTreeSet, sync::Arc};
use tokio::fs;

pub async fn load(config: Arc<Config>) -> BTreeSet<String> {
    match fs::read_to_string(&config.private_sessions_file).await {
        Ok(raw) => parse_file(&raw).unwrap_or_default(),
        Err(_) => BTreeSet::new(),
    }
}

pub async fn save(
    config: Arc<Config>,
    sessions: BTreeSet<String>,
) -> Result<BTreeSet<String>, String> {
    let sessions = normalize_set(sessions);
    if let Some(parent) = config
        .private_sessions_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string())?;
    fs::write(&config.private_sessions_file, format!("{json}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(sessions)
}

pub async fn set(
    config: Arc<Config>,
    name: &str,
    private: bool,
) -> Result<BTreeSet<String>, String> {
    let clean = normalize_name(name);
    if clean.is_empty() {
        return Err("Session name is required".to_string());
    }
    let mut sessions = load(config.clone()).await;
    if private {
        sessions.insert(clean);
    } else {
        sessions.remove(&clean);
    }
    save(config, sessions).await
}

fn parse_file(raw: &str) -> Option<BTreeSet<String>> {
    serde_json::from_str::<BTreeSet<String>>(raw)
        .or_else(|_| {
            let value = serde_json::from_str::<serde_json::Value>(raw)?;
            serde_json::from_value::<BTreeSet<String>>(value["private"].clone())
        })
        .ok()
        .map(normalize_set)
}

fn normalize_set(sessions: BTreeSet<String>) -> BTreeSet<String> {
    sessions
        .into_iter()
        .filter_map(|name| {
            let clean = normalize_name(&name);
            (!clean.is_empty()).then_some(clean)
        })
        .collect()
}

fn normalize_name(name: &str) -> String {
    let clean = name.trim();
    if clean.len() > 64 {
        return String::new();
    }
    clean
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .then(|| clean.to_string())
        .unwrap_or_default()
}
