use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env, path::PathBuf};

#[derive(Clone)]
pub struct KnownSession {
    pub name: String,
    pub label: String,
    pub family: String,
    pub alias: String,
    pub badge: String,
    pub start: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RemoteHostConfig {
    pub id: String,
    pub label: String,
    pub target: String,
}

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub secret: Vec<u8>,
    pub allowed_ips: Vec<String>,
    pub allowed_emails: Vec<String>,
    pub trust_cf_access_email: bool,
    pub allow_cloudflare_login: bool,
    pub skip_login: bool,
    pub skip_unlock: bool,
    pub bypass_login_ips: Vec<String>,
    pub unlock_password: String,
    pub root_dir: PathBuf,
    pub upload_dir: PathBuf,
    pub max_image_bytes: usize,
    pub max_input_chars: usize,
    pub submit_delay_ms: u64,
    pub summary_command: String,
    pub xai_api_key: String,
    pub finnhub_api_key: String,
    pub xai_base_url: String,
    pub xai_api_style: String,
    pub xai_model: String,
    pub xai_auth_file: PathBuf,
    pub xai_client_id: String,
    pub attach_template: String,
    pub ssh_attach_template: String,
    pub quick_links: Vec<(String, String)>,
    pub links_file: PathBuf,
    pub ui_config_file: PathBuf,
    pub share_shot_file: PathBuf,
    pub tickers: Vec<String>,
    pub remote_hosts: Vec<RemoteHostConfig>,
    pub remote_hosts_file: PathBuf,
    pub remote_container_cap: usize,
    // Gather CPU/RAM/load/temps for remote hosts over SSH (one extra /proc read per poll).
    // Default on; set DASHBOARD_REMOTE_METRICS=0 to keep remote cards to ping + containers only.
    pub remote_metrics: bool,
    pub gh_repos: Vec<String>,
    pub gh_token: Option<String>,
    // "Safe shot" generates a shareable, redacted screenshot. Off by default; set
    // DASHBOARD_ENABLE_SAFE_SHOT=1 to show the top-bar button.
    pub enable_safe_shot: bool,
    pub allowed_origins: Vec<String>,
    pub show_unknown_sessions: bool,
    pub known_sessions: Vec<KnownSession>,
    pub image_types: HashMap<String, &'static str>,
    // Server-side speech-to-text for Mic dictation. The browser-native Web Speech API has no
    // working backend on Linux (Edge/Chromium), so we record audio in the browser and transcribe
    // it here with whisper.cpp. Audio stays on the box; nothing is sent to a third party.
    pub stt_cmd: String,
    pub ffmpeg_cmd: String,
    pub stt_model: Option<PathBuf>,
    pub stt_language: String,
    pub max_audio_bytes: usize,
}

impl Config {
    pub fn from_env() -> Self {
        let home = env::var("HOME").unwrap_or_else(|_| "/home/falk".to_string());
        let mut secret = env::var("DASHBOARD_SECRET")
            .map(|value| value.into_bytes())
            .unwrap_or_else(|_| {
                let mut bytes = vec![0_u8; 32];
                OsRng.fill_bytes(&mut bytes);
                bytes
            });
        if secret.is_empty() {
            secret = vec![0_u8; 32];
        }
        let password = env::var("DASHBOARD_PASSWORD").unwrap_or_default();
        if password.is_empty() {
            eprintln!("DASHBOARD_PASSWORD is required.");
            std::process::exit(1);
        }
        // Directory that holds the served `public/` assets. Defaults to the working directory so
        // running ShellDeck from its project folder just works; override with DASHBOARD_ROOT_DIR.
        let root_dir = env::var("DASHBOARD_ROOT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
        let upload_dir = env::var("DASHBOARD_UPLOAD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| root_dir.join("uploads"));
        let xai_api_key = env::var("XAI_API_KEY")
            .or_else(|_| env::var("GROK_API_KEY"))
            .unwrap_or_default();
        let xai_base_url =
            env::var("XAI_BASE_URL").unwrap_or_else(|_| "https://api.x.ai/v1".to_string());
        let xai_api_style = env::var("XAI_API_STYLE").unwrap_or_else(|_| "openai".to_string());
        let xai_model = env::var("XAI_MODEL").unwrap_or_else(|_| "grok-4.3".to_string());
        Self {
            host: env::var("DASHBOARD_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: env::var("DASHBOARD_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8787),
            user: env::var("DASHBOARD_USER").unwrap_or_else(|_| "admin".to_string()),
            password,
            secret,
            allowed_ips: split_env("DASHBOARD_ALLOWED_IPS"),
            allowed_emails: split_env("DASHBOARD_ALLOWED_EMAILS")
                .into_iter()
                .map(|v| v.to_lowercase())
                .collect(),
            trust_cf_access_email: env::var("DASHBOARD_TRUST_CF_ACCESS_EMAIL").ok().as_deref()
                == Some("1"),
            allow_cloudflare_login: env::var("DASHBOARD_ALLOW_CLOUDFLARE_LOGIN").ok().as_deref()
                == Some("1"),
            // Skip ShellDeck's own login password entirely and trust the network gate
            // (allowed IP / Cloudflare Access). Only enable when an external layer like
            // Cloudflare Access already authenticates who can reach the dashboard.
            skip_login: env::var("DASHBOARD_SKIP_LOGIN").ok().as_deref() == Some("1"),
            // Drop the second-password "shell unlock" gate (trust the network gate). For single-user
            // setups behind Cloudflare Access + an IP allowlist. Default off.
            skip_unlock: env_flag("DASHBOARD_SKIP_UNLOCK"),
            bypass_login_ips: split_env("DASHBOARD_BYPASS_LOGIN_IPS"),
            unlock_password: env::var("DASHBOARD_UNLOCK_PASSWORD")
                .unwrap_or_else(|_| "change-me".to_string()),
            root_dir: root_dir.clone(),
            upload_dir: upload_dir.clone(),
            max_image_bytes: env::var("DASHBOARD_MAX_IMAGE_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8 * 1024 * 1024),
            max_input_chars: env::var("DASHBOARD_MAX_INPUT_CHARS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(20_000),
            // Pause between pasting input and pressing Enter, so agent TUIs (Claude Code, Codex)
            // finish ingesting the paste before the submit lands. Tune up if sends still get dropped.
            submit_delay_ms: env::var("DASHBOARD_SUBMIT_DELAY_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(200),
            summary_command: env::var("DASHBOARD_SUMMARY_COMMAND").unwrap_or_default(),
            xai_api_key: xai_api_key.clone(),
            finnhub_api_key: env::var("FINNHUB_API_KEY")
                .or_else(|_| env::var("FINNHUB_TOKEN"))
                .or_else(|_| env::var("finnhub_token"))
                .unwrap_or_default(),
            xai_base_url: xai_base_url.clone(),
            xai_api_style: xai_api_style.clone(),
            xai_model: xai_model.clone(),
            xai_auth_file: env::var("XAI_AUTH_FILE")
                .map(PathBuf::from)
                .unwrap_or_else(|_| {
                    PathBuf::from(format!("{home}/.local/share/opencode/auth.json"))
                }),
            xai_client_id: env::var("XAI_CLIENT_ID")
                .unwrap_or_else(|_| "b1a00492-073a-47ea-816f-4c329264a828".to_string()),
            attach_template: env::var("DASHBOARD_ATTACH_TEMPLATE")
                .unwrap_or_else(|_| "tmux attach -t {name}".to_string()),
            // SSH-into-tmux command (copy-only, never executed server-side). {name} = session.
            ssh_attach_template: env::var("DASHBOARD_SSH_ATTACH_TEMPLATE")
                .unwrap_or_default()
                .trim()
                .to_string(),
            quick_links: parse_links(&env::var("DASHBOARD_LINKS").unwrap_or_default()),
            links_file: configured_path(
                env::var("DASHBOARD_LINKS_FILE").ok(),
                root_dir.join("links.json"),
            ),
            ui_config_file: configured_path(
                env::var("DASHBOARD_UI_CONFIG_FILE").ok(),
                root_dir.join("dashboard-config.json"),
            ),
            share_shot_file: configured_path(
                env::var("DASHBOARD_SHARE_SHOT_FILE").ok(),
                root_dir.join("share").join("shelldeck-safe-shot.png"),
            ),
            tickers: split_env("DASHBOARD_TICKERS"),
            remote_hosts: parse_remote_hosts(
                &env::var("DASHBOARD_REMOTE_HOSTS").unwrap_or_default(),
            ),
            // Runtime-editable remote hosts (self-service UI). Seeds from DASHBOARD_REMOTE_HOSTS
            // when this file is absent, then lives in remote-hosts.json.
            remote_hosts_file: configured_path(
                env::var("DASHBOARD_REMOTE_HOSTS_FILE").ok(),
                root_dir.join("remote-hosts.json"),
            ),
            remote_container_cap: env::var("DASHBOARD_REMOTE_CONTAINER_CAP")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|cap| *cap > 0)
                .unwrap_or(100),
            // Default on; only disabled when explicitly set to a falsy value.
            remote_metrics: env::var("DASHBOARD_REMOTE_METRICS")
                .map(|v| parse_flag(&v))
                .unwrap_or(true),
            gh_repos: parse_gh_repos(&env::var("DASHBOARD_GH_REPOS").unwrap_or_default()),
            gh_token: env::var("DASHBOARD_GH_TOKEN")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty()),
            enable_safe_shot: env_flag("DASHBOARD_ENABLE_SAFE_SHOT"),
            // Extra browser Origins allowed to open the /api/term WebSocket (beyond same-host).
            allowed_origins: split_env("DASHBOARD_ALLOWED_ORIGINS"),
            show_unknown_sessions: env_flag("DASHBOARD_SHOW_UNKNOWN_SESSIONS"),
            known_sessions: known_sessions(),
            image_types: image_types(),
            stt_cmd: env::var("DASHBOARD_STT_CMD").unwrap_or_else(|_| "whisper-cli".to_string()),
            ffmpeg_cmd: env::var("DASHBOARD_FFMPEG_CMD").unwrap_or_else(|_| "ffmpeg".to_string()),
            // Explicit DASHBOARD_STT_MODEL always wins (a missing path surfaces as a runtime error
            // rather than silently disabling). Otherwise auto-enable when the bundled model exists.
            stt_model: env::var("DASHBOARD_STT_MODEL")
                .ok()
                .map(PathBuf::from)
                .or_else(|| {
                    let d = root_dir.join("share").join("models").join("ggml-base.en.bin");
                    d.exists().then_some(d)
                }),
            stt_language: env::var("DASHBOARD_STT_LANG").unwrap_or_else(|_| "en".to_string()),
            max_audio_bytes: env::var("DASHBOARD_MAX_AUDIO_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(25 * 1024 * 1024),
        }
    }
}

fn split_env(key: &str) -> Vec<String> {
    env::var(key)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .collect()
}

// Parse DASHBOARD_LINKS into (label, url) quick links. Format: "Label|https://url;Label|https://url".
// Mirrors the runtime save path's scheme allowlist (links::valid_url) so an env-seeded
// javascript:/data: URL can't slip into an href that the API path would have rejected.
fn parse_links(raw: &str) -> Vec<(String, String)> {
    raw.split(';')
        .filter_map(|item| {
            let (label, url) = item.trim().split_once('|')?;
            let (label, url) = (label.trim(), url.trim());
            (!label.is_empty() && !url.is_empty() && crate::links::valid_url(url))
                .then(|| (label.to_string(), url.to_string()))
        })
        .collect()
}

// Parse DASHBOARD_REMOTE_HOSTS into monitored SSH hosts.
// Format: "id|Label|ssh-target;id2|Label 2|user@host".
fn parse_remote_hosts(raw: &str) -> Vec<RemoteHostConfig> {
    let mut seen = std::collections::HashSet::new();
    raw.split(';')
        .filter_map(|item| {
            let mut parts = item.split('|').map(str::trim);
            let id = clean_remote_id(parts.next()?);
            let label = parts.next()?.trim();
            let target = clean_remote_target(parts.next()?);
            if id.is_empty() || label.is_empty() || target.is_empty() || !seen.insert(id.clone()) {
                return None;
            }
            Some(RemoteHostConfig {
                id,
                label: label.chars().take(48).collect(),
                target,
            })
        })
        .take(8)
        .collect()
}

// Parse DASHBOARD_GH_REPOS into monitored GitHub repositories.
// Format: "owner/repo;owner2/repo2". Dedupe case-insensitively and cap at 8 repos.
fn parse_gh_repos(raw: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    raw.split(';')
        .filter_map(|item| {
            let mut parts = item.trim().split('/');
            let owner = clean_gh_segment(parts.next()?, 39);
            let repo = clean_gh_segment(parts.next()?, 100);
            if parts.next().is_some() || owner.is_empty() || repo.is_empty() {
                return None;
            }
            let full = format!("{owner}/{repo}");
            if !seen.insert(full.to_ascii_lowercase()) {
                return None;
            }
            Some(full)
        })
        .take(8)
        .collect()
}

fn clean_gh_segment(raw: &str, max: usize) -> String {
    raw.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .take(max)
        .collect()
}

pub fn clean_remote_id(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .take(32)
        .collect()
}

// Sanitize an SSH target. Returns "" (rejected) for anything that isn't a plain
// [user@]host[:port] value. Crucially rejects a leading '-' on any segment so the
// value can never be parsed by ssh/ping as an OPTION (argument/option injection) —
// this matters now that the self-service UI lets users supply targets.
pub fn clean_remote_target(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '@' | ':'))
        .take(96)
        .collect();
    if valid_ssh_target(&cleaned) {
        cleaned
    } else {
        String::new()
    }
}

fn valid_ssh_target(target: &str) -> bool {
    if target.is_empty() || !target.chars().any(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    // No '@'-separated segment (the optional user, then the host) may start with '-'.
    !target.split('@').any(|segment| segment.starts_with('-'))
}

fn configured_path(raw: Option<String>, default: PathBuf) -> PathBuf {
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default)
}

fn env_flag(key: &str) -> bool {
    parse_flag(&env::var(key).unwrap_or_default())
}

fn parse_flag(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn known_sessions() -> Vec<KnownSession> {
    let default_start = zsh_start_in("~", "zsh -l");
    let agent_workdir = env::var("DASHBOARD_AGENT_WORKDIR").unwrap_or_else(|_| "~".to_string());
    let mut sessions = vec![
        known_session("main", "Main Shell", "shell", "ta", "sh", &default_start),
        known_session("slot1", "Shell Slot 1", "slot", "ts1", "1", &default_start),
        known_session("slot2", "Shell Slot 2", "slot", "ts2", "2", &default_start),
        known_session("slot3", "Shell Slot 3", "slot", "ts3", "3", &default_start),
        known_session("slot4", "Shell Slot 4", "slot", "ts4", "4", &default_start),
        known_session("slot5", "Shell Slot 5", "slot", "ts5", "5", &default_start),
        known_session("slot6", "Shell Slot 6", "slot", "ts6", "6", &default_start),
        known_session("slot7", "Shell Slot 7", "slot", "ts7", "7", &default_start),
    ];

    for session in agent_presets_from_raw(
        &env::var("DASHBOARD_AGENT_PRESETS").unwrap_or_default(),
        &agent_workdir,
    ) {
        push_unique_session(&mut sessions, session);
    }
    for session in parse_custom_sessions(
        &env::var("DASHBOARD_CUSTOM_SESSIONS").unwrap_or_default(),
        &agent_workdir,
    ) {
        push_unique_session(&mut sessions, session);
    }
    sessions
}

fn known_session(
    name: &str,
    label: &str,
    family: &str,
    alias: &str,
    badge: &str,
    start: &str,
) -> KnownSession {
    KnownSession {
        name: name.to_string(),
        label: label.to_string(),
        family: family.to_string(),
        alias: alias.to_string(),
        badge: badge.to_string(),
        start: start.to_string(),
    }
}

fn agent_session(
    name: &str,
    label: &str,
    badge: &str,
    command: &str,
    workdir: &str,
) -> KnownSession {
    known_session(
        name,
        label,
        "agent",
        name,
        badge,
        &zsh_start_in(workdir, command),
    )
}

fn push_unique_session(sessions: &mut Vec<KnownSession>, session: KnownSession) {
    if sessions.iter().any(|item| item.name == session.name) {
        return;
    }
    sessions.push(session);
}

fn agent_presets_from_raw(raw: &str, workdir: &str) -> Vec<KnownSession> {
    raw.split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .filter_map(|item| match item.to_ascii_lowercase().as_str() {
            "flow" | "iflow" => Some(agent_session("iflow", "iFlow", "if", "iflow", workdir)),
            "gemini" | "gemini-cli" => Some(agent_session(
                "gemini",
                "Gemini CLI",
                "ge",
                "gemini",
                workdir,
            )),
            "qwen" | "qwen-code" => Some(agent_session("qwen", "Qwen Code", "qw", "qwen", workdir)),
            "goose" => Some(agent_session(
                "goose",
                "goose",
                "go",
                "goose session",
                workdir,
            )),
            "aider" => Some(agent_session("aider", "Aider", "ai", "aider", workdir)),
            "opencode" => Some(agent_session(
                "opencode", "OpenCode", "oc", "opencode", workdir,
            )),
            "codex" => Some(agent_session("codex", "Codex", "cx", "codex", workdir)),
            "grok" => Some(agent_session("grok", "Grok", "gx", "grok", workdir)),
            "claude" | "claude-code" => Some(agent_session(
                "claude",
                "Claude Code",
                "cc",
                "claude",
                workdir,
            )),
            other => {
                eprintln!("Ignoring unknown DASHBOARD_AGENT_PRESETS entry: {other}");
                None
            }
        })
        .collect()
}

fn parse_custom_sessions(raw: &str, workdir: &str) -> Vec<KnownSession> {
    raw.split(';')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .filter_map(|item| {
            let parts: Vec<&str> = item.split('|').map(str::trim).collect();
            if parts.len() != 4 {
                eprintln!(
                    "Ignoring DASHBOARD_CUSTOM_SESSIONS entry with wrong field count: {item}"
                );
                return None;
            }
            let (name, label, badge, command) = (parts[0], parts[1], parts[2], parts[3]);
            if !valid_session_name(name)
                || label.is_empty()
                || badge.is_empty()
                || command.is_empty()
            {
                eprintln!("Ignoring invalid DASHBOARD_CUSTOM_SESSIONS entry: {item}");
                return None;
            }
            Some(agent_session(name, label, badge, command, workdir))
        })
        .collect()
}

fn valid_session_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

fn zsh_start_in(workdir: &str, command: &str) -> String {
    let cd_target = if workdir == "~" || workdir.starts_with("~/") {
        workdir.to_string()
    } else {
        shell_word(workdir)
    };
    shell_command(&format!("cd {cd_target}; exec {command}"))
}

fn shell_command(script: &str) -> String {
    format!("zsh -lic {}", shell_word(script))
}

fn shell_word(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn image_types() -> HashMap<String, &'static str> {
    HashMap::from([
        ("image/png".to_string(), ".png"),
        ("image/jpeg".to_string(), ".jpg"),
        ("image/webp".to_string(), ".webp"),
        ("image/gif".to_string(), ".gif"),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_presets_include_iflow_aliases_and_open_source_tools() {
        let sessions =
            agent_presets_from_raw("flow,gemini,qwen,goose,aider,unknown", "/tmp/project");
        let names: Vec<&str> = sessions
            .iter()
            .map(|session| session.name.as_str())
            .collect();
        assert_eq!(names, vec!["iflow", "gemini", "qwen", "goose", "aider"]);
        assert!(sessions[0].start.contains("exec iflow"));
        assert!(sessions[0].start.contains("/tmp/project"));
    }

    #[test]
    fn custom_sessions_parse_valid_entries_and_ignore_invalid_names() {
        let sessions = parse_custom_sessions(
            "openclaw|Open Claw|oc|openclaw;bad:name|Bad|bd|bad",
            "~/work",
        );
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].name, "openclaw");
        assert_eq!(sessions[0].label, "Open Claw");
        assert_eq!(sessions[0].badge, "oc");
        assert!(sessions[0].start.contains("cd ~/work; exec openclaw"));
    }

    #[test]
    fn shell_word_escapes_single_quotes() {
        assert_eq!(shell_word("/tmp/falk's repo"), "'/tmp/falk'\"'\"'s repo'");
    }

    #[test]
    fn configured_path_ignores_empty_values() {
        let default = PathBuf::from("/tmp/shelldeck/links.json");
        assert_eq!(configured_path(None, default.clone()), default);
        assert_eq!(
            configured_path(Some("   ".to_string()), default.clone()),
            default
        );
        assert_eq!(
            configured_path(Some("/tmp/custom-links.json".to_string()), default),
            PathBuf::from("/tmp/custom-links.json")
        );
    }

    #[test]
    fn remote_hosts_parse_valid_unique_ssh_targets() {
        let hosts = parse_remote_hosts(
            "logan502vs|Logan GL502VS|logan-gl502vs;bad|Missing;ops|Ops Host|deploy@10.0.0.8:22;logan502vs|Duplicate|other",
        );
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].id, "logan502vs");
        assert_eq!(hosts[0].label, "Logan GL502VS");
        assert_eq!(hosts[0].target, "logan-gl502vs");
        assert_eq!(hosts[1].target, "deploy@10.0.0.8:22");
    }

    #[test]
    fn gh_repos_parse_owner_repo_pairs_and_dedupe() {
        let repos = parse_gh_repos(" falkoro/shelldeck ;bad;FALKORO/shelldeck;spot-techno/spot_suite ");
        assert_eq!(repos, vec!["falkoro/shelldeck", "spot-techno/spot_suite"]);
    }

    #[test]
    fn env_flag_accepts_common_truthy_values() {
        for value in ["1", "true", "TRUE", "yes", "on"] {
            assert!(parse_flag(value));
        }
        for value in ["", "0", "false", "no", "off"] {
            assert!(!parse_flag(value));
        }
    }
}
