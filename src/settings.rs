use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs;

#[derive(Clone, Deserialize, Serialize)]
pub struct PanelSettings {
    pub machine: bool,
    #[serde(default = "default_true", rename = "machineSensors")]
    pub machine_sensors: bool,
    pub containers: bool,
    #[serde(default = "default_true", rename = "remoteHosts")]
    pub remote_hosts: bool,
    pub links: bool,
    pub tickers: bool,
    // When true, container/host lists drop their max-height + scrollbar and expand fully.
    #[serde(default, rename = "expandLists")]
    pub expand_lists: bool,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct DashboardSettings {
    pub tickers: Vec<String>,
    pub panels: PanelSettings,
}

impl DashboardSettings {
    pub fn defaults(config: &Config) -> Self {
        Self {
            tickers: normalize_tickers(config.tickers.clone()),
            panels: PanelSettings {
                machine: true,
                machine_sensors: true,
                containers: true,
                remote_hosts: true,
                links: true,
                tickers: true,
                expand_lists: false,
            },
        }
    }
}

pub async fn load(config: Arc<Config>) -> DashboardSettings {
    match fs::read_to_string(&config.ui_config_file).await {
        Ok(raw) => {
            parse_file(&raw, &config).unwrap_or_else(|| DashboardSettings::defaults(&config))
        }
        Err(_) => DashboardSettings::defaults(&config),
    }
}

pub async fn save(
    config: Arc<Config>,
    settings: DashboardSettings,
) -> Result<DashboardSettings, String> {
    let settings = normalize_settings(settings);
    if let Some(parent) = config
        .ui_config_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&config.ui_config_file, format!("{json}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(settings)
}

fn parse_file(raw: &str, config: &Config) -> Option<DashboardSettings> {
    serde_json::from_str::<DashboardSettings>(raw)
        .ok()
        .map(normalize_settings)
        .or_else(|| {
            let value = serde_json::from_str::<serde_json::Value>(raw).ok()?;
            let mut settings = DashboardSettings::defaults(config);
            if let Some(tickers) = value.get("tickers").and_then(|v| v.as_array()) {
                settings.tickers = normalize_tickers(
                    tickers
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect(),
                );
            }
            if let Some(panels) = value.get("panels") {
                settings.panels.machine = panels
                    .get("machine")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(settings.panels.machine);
                settings.panels.machine_sensors = panels
                    .get("machineSensors")
                    .or_else(|| panels.get("machine_sensors"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(settings.panels.machine_sensors);
                settings.panels.containers = panels
                    .get("containers")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(settings.panels.containers);
                settings.panels.remote_hosts = panels
                    .get("remoteHosts")
                    .or_else(|| panels.get("remote_hosts"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(settings.panels.remote_hosts);
                settings.panels.links = panels
                    .get("links")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(settings.panels.links);
                settings.panels.tickers = panels
                    .get("tickers")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(settings.panels.tickers);
                settings.panels.expand_lists = panels
                    .get("expandLists")
                    .or_else(|| panels.get("expand_lists"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(settings.panels.expand_lists);
            }
            Some(normalize_settings(settings))
        })
}

fn default_true() -> bool {
    true
}

fn normalize_settings(mut settings: DashboardSettings) -> DashboardSettings {
    settings.tickers = normalize_tickers(settings.tickers);
    settings
}

fn normalize_tickers(tickers: Vec<String>) -> Vec<String> {
    tickers
        .into_iter()
        .filter_map(|ticker| {
            let clean: String = ticker
                .trim()
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '=' | '^'))
                .take(24)
                .collect();
            (!clean.is_empty()).then_some(clean.to_ascii_uppercase())
        })
        .fold(Vec::new(), |mut acc, ticker| {
            if !acc.contains(&ticker) && acc.len() < 16 {
                acc.push(ticker);
            }
            acc
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_tickers_dedupes_and_limits_symbols() {
        assert_eq!(
            normalize_tickers(vec![
                " msft ".to_string(),
                "MSFT".to_string(),
                "btc-usd".to_string(),
                "bad symbol!".to_string(),
            ]),
            vec!["MSFT", "BTC-USD", "BADSYMBOL"]
        );
    }

    #[test]
    fn panel_settings_default_machine_sensors_for_existing_json() {
        let parsed: DashboardSettings = serde_json::from_str(
            r#"{"tickers":[],"panels":{"machine":true,"containers":true,"links":true,"tickers":true}}"#,
        )
        .unwrap();
        assert!(parsed.panels.machine_sensors);
        assert!(parsed.panels.remote_hosts);
        let value = serde_json::to_value(parsed).unwrap();
        assert_eq!(value["panels"]["machineSensors"], true);
        assert_eq!(value["panels"]["remoteHosts"], true);
    }
}
