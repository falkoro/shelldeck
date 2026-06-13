use crate::config::Config;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

use super::exec::{chronoish, tmux_command, tmux_output};
use super::sessions::list_tmux_sessions;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_submit_delay_scales_for_codex_multiline_pastes() {
        assert_eq!(paste_submit_delay_ms(200, "short prompt"), 200);
        assert!(paste_submit_delay_ms(200, &"x".repeat(800)) > 200);
        assert!(paste_submit_delay_ms(200, "one\ntwo\nthree") >= 270);
        assert_eq!(paste_submit_delay_ms(1_800, &"x\n".repeat(500)), 2_000);
    }
}
