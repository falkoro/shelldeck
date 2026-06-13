use serde::Serialize;

pub(crate) const DETACHED_TMUX_COLS: &str = "240";
pub(crate) const DETACHED_TMUX_ROWS: &str = "80";

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
pub(crate) struct LiveSession {
    pub(crate) name: String,
    pub(crate) windows: u32,
    pub(crate) attached: u32,
    pub(crate) created: u64,
    pub(crate) activity: u64,
    pub(crate) shelldeck_created: bool,
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
