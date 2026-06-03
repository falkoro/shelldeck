use crate::config::Config;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs;

#[derive(Clone, Deserialize, Serialize)]
pub struct FixAgent {
    pub id: String,
    pub label: String,
    pub command: String,
}

pub async fn load(config: Arc<Config>) -> Vec<FixAgent> {
    match fs::read_to_string(&config.fix_agents_file).await {
        Ok(raw) => parse_file(&raw).unwrap_or_else(seed),
        Err(_) => seed(),
    }
}

pub async fn save(config: Arc<Config>, agents: Vec<FixAgent>) -> Result<Vec<FixAgent>, String> {
    let agents = normalize(agents);
    if let Some(parent) = config
        .fix_agents_file
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&agents).map_err(|e| e.to_string())?;
    fs::write(&config.fix_agents_file, format!("{json}\n"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(agents)
}

fn parse_file(raw: &str) -> Option<Vec<FixAgent>> {
    serde_json::from_str::<Vec<FixAgent>>(raw)
        .or_else(|_| {
            let value = serde_json::from_str::<serde_json::Value>(raw)?;
            serde_json::from_value::<Vec<FixAgent>>(value["agents"].clone())
        })
        .ok()
        .map(normalize)
}

pub fn clean_agent_id(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .take(40)
        .collect()
}

fn clean_label(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(48)
        .collect::<String>()
        .trim()
        .to_string()
}

fn clean_command(raw: &str) -> Option<String> {
    if raw.contains('\n') || raw.contains('\r') {
        return None;
    }
    let command: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect();
    (!command.is_empty()).then_some(command)
}

fn normalize(agents: Vec<FixAgent>) -> Vec<FixAgent> {
    let mut seen = std::collections::HashSet::new();
    agents
        .into_iter()
        .filter_map(|agent| {
            let raw_id = agent.id.trim();
            let id = clean_agent_id(raw_id);
            let label = clean_label(&agent.label);
            let command = clean_command(&agent.command)?;
            if id.is_empty() || id != raw_id || label.is_empty() || !seen.insert(id.clone()) {
                return None;
            }
            Some(FixAgent { id, label, command })
        })
        .take(12)
        .collect()
}

fn seed() -> Vec<FixAgent> {
    vec![
        FixAgent { id: "claude".into(), label: "Claude".into(), command: "claude".into() },
        FixAgent { id: "grok".into(), label: "Grok".into(), command: "grok".into() },
        FixAgent { id: "codex".into(), label: "Codex".into(), command: "codex".into() },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_command() {
        let agents = normalize(vec![FixAgent {
            id: "codex.exec".into(),
            label: "Codex".into(),
            command: "codex exec {prompt}".into(),
        }]);
        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].command, "codex exec {prompt}");
    }

    #[test]
    fn rejects_empty_and_multiline_commands() {
        let agents = normalize(vec![
            FixAgent { id: "empty".into(), label: "Empty".into(), command: " ".into() },
            FixAgent { id: "multi".into(), label: "Multi".into(), command: "grok\nrm".into() },
        ]);
        assert!(agents.is_empty());
    }

    #[test]
    fn rejects_bad_ids() {
        let agents = normalize(vec![FixAgent {
            id: "bad id".into(),
            label: "Bad".into(),
            command: "claude".into(),
        }]);
        assert!(agents.is_empty());
    }

    #[test]
    fn dedupes_and_caps() {
        let mut raw = vec![
            FixAgent { id: "same".into(), label: "One".into(), command: "one".into() },
            FixAgent { id: "same".into(), label: "Two".into(), command: "two".into() },
        ];
        for n in 0..20 {
            raw.push(FixAgent {
                id: format!("a{n}"),
                label: format!("Agent {n}"),
                command: "agent".into(),
            });
        }
        let agents = normalize(raw);
        assert_eq!(agents.len(), 12);
        assert_eq!(agents.iter().filter(|a| a.id == "same").count(), 1);
    }
}
