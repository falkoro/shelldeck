use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
use tokio::fs;

#[derive(Clone, Serialize, Deserialize)]
pub struct DynamicSession {
    pub name: String,
    pub label: String,
    pub start: String,
    pub cwd: String,
}

pub async fn load(config: Arc<Config>) -> Vec<DynamicSession> {
    match fs::read_to_string(&config.dynamic_sessions_file).await {
        Ok(raw) => parse_file(&raw).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub async fn save(
    config: Arc<Config>,
    sessions: Vec<DynamicSession>,
) -> Result<Vec<DynamicSession>, String> {
    let sessions = normalize(sessions);
    if let Some(parent) = config
        .dynamic_sessions_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&sessions).map_err(|e| e.to_string())?;
    fs::write(&config.dynamic_sessions_file, format!("{json}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(sessions)
}

pub fn new_entry(
    name: &str,
    command: &str,
    cwd: Option<String>,
    label: Option<String>,
) -> Result<DynamicSession, String> {
    let name = name.trim();
    if !valid_session_name(name) {
        return Err("Session name must be 1-40 chars: A-Z, a-z, 0-9, dot, dash, underscore".to_string());
    }
    if command.contains('\n') || command.contains('\r') {
        return Err("Command must be a single line".to_string());
    }
    let start = clean_text(command, 500);
    if start.is_empty() {
        return Err("Command is required".to_string());
    }
    let cwd = normalize_cwd(cwd.unwrap_or_default())?;
    let label = clean_text(&label.unwrap_or_default(), 64);
    Ok(DynamicSession {
        name: name.to_string(),
        label: if label.is_empty() { label_from_name(name) } else { label },
        start,
        cwd,
    })
}

pub fn valid_session_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn parse_file(raw: &str) -> Option<Vec<DynamicSession>> {
    serde_json::from_str::<Vec<DynamicSession>>(raw)
        .or_else(|_| {
            let value = serde_json::from_str::<serde_json::Value>(raw)?;
            serde_json::from_value::<Vec<DynamicSession>>(value["sessions"].clone())
        })
        .ok()
        .map(normalize)
}

fn normalize(sessions: Vec<DynamicSession>) -> Vec<DynamicSession> {
    let mut seen = std::collections::HashSet::new();
    sessions
        .into_iter()
        .filter_map(|session| {
            let name = session.name.trim().to_string();
            if !valid_session_name(&name) || !seen.insert(name.clone()) {
                return None;
            }
            let start = clean_text(&session.start, 500);
            if start.is_empty() {
                return None;
            }
            let cwd = normalize_cwd(session.cwd).ok()?;
            let label = clean_text(&session.label, 64);
            Some(DynamicSession {
                name: name.clone(),
                label: if label.is_empty() { label_from_name(&name) } else { label },
                start,
                cwd,
            })
        })
        .take(64)
        .collect()
}

fn normalize_cwd(raw: String) -> Result<String, String> {
    let trimmed = raw.trim();
    let path = if trimmed.is_empty() {
        home_dir()
    } else if trimmed == "~" {
        home_dir()
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        home_dir().join(rest)
    } else {
        PathBuf::from(trimmed)
    };
    let clean = path.to_string_lossy().to_string();
    if clean.is_empty() || !path.exists() || !path.is_dir() {
        return Err("cwd must be an existing directory".to_string());
    }
    Ok(clean.chars().take(240).collect())
}

fn clean_text(value: &str, max: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

fn label_from_name(name: &str) -> String {
    name.split(['-', '_', '.'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/home/falk"))
}
