//! tmux integration: session model, live previews, lifecycle, and input.
//!
//! Split into focused submodules (model/exec/labels/sessions/preview/input); the public surface
//! used elsewhere as `tmux::*` is re-exported below so call sites are unchanged.

mod exec;
mod input;
mod labels;
mod model;
mod preview;
mod sessions;

pub use exec::{set_window_size_latest, tmux_pty_command};
pub use input::{paste_text, send_key};
pub use model::SessionModel;
pub use preview::{capture_pane, clean_lines, list_panes, shell_previews};
pub use sessions::{
    create_session, restart_session, session_model, session_names, start_session, stop_session,
};
