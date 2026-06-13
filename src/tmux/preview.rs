use crate::config::Config;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::exec::{home_dir, iso_now, tmux_output, tmux_status};
use super::labels::custom_label;
use super::model::{Pane, ShellPreview, DETACHED_TMUX_COLS, DETACHED_TMUX_ROWS};
use super::sessions::list_tmux_sessions;

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
    // < 20 is below the browser-terminal clamp floor (term.rs), so a window this narrow is never a
    // legitimately-sized client — it is a hidden/zero-width terminal or a stale tiny client driving
    // the shared window to ~1 column under window-size "latest", which redraws the agent TUI
    // vertically. Resizing alone does not stick: "latest" snaps back to whatever tiny client is
    // attached. So detach the sub-floor offenders first, letting a real client (RDP/SSH/sized
    // browser) govern again; then widen for the no-client-left case and restore "latest".
    if pane.window_width == 0 || pane.window_width >= 20 {
        return;
    }
    for tty in clients_below_width(&pane.session, 20).await {
        let _ = tmux_status(&["detach-client", "-t", &tty]).await;
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

/// TTYs of clients attached to `session` narrower than `min_cols` — the broken/hidden clients that
/// collapse the shared window under window-size "latest".
async fn clients_below_width(session: &str, min_cols: u16) -> Vec<String> {
    let Ok(out) = tmux_output(&[
        "list-clients",
        "-t",
        session,
        "-F",
        "#{client_tty}|#{client_width}",
    ])
    .await
    else {
        return Vec::new();
    };
    out.lines()
        .filter_map(|line| {
            let (tty, width) = line.split_once('|')?;
            (width.trim().parse::<u16>().ok()? < min_cols).then(|| tty.to_string())
        })
        .collect()
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
