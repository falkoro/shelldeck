use std::path::PathBuf;
use tokio::process::Command;

pub(crate) fn tmux_args(args: &[&str]) -> Vec<String> {
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

pub(crate) fn tmux_command(args: &[&str]) -> Command {
    let mut command = Command::new("/usr/bin/tmux");
    command.args(tmux_args(args));
    command
}

pub(crate) async fn tmux_status(args: &[&str]) -> Result<bool, String> {
    tmux_command(args)
        .status()
        .await
        .map(|s| s.success())
        .map_err(|e| e.to_string())
}

pub(crate) async fn tmux_output(args: &[&str]) -> Result<String, String> {
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

pub(crate) fn hostname() -> String {
    if let Some(value) = clean_env("DASHBOARD_HOSTNAME") {
        return value;
    }
    std::fs::read_to_string("/etc/hostname")
        .unwrap_or_else(|_| "localhost".to_string())
        .trim()
        .to_string()
}

pub(crate) fn whoami() -> String {
    clean_env("USER")
        .or_else(|| clean_env("LOGNAME"))
        .unwrap_or_else(|| "shelldeck".to_string())
}

pub(crate) fn home_dir() -> PathBuf {
    clean_env("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/home/shelldeck"))
}

pub(crate) fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn chronoish() -> String {
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

pub(crate) fn clean_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
