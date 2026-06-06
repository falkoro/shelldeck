use crate::{config::Config, persist};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs;

#[derive(Clone, Deserialize, Serialize)]
pub struct QuickLink {
    pub label: String,
    pub url: String,
}

pub async fn load(config: Arc<Config>) -> Vec<QuickLink> {
    match fs::read_to_string(&config.links_file).await {
        Ok(raw) => parse_file(&raw).unwrap_or_default(),
        Err(_) => config
            .quick_links
            .iter()
            .map(|(label, url)| QuickLink {
                label: label.clone(),
                url: url.clone(),
            })
            .collect(),
    }
}

pub async fn save(config: Arc<Config>, links: Vec<QuickLink>) -> Result<Vec<QuickLink>, String> {
    let links = normalize_links(links);
    if let Some(parent) = config
        .links_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        if let Err(e) = fs::create_dir_all(parent).await {
            if !persist::continue_after_disk_error(parent, "create directory", &e) {
                return Err(e.to_string());
            }
        }
    }
    let json = serde_json::to_string_pretty(&links).map_err(|e| e.to_string())?;
    if let Err(e) = fs::write(&config.links_file, format!("{json}\n")).await {
        if !persist::continue_after_disk_error(&config.links_file, "write file", &e) {
            return Err(e.to_string());
        }
    }
    Ok(links)
}

fn parse_file(raw: &str) -> Option<Vec<QuickLink>> {
    serde_json::from_str::<Vec<QuickLink>>(raw)
        .or_else(|_| {
            let value = serde_json::from_str::<serde_json::Value>(raw)?;
            serde_json::from_value::<Vec<QuickLink>>(value["links"].clone())
        })
        .ok()
        .map(normalize_links)
}

fn normalize_links(links: Vec<QuickLink>) -> Vec<QuickLink> {
    links
        .into_iter()
        .filter_map(|link| {
            let label = link.label.trim().replace(char::is_control, "");
            let url = link.url.trim().replace(char::is_control, "");
            if label.is_empty() || url.is_empty() || !valid_url(&url) {
                return None;
            }
            Some(QuickLink {
                label: label.chars().take(80).collect(),
                url: url.chars().take(2048).collect(),
            })
        })
        .take(48)
        .collect()
}

pub fn valid_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://") || url.starts_with('/')
}
