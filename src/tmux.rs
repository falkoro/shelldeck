use crate::config::Config;
use serde::Serialize;
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::Arc};
use tokio::{io::AsyncWriteExt, process::Command};

#[derive(Clone, Serialize)]
pub struct SessionView {
    pub name: String,
    pub label: String,
    pub family: String,
    pub alias: String,
    pub badge: String,
    pub command: String,
    pub running: bool,
    pub windows: u32,
    pub attached: u32,
    pub created: Option<u64>,
    pub activity: Option<u64>,
}

#[derive(Clone, Serialize)]
pub struct ShellPreview {
    pub name: String,
    pub label: String,
    pub running: bool,
    pub cwd: String,
    pub command: String,
    pub output: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct SessionModel {
    pub hostname: String,
    pub user: String,
    pub now: String,
    pub sessions: Vec<SessionView>,
    pub unlocked: bool,
}

#[derive(Clone)]
struct LiveSession {
    name: String,
    windows: u32,
    attached: u32,
    created: u64,
    activity: u64,
}

#[derive(Clone)]
pub struct Pane {
    pub session: String,
    pub window: String,
    pub index: String,
    pub cwd: String,
    pub command: String,
}

async fn tmux_output(args: &[&str]) -> Result<String, String> {
    let output = Command::new("/usr/bin/tmux")
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

async fn list_tmux_sessions() -> Vec<LiveSession> {
    let Ok(stdout) = tmux_output(&["list-sessions", "-F", "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}|#{session_activity}"]).await else {
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
            })
        })
        .collect()
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
            running: found.is_some(),
            windows: found.map(|s| s.windows).unwrap_or(0),
            attached: found.map(|s| s.attached).unwrap_or(0),
            created: found.map(|s| s.created),
            activity: found.map(|s| s.activity),
        });
    }
    if config.show_unknown_sessions {
        for item in live {
            if config
                .known_sessions
                .iter()
                .any(|s| s.name == item.name.as_str())
            {
                continue;
            }
            let label = custom_label(&item.name);
            sessions.push(SessionView {
                command: config.attach_template.replace("{name}", &item.name),
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

fn custom_label(name: &str) -> String {
    name.split(['-', '_'])
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

fn custom_badge(name: &str) -> String {
    let mut badge: String = name
        .split(['-', '_'])
        .filter_map(|part| part.chars().find(|c| c.is_ascii_alphanumeric()))
        .take(2)
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if badge.is_empty() {
        badge = "TM".to_string();
    }
    badge
}

pub async fn session_names() -> Vec<String> {
    list_tmux_sessions()
        .await
        .into_iter()
        .map(|s| s.name)
        .collect()
}

pub async fn list_panes() -> Vec<Pane> {
    let Ok(stdout) = tmux_output(&["list-panes", "-a", "-F", "#{session_name}|#{window_index}|#{pane_index}|#{pane_current_path}|#{pane_current_command}"]).await else {
        return Vec::new();
    };
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            Some(Pane {
                session: parts.get(0)?.to_string(),
                window: parts.get(1)?.to_string(),
                index: parts.get(2)?.to_string(),
                cwd: parts.get(3).unwrap_or(&"").to_string(),
                command: parts.get(4).unwrap_or(&"").to_string(),
            })
        })
        .collect()
}

pub async fn capture_pane(pane: &Pane, lines: u32) -> String {
    let target = format!("{}:{}.{}", pane.session, pane.window, pane.index);
    tmux_output(&["capture-pane", "-pt", &target, "-S", &format!("-{lines}")])
        .await
        .unwrap_or_default()
        .trim_end()
        .to_string()
}

pub async fn shell_previews(config: Arc<Config>, lines: u32) -> serde_json::Value {
    let panes = list_panes().await;
    let by_session: HashMap<String, Pane> =
        panes.into_iter().map(|p| (p.session.clone(), p)).collect();
    let mut shells = Vec::new();
    let known_names: Vec<&str> = config
        .known_sessions
        .iter()
        .map(|spec| spec.name.as_str())
        .collect();
    for spec in &config.known_sessions {
        if let Some(pane) = by_session.get(&spec.name) {
            let cwd = pane
                .cwd
                .replace(&home_dir().to_string_lossy().to_string(), "~");
            shells.push(ShellPreview {
                name: spec.name.clone(),
                label: spec.label.clone(),
                running: true,
                cwd,
                command: pane.command.clone(),
                output: tidy_output(&capture_pane(pane, clean_lines(lines)).await),
                updated_at: iso_now(),
            });
        } else {
            shells.push(ShellPreview {
                name: spec.name.clone(),
                label: spec.label.clone(),
                running: false,
                cwd: String::new(),
                command: String::new(),
                output: String::new(),
                updated_at: iso_now(),
            });
        }
    }
    if config.show_unknown_sessions {
        let mut unknown: Vec<&Pane> = by_session
            .values()
            .filter(|pane| !known_names.iter().any(|known| *known == pane.session))
            .collect();
        unknown.sort_by(|a, b| a.session.cmp(&b.session));
        for pane in unknown {
            let cwd = pane
                .cwd
                .replace(&home_dir().to_string_lossy().to_string(), "~");
            shells.push(ShellPreview {
                name: pane.session.clone(),
                label: custom_label(&pane.session),
                running: true,
                cwd,
                command: pane.command.clone(),
                output: tidy_output(&capture_pane(pane, clean_lines(lines)).await),
                updated_at: iso_now(),
            });
        }
    }
    serde_json::json!({ "shells": shells, "now": iso_now() })
}

pub fn clean_lines(lines: u32) -> u32 {
    match lines {
        80 | 200 | 500 => lines,
        _ => 80,
    }
}

// Full-screen TUIs (Claude Code, Codex) capture as huge runs of blank lines. Collapse runs of
// blanks to one and trim the edges so the preview shows actual content instead of empty space.
fn tidy_output(raw: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut blank = false;
    for line in raw.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            if !blank {
                out.push("");
            }
            blank = true;
        } else {
            out.push(trimmed);
            blank = false;
        }
    }
    while out.first() == Some(&"") {
        out.remove(0);
    }
    while out.last() == Some(&"") {
        out.pop();
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_tmux_sessions_get_real_badges() {
        assert_eq!(custom_badge("logan-runner"), "LR");
        assert_eq!(custom_badge("work"), "W");
        assert_eq!(custom_badge("---"), "TM");
    }

    #[test]
    fn custom_tmux_sessions_get_readable_labels() {
        assert_eq!(custom_label("logan-runner"), "Logan Runner");
        assert_eq!(custom_label("ai_house"), "Ai House");
    }

    #[test]
    fn paste_submit_delay_scales_for_codex_multiline_pastes() {
        assert_eq!(paste_submit_delay_ms(200, "short prompt"), 200);
        assert!(paste_submit_delay_ms(200, &"x".repeat(800)) > 200);
        assert!(paste_submit_delay_ms(200, "one\ntwo\nthree") >= 270);
        assert_eq!(paste_submit_delay_ms(1_800, &"x\n".repeat(500)), 2_000);
    }
}

pub async fn start_session(config: Arc<Config>, name: &str) -> Result<String, String> {
    let spec = config
        .known_sessions
        .iter()
        .find(|s| s.name == name)
        .ok_or("Unknown session")?;
    if Command::new("/usr/bin/tmux")
        .args(["has-session", "-t", name])
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
    {
        return Ok(format!("{name} is already running"));
    }
    tmux_output(&["new-session", "-d", "-s", name, &spec.start]).await?;
    Ok(format!("{name} started"))
}

pub async fn restart_session(config: Arc<Config>, name: &str) -> Result<String, String> {
    let spec = config
        .known_sessions
        .iter()
        .find(|s| s.name == name)
        .ok_or("Unknown session")?;
    let _ = Command::new("/usr/bin/tmux")
        .args(["kill-session", "-t", name])
        .status()
        .await;
    tmux_output(&["new-session", "-d", "-s", name, &spec.start]).await?;
    Ok(format!("{name} restarted in ~"))
}

pub async fn paste_text(
    config: Arc<Config>,
    name: &str,
    text: &str,
    submit: bool,
) -> Result<String, String> {
    if text.is_empty() || text.len() > config.max_input_chars {
        return Err(format!(
            "Input must be 1-{} characters",
            config.max_input_chars
        ));
    }
    let sessions = list_tmux_sessions().await;
    if !sessions.iter().any(|s| s.name == name) {
        return Err(format!("{name} is not running"));
    }
    let buffer = format!("codex-dashboard-{}", chronoish());
    let mut child = Command::new("/usr/bin/tmux")
        .args(["load-buffer", "-b", &buffer, "-"])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(text.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    if !child.wait().await.map_err(|e| e.to_string())?.success() {
        return Err("Could not load tmux buffer".to_string());
    }
    // `-p` = bracketed paste: the TUI sees one paste event (so embedded newlines don't submit
    // early) and knows to batch it, instead of treating the bytes as live keystrokes.
    tmux_output(&["paste-buffer", "-p", "-b", &buffer, "-t", name]).await?;
    if submit {
        // Let the agent TUI's event loop ingest the paste before the Enter, or the submit can race
        // ahead of the not-yet-rendered input and get dropped (intermittent "it didn't send").
        let delay_ms = paste_submit_delay_ms(config.submit_delay_ms, text);
        if delay_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
        }
        tmux_output(&["send-keys", "-t", name, "Enter"]).await?;
    }
    let _ = tmux_output(&["delete-buffer", "-b", &buffer]).await;
    Ok(if submit {
        format!("Sent input to {name}")
    } else {
        format!("Pasted input into {name}")
    })
}

fn paste_submit_delay_ms(base_ms: u64, text: &str) -> u64 {
    let byte_delay = (text.len() as u64 / 80).min(900);
    let line_delay = (text.bytes().filter(|byte| *byte == b'\n').count() as u64 * 35).min(700);
    base_ms
        .saturating_add(byte_delay)
        .saturating_add(line_delay)
        .min(2_000)
}

pub async fn send_key(name: &str, key: &str) -> Result<String, String> {
    let (tmux_key, label) = match key {
        "enter" => ("Enter", "Enter"),
        "interrupt" => ("C-c", "Ctrl-C"),
        "clear" => ("C-l", "clear screen"),
        "escape" => ("Escape", "Escape"),
        _ => return Err("Unsupported key".to_string()),
    };
    tmux_output(&["send-keys", "-t", name, tmux_key]).await?;
    Ok(format!("Sent {label} to {name}"))
}

fn hostname() -> String {
    std::fs::read_to_string("/etc/hostname")
        .unwrap_or_else(|_| "localhost".to_string())
        .trim()
        .to_string()
}
fn whoami() -> String {
    std::env::var("USER").unwrap_or_else(|_| "falk".to_string())
}
fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/home/falk"))
}
fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn chronoish() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    )
}
