use crate::config::Config;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{io::AsyncWriteExt, process::Command};

#[derive(Clone, Serialize)]
pub struct SessionView {
    pub name: String,
    pub label: String,
    pub family: String,
    pub alias: String,
    pub badge: String,
    pub command: String,
    // Optional "ssh into this tmux session" command (DASHBOARD_SSH_ATTACH_TEMPLATE);
    // empty string when no template is configured. Copy-only — never executed server-side.
    #[serde(rename = "sshCommand")]
    pub ssh_command: String,
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
    shelldeck_created: bool,
}

#[derive(Clone)]
pub struct Pane {
    pub session: String,
    pub window: String,
    pub index: String,
    pub cwd: String,
    pub command: String,
    /// Width of the pane's tmux window (`#{window_width}`); used only to detect a window that a
    /// too-small browser-terminal fit shrank to ~1 column. Window-level, not per-pane, so a
    /// legitimately split narrow pane does not look like a collapse.
    pub window_width: u16,
}

pub struct CreateSessionResult {
    pub message: String,
    pub session_name: String,
}

const DETACHED_TMUX_COLS: &str = "240";
const DETACHED_TMUX_ROWS: &str = "80";

pub fn tmux_args(args: &[&str]) -> Vec<String> {
    let mut full = Vec::new();
    if let Some(socket) = tmux_socket() {
        full.push("-L".to_string());
        full.push(socket);
    }
    full.extend(args.iter().map(|arg| arg.to_string()));
    full
}

pub fn tmux_pty_command(args: &[&str]) -> portable_pty::CommandBuilder {
    let mut command = portable_pty::CommandBuilder::new("/usr/bin/tmux");
    command.args(tmux_args(args));
    command
}

fn tmux_command(args: &[&str]) -> Command {
    let mut command = Command::new("/usr/bin/tmux");
    command.args(tmux_args(args));
    command
}

async fn tmux_status(args: &[&str]) -> Result<bool, String> {
    tmux_command(args)
        .status()
        .await
        .map(|s| s.success())
        .map_err(|e| e.to_string())
}

async fn tmux_output(args: &[&str]) -> Result<String, String> {
    let output = tmux_command(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub async fn set_window_size_latest() {
    let _ = tmux_status(&["set-option", "-g", "window-size", "latest"]).await;
}

async fn list_tmux_sessions() -> Vec<LiveSession> {
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
    let Ok(stdout) = tmux_output(&["list-panes", "-a", "-F", "#{session_name}|#{window_index}|#{pane_index}|#{pane_current_path}|#{pane_current_command}|#{window_width}"]).await else {
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
                window_width: parts.get(5).and_then(|w| w.parse().ok()).unwrap_or(0),
            })
        })
        .collect()
}

/// Recover a session whose shared tmux window got shrunk to ~1 column by a too-small
/// browser-terminal fit. window-size "latest" keeps that tiny size after the browser detaches,
/// so the agent TUI stays redrawn vertically and every preview capture looks like one character
/// per line. When a window comes back far too narrow, snap it back to the detached default and
/// restore "latest" so a future RDP/SSH client still governs the size. No-op for normal-width
/// windows, so it is safe to call on every preview refresh.
async fn recover_collapsed_window(pane: &Pane) {
    if pane.window_width == 0 || pane.window_width >= 40 {
        return;
    }
    let target = format!("{}:{}", pane.session, pane.window);
    let _ = tmux_status(&[
        "resize-window",
        "-t",
        &target,
        "-x",
        DETACHED_TMUX_COLS,
        "-y",
        DETACHED_TMUX_ROWS,
    ])
    .await;
    let _ = tmux_status(&["set-window-option", "-u", "-t", &target, "window-size"]).await;
}

pub async fn capture_pane(pane: &Pane, lines: u32) -> String {
    let target = format!("{}:{}.{}", pane.session, pane.window, pane.index);
    // -J joins soft-wrapped lines back into one logical line, so long URLs/paths reach the
    // dashboard intact (otherwise the preview linkifier sees a URL truncated at pane width).
    tmux_output(&["capture-pane", "-pJt", &target, "-S", &format!("-{lines}")])
        .await
        .unwrap_or_default()
        .trim_end()
        .to_string()
}

pub async fn shell_previews(config: Arc<Config>, lines: u32) -> serde_json::Value {
    let live = list_tmux_sessions().await;
    let shelldeck_created: HashSet<String> = live
        .iter()
        .filter(|session| session.shelldeck_created)
        .map(|session| session.name.clone())
        .collect();
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
            recover_collapsed_window(pane).await;
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
    if config.show_unknown_sessions || !shelldeck_created.is_empty() {
        let mut unknown: Vec<&Pane> = by_session
            .values()
            .filter(|pane| {
                !known_names.iter().any(|known| *known == pane.session)
                    && (config.show_unknown_sessions || shelldeck_created.contains(&pane.session))
            })
            .collect();
        unknown.sort_by(|a, b| a.session.cmp(&b.session));
        for pane in unknown {
            recover_collapsed_window(pane).await;
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
    fn tmux_session_name_validation_keeps_names_safe() {
        assert!(valid_session_name("feature_1"));
        assert!(valid_session_name("review-test"));
        assert!(!valid_session_name(""));
        assert!(!valid_session_name("bad name"));
        assert!(!valid_session_name("bad:target"));
        assert!(!valid_session_name(&"x".repeat(65)));
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
    let mut child = tmux_command(&["load-buffer", "-b", &buffer, "-"])
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
    if let Some(value) = clean_env("DASHBOARD_HOSTNAME") {
        return value;
    }
    std::fs::read_to_string("/etc/hostname")
        .unwrap_or_else(|_| "localhost".to_string())
        .trim()
        .to_string()
}
fn whoami() -> String {
    clean_env("USER")
        .or_else(|| clean_env("LOGNAME"))
        .unwrap_or_else(|| "shelldeck".to_string())
}
fn home_dir() -> PathBuf {
    clean_env("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/home/shelldeck"))
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

fn tmux_socket() -> Option<String> {
    crate::config::tmux_socket_from_env()
}

fn clean_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
