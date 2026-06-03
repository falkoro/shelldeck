use crate::config::{clean_remote_id, clean_remote_target, Config, RemoteHostConfig};
use std::sync::Arc;
use tokio::fs;

// Runtime-editable remote hosts, persisted to remote_hosts_file. Falls back to the
// DASHBOARD_REMOTE_HOSTS env seed when the file is absent (mirrors links::load).
pub async fn load(config: Arc<Config>) -> Vec<RemoteHostConfig> {
    match fs::read_to_string(&config.remote_hosts_file).await {
        Ok(raw) => parse_file(&raw).unwrap_or_else(|| config.remote_hosts.clone()),
        Err(_) => config.remote_hosts.clone(),
    }
}

pub async fn save(
    config: Arc<Config>,
    hosts: Vec<RemoteHostConfig>,
) -> Result<Vec<RemoteHostConfig>, String> {
    let hosts = normalize(hosts);
    if let Some(parent) = config
        .remote_hosts_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&hosts).map_err(|e| e.to_string())?;
    fs::write(&config.remote_hosts_file, format!("{json}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(hosts)
}

fn parse_file(raw: &str) -> Option<Vec<RemoteHostConfig>> {
    serde_json::from_str::<Vec<RemoteHostConfig>>(raw)
        .or_else(|_| {
            let value = serde_json::from_str::<serde_json::Value>(raw)?;
            serde_json::from_value::<Vec<RemoteHostConfig>>(value["hosts"].clone())
        })
        .ok()
        .map(normalize)
}

// Same validation as the env path: clean id + target (rejecting option-injection
// targets), require a label, dedupe by id, cap at 8 hosts.
fn normalize(hosts: Vec<RemoteHostConfig>) -> Vec<RemoteHostConfig> {
    let mut seen = std::collections::HashSet::new();
    hosts
        .into_iter()
        .filter_map(|host| {
            let id = clean_remote_id(&host.id);
            let label: String = host
                .label
                .trim()
                .chars()
                .filter(|c| !c.is_control())
                .take(48)
                .collect();
            let target = clean_remote_target(&host.target);
            if id.is_empty() || label.is_empty() || target.is_empty() || !seen.insert(id.clone()) {
                return None;
            }
            Some(RemoteHostConfig { id, label, target, protected: host.protected })
        })
        .take(8)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_rejects_option_injection_targets_and_dedupes() {
        let hosts = normalize(vec![
            RemoteHostConfig {
                id: "logan".into(),
                label: "Logan".into(),
                target: "logan-gl502vs".into(),
                protected: true,
            },
            // leading-dash target → rejected
            RemoteHostConfig {
                id: "evil".into(),
                label: "Evil".into(),
                target: "-oProxyCommand".into(),
                protected: false,
            },
            // duplicate id → dropped
            RemoteHostConfig {
                id: "logan".into(),
                label: "Dupe".into(),
                target: "other".into(),
                protected: false,
            },
        ]);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].id, "logan");
        assert_eq!(hosts[0].target, "logan-gl502vs");
        assert!(hosts[0].protected);
    }
}
