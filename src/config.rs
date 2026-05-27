use rand::{rngs::OsRng, RngCore};
use std::{collections::HashMap, env, path::PathBuf};

#[derive(Clone)]
pub struct KnownSession {
    pub name: &'static str,
    pub label: &'static str,
    pub family: &'static str,
    pub alias: &'static str,
    pub badge: &'static str,
    pub start: &'static str,
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
    pub bypass_login_ips: Vec<String>,
    pub unlock_password: String,
    pub root_dir: PathBuf,
    pub upload_dir: PathBuf,
    pub max_image_bytes: usize,
    pub max_input_chars: usize,
    pub summary_command: String,
    pub xai_api_key: String,
    pub xai_base_url: String,
    pub xai_api_style: String,
    pub xai_model: String,
    pub xai_auth_file: PathBuf,
    pub xai_client_id: String,
    pub agents_url: String,
    pub attach_template: String,
    pub quick_links: Vec<(String, String)>,
    pub tickers: Vec<String>,
    pub known_sessions: Vec<KnownSession>,
    pub image_types: HashMap<String, &'static str>,
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
        Self {
            host: env::var("DASHBOARD_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: env::var("DASHBOARD_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(8787),
            user: env::var("DASHBOARD_USER").unwrap_or_else(|_| "admin".to_string()),
            password,
            secret,
            allowed_ips: split_env("DASHBOARD_ALLOWED_IPS"),
            allowed_emails: split_env("DASHBOARD_ALLOWED_EMAILS").into_iter().map(|v| v.to_lowercase()).collect(),
            trust_cf_access_email: env::var("DASHBOARD_TRUST_CF_ACCESS_EMAIL").ok().as_deref() == Some("1"),
            allow_cloudflare_login: env::var("DASHBOARD_ALLOW_CLOUDFLARE_LOGIN").ok().as_deref() == Some("1"),
            bypass_login_ips: split_env("DASHBOARD_BYPASS_LOGIN_IPS"),
            unlock_password: env::var("DASHBOARD_UNLOCK_PASSWORD").unwrap_or_else(|_| "change-me".to_string()),
            root_dir: root_dir.clone(),
            upload_dir: env::var("DASHBOARD_UPLOAD_DIR").map(PathBuf::from).unwrap_or_else(|_| root_dir.join("uploads")),
            max_image_bytes: env::var("DASHBOARD_MAX_IMAGE_BYTES").ok().and_then(|v| v.parse().ok()).unwrap_or(8 * 1024 * 1024),
            max_input_chars: env::var("DASHBOARD_MAX_INPUT_CHARS").ok().and_then(|v| v.parse().ok()).unwrap_or(20_000),
            summary_command: env::var("DASHBOARD_SUMMARY_COMMAND").unwrap_or_default(),
            xai_api_key: env::var("XAI_API_KEY").or_else(|_| env::var("GROK_API_KEY")).unwrap_or_default(),
            xai_base_url: env::var("XAI_BASE_URL").unwrap_or_else(|_| "https://api.x.ai/v1".to_string()),
            xai_api_style: env::var("XAI_API_STYLE").unwrap_or_else(|_| "openai".to_string()),
            xai_model: env::var("XAI_MODEL").unwrap_or_else(|_| "grok-4.3".to_string()),
            xai_auth_file: env::var("XAI_AUTH_FILE")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(format!("{home}/.local/share/opencode/auth.json"))),
            xai_client_id: env::var("XAI_CLIENT_ID").unwrap_or_else(|_| "b1a00492-073a-47ea-816f-4c329264a828".to_string()),
            agents_url: env::var("DASHBOARD_AGENTS_URL").unwrap_or_else(|_| "http://127.0.0.1:4627".to_string()),
            attach_template: env::var("DASHBOARD_ATTACH_TEMPLATE").unwrap_or_else(|_| "tmux attach -t {name}".to_string()),
            quick_links: parse_links(&env::var("DASHBOARD_LINKS").unwrap_or_default()),
            tickers: split_env("DASHBOARD_TICKERS"),
            known_sessions: known_sessions(),
            image_types: image_types(),
        }
    }
}

fn split_env(key: &str) -> Vec<String> {
    env::var(key).unwrap_or_default().split(',').map(str::trim).filter(|v| !v.is_empty()).map(str::to_string).collect()
}

// Parse DASHBOARD_LINKS into (label, url) quick links. Format: "Label|https://url;Label|https://url".
fn parse_links(raw: &str) -> Vec<(String, String)> {
    raw.split(';')
        .filter_map(|item| {
            let (label, url) = item.trim().split_once('|')?;
            let (label, url) = (label.trim(), url.trim());
            (!label.is_empty() && !url.is_empty()).then(|| (label.to_string(), url.to_string()))
        })
        .collect()
}

fn known_sessions() -> Vec<KnownSession> {
    const START: &str = "zsh -lic 'cd ~; exec zsh -l'";
    vec![
        KnownSession { name: "main", label: "Main Shell", family: "shell", alias: "ta", badge: "sh", start: START },
        KnownSession { name: "slot1", label: "Shell Slot 1", family: "slot", alias: "ts1", badge: "1", start: START },
        KnownSession { name: "slot2", label: "Shell Slot 2", family: "slot", alias: "ts2", badge: "2", start: START },
        KnownSession { name: "slot3", label: "Shell Slot 3", family: "slot", alias: "ts3", badge: "3", start: START },
        KnownSession { name: "slot4", label: "Shell Slot 4", family: "slot", alias: "ts4", badge: "4", start: START },
        KnownSession { name: "slot5", label: "Shell Slot 5", family: "slot", alias: "ts5", badge: "5", start: START },
        KnownSession { name: "slot6", label: "Shell Slot 6", family: "slot", alias: "ts6", badge: "6", start: START },
    ]
}

fn image_types() -> HashMap<String, &'static str> {
    HashMap::from([
        ("image/png".to_string(), ".png"),
        ("image/jpeg".to_string(), ".jpg"),
        ("image/webp".to_string(), ".webp"),
        ("image/gif".to_string(), ".gif"),
    ])
}
