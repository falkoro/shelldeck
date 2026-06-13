use crate::config::Config;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use super::exec::{hostname, iso_now, tmux_output, tmux_status, whoami};
use super::labels::{custom_badge, custom_label};
use super::model::{
    CreateSessionResult, LiveSession, SessionModel, SessionView, DETACHED_TMUX_COLS,
    DETACHED_TMUX_ROWS,
};

pub(crate) async fn list_tmux_sessions() -> Vec<LiveSession> {
    let Ok(stdout) = tmux_output(&["list-sessions", "-F", "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}|#{session_activity}|#{@shelldeck_created}"]).await else {
        return Vec::new();
    };
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            Some(LiveSession {
                name: parts.get(0)?.to_string(),
                windows: parts.get(1)?.parse().ok()?,
                attached: parts.get(2)?.parse().ok()?,
                created: parts.get(3)?.parse().ok()?,
                activity: parts.get(4)?.parse().ok()?,
                shelldeck_created: parts.get(5).is_some_and(|v| *v == "1"),
            })
        })
        .collect()
}

// Render DASHBOARD_SSH_ATTACH_TEMPLATE for a session, or "" when unset.
fn ssh_attach_command(config: &Config, name: &str) -> String {
    if config.ssh_attach_template.is_empty() {
        String::new()
    } else {
        config.ssh_attach_template.replace("{name}", name)
    }
}

pub async fn session_model(config: Arc<Config>, unlocked: bool) -> SessionModel {
    let live = list_tmux_sessions().await;
    let live_by_name: HashMap<String, LiveSession> =
        live.iter().cloned().map(|s| (s.name.clone(), s)).collect();
    let mut sessions = Vec::new();
    for spec in &config.known_sessions {
        let found = live_by_name.get(&spec.name);
        sessions.push(SessionView {
            name: spec.name.clone(),
            label: spec.label.clone(),
            family: spec.family.clone(),
            alias: spec.alias.clone(),
            badge: spec.badge.clone(),
            command: config.attach_template.replace("{name}", &spec.name),
            ssh_command: ssh_attach_command(&config, &spec.name),
            running: found.is_some(),
            windows: found.map(|s| s.windows).unwrap_or(0),
            attached: found.map(|s| s.attached).unwrap_or(0),
            created: found.map(|s| s.created),
            activity: found.map(|s| s.activity),
        });
    }
    if config.show_unknown_sessions || live.iter().any(|item| item.shelldeck_created) {
        for item in live {
            if config
                .known_sessions
                .iter()
                .any(|s| s.name == item.name.as_str())
            {
                continue;
            }
            if !config.show_unknown_sessions && !item.shelldeck_created {
                continue;
            }
            let label = custom_label(&item.name);
            sessions.push(SessionView {
                command: config.attach_template.replace("{name}", &item.name),
                ssh_command: ssh_attach_command(&config, &item.name),
                label,
                name: item.name.clone(),
                family: "custom".to_string(),
                alias: item.name.clone(),
                badge: custom_badge(&item.name),
                running: true,
                windows: item.windows,
                attached: item.attached,
                created: Some(item.created),
                activity: Some(item.activity),
            });
        }
    }
    SessionModel {
        hostname: hostname(),
        user: whoami(),
        now: iso_now(),
        sessions,
        unlocked,
    }
}

pub async fn session_names() -> Vec<String> {
    list_tmux_sessions()
        .await
        .into_iter()
        .map(|s| s.name)
        .collect()
}

pub async fn start_session(config: Arc<Config>, name: &str) -> Result<String, String> {
    launch_known_session(config, name, "started").await
}

pub async fn create_session(
    config: Arc<Config>,
    name: &str,
    requested_name: Option<&str>,
) -> Result<CreateSessionResult, String> {
    let spec = config
        .known_sessions
        .iter()
        .find(|s| s.name == name)
        .ok_or("Unknown session")?;
    let session_name = requested_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(name);
    if !valid_session_name(session_name) {
        return Err(
            "Session name must be 1-64 characters: letters, numbers, dash, or underscore"
                .to_string(),
        );
    }
    if session_name != name
        && config
            .known_sessions
            .iter()
            .any(|session| session.name == session_name)
    {
        return Err(format!(
            "{session_name} is a configured session; use its own New tmux button"
        ));
    }
    if tmux_status(&["has-session", "-t", session_name])
        .await
        .unwrap_or(false)
    {
        return Ok(CreateSessionResult {
            message: format!("{session_name} is already running"),
            session_name: session_name.to_string(),
        });
    }
    let args = new_detached_session_args(session_name, &spec.start);
    tmux_output(&args).await?;
    if session_name != name {
        let _ = tmux_status(&["set-option", "-t", session_name, "@shelldeck_created", "1"]).await;
        let _ = tmux_status(&["set-option", "-t", session_name, "@shelldeck_source", name]).await;
    }
    Ok(CreateSessionResult {
        message: format!("{session_name} created"),
        session_name: session_name.to_string(),
    })
}

async fn launch_known_session(
    config: Arc<Config>,
    name: &str,
    verb: &str,
) -> Result<String, String> {
    let spec = config
        .known_sessions
        .iter()
        .find(|s| s.name == name)
        .ok_or("Unknown session")?;
    if tmux_status(&["has-session", "-t", name])
        .await
        .unwrap_or(false)
    {
        return Ok(format!("{name} is already running"));
    }
    let args = new_detached_session_args(name, &spec.start);
    tmux_output(&args).await?;
    Ok(format!("{name} {verb}"))
}

fn new_detached_session_args<'a>(name: &'a str, start: &'a str) -> Vec<&'a str> {
    vec![
        "new-session",
        "-d",
        "-x",
        DETACHED_TMUX_COLS,
        "-y",
        DETACHED_TMUX_ROWS,
        "-s",
        name,
        start,
    ]
}

fn valid_session_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

pub async fn restart_session(config: Arc<Config>, name: &str) -> Result<String, String> {
    let spec = config
        .known_sessions
        .iter()
        .find(|s| s.name == name)
        .ok_or("Unknown session")?;
    let _ = tmux_status(&["detach-client", "-s", name]).await;
    let _ = tmux_status(&["kill-session", "-t", name]).await;
    tokio::time::sleep(Duration::from_millis(120)).await;
    let args = new_detached_session_args(name, &spec.start);
    tmux_output(&args).await?;
    Ok(format!("{name} restarted in ~"))
}

pub async fn stop_session(name: &str) -> Result<String, String> {
    if name.trim().is_empty() {
        return Err("Session name is required".to_string());
    }
    let sessions = list_tmux_sessions().await;
    if !sessions.iter().any(|s| s.name == name) {
        return Err(format!("{name} is not running"));
    }
    tmux_output(&["kill-session", "-t", name]).await?;
    Ok(format!("{name} stopped"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tmux_session_name_validation_keeps_names_safe() {
        assert!(valid_session_name("feature_1"));
        assert!(valid_session_name("review-test"));
        assert!(!valid_session_name(""));
        assert!(!valid_session_name("bad name"));
        assert!(!valid_session_name("bad:target"));
        assert!(!valid_session_name(&"x".repeat(65)));
    }
}
