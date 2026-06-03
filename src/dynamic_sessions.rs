use crate::config::{Config, KnownSession};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs;

#[derive(Clone, Deserialize, Serialize)]
pub struct DynamicSession {
    pub name: String,
    pub label: String,
    pub family: String,
    pub alias: String,
    pub badge: String,
    pub start: String,
}

pub fn new_entry(name: &str, label: &str, start: &str) -> KnownSession {
    KnownSession {
        name: name.to_string(),
        label: label.to_string(),
        family: "fix".to_string(),
        alias: name.to_string(),
        badge: "FX".to_string(),
        start: start.to_string(),
    }
}

pub async fn load(config: Arc<Config>) -> Vec<KnownSession> {
    match fs::read_to_string(&config.dynamic_sessions_file).await {
        Ok(raw) => parse_file(&raw).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub async fn save_entry(config: Arc<Config>, entry: &KnownSession) -> Result<(), String> {
    let mut sessions = load(config.clone()).await;
    sessions.retain(|session| session.name != entry.name);
    sessions.push(entry.clone());
    save_all(config, sessions).await
}

pub async fn remove(config: Arc<Config>, name: &str) -> Result<bool, String> {
    let sessions = load(config.clone()).await;
    let before = sessions.len();
    let sessions: Vec<KnownSession> = sessions
        .into_iter()
        .filter(|session| session.name != name)
        .collect();
    let changed = sessions.len() != before;
    if changed {
        save_all(config, sessions).await?;
    }
    Ok(changed)
}

fn parse_file(raw: &str) -> Option<Vec<KnownSession>> {
    serde_json::from_str::<Vec<DynamicSession>>(raw)
        .or_else(|_| {
            let value = serde_json::from_str::<serde_json::Value>(raw)?;
            serde_json::from_value::<Vec<DynamicSession>>(value["sessions"].clone())
        })
        .ok()
        .map(|sessions| {
            sessions
                .into_iter()
                .filter_map(clean_entry)
                .take(48)
                .collect()
        })
}

fn clean_entry(entry: DynamicSession) -> Option<KnownSession> {
    if !valid_session_name(&entry.name) || entry.start.trim().is_empty() {
        return None;
    }
    let label = clean_text(&entry.label, 80);
    let family = clean_text(&entry.family, 24);
    let alias = clean_text(&entry.alias, 80);
    let badge = clean_text(&entry.badge, 8);
    if label.is_empty() || family.is_empty() || badge.is_empty() {
        return None;
    }
    Some(KnownSession {
        name: entry.name,
        label,
        family,
        alias,
        badge,
        start: entry.start,
    })
}

fn clean_text(raw: &str, cap: usize) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(cap)
        .collect()
}

fn valid_session_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

async fn save_all(config: Arc<Config>, sessions: Vec<KnownSession>) -> Result<(), String> {
    if let Some(parent) = config
        .dynamic_sessions_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let entries: Vec<DynamicSession> = sessions
        .into_iter()
        .map(|s| DynamicSession {
            name: s.name,
            label: s.label,
            family: s.family,
            alias: s.alias,
            badge: s.badge,
            start: s.start,
        })
        .collect();
    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(&config.dynamic_sessions_file, format!("{json}\n"))
        .await
        .map_err(|e| e.to_string())
}
