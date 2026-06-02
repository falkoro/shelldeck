use crate::{config::Config, private_sessions, tmux};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::process::Command;

#[derive(Serialize, Clone)]
pub struct WorkSummary {
    pub provider: String,
    pub summary: String,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: String,
}

const SYSTEM_PROMPT: &str = "You are Hermes, a terse engineering-operations agent. You receive recent tmux pane captures for several sessions (main, slot1, …). For EACH session, write ONE compact 10-18 word line naming WHAT it is working on — the concrete task, file, service, error, command, PR, or topic visible in that pane. Use noun phrases or direct fragments, not canned prose. Do NOT start lines with 'working on', 'continuing', 'reviewing', 'checking', 'appears to be', or 'currently'. Do NOT add greetings, morning/evening language, or recap filler. Do NOT reuse the same sentence across sessions; if two panes look similar, mention the distinguishing command, cwd, file, error, or last concrete line. Describe the work itself; do NOT label it busy/active/idle/waiting/finished (that status is shown separately by the dashboard, so never say 'idle' or 'awaiting input'). Ignore terminal chrome: status bars (context %, token counts, 'esc to interrupt', 'shift+tab to cycle', model name), the 'How is Claude doing this session' rating prompt, box-drawing borders, and greyed placeholder input hints. Format each line exactly as '<session>: <text>'. Never expose secrets. Keep the whole reply under 240 words.";

// Anthropic Messages API shape (used by the SuperGrok/Hermes bridge at XAI_BASE_URL/messages).
#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    system: &'static str,
    temperature: f32,
    messages: Vec<AnthropicMessage>,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    #[serde(default)]
    content: Vec<AnthropicBlock>,
}

#[derive(Deserialize)]
struct AnthropicBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

pub async fn get(config: Arc<Config>, client: reqwest::Client) -> WorkSummary {
    let context = collect_context(config.clone()).await;
    let prompt = sanitize(&serde_json::to_string_pretty(&context).unwrap_or_default());
    if !config.summary_command.is_empty() {
        return shell_summary(config, &prompt, &context).await;
    }
    let token = bearer_token(config.clone(), client.clone())
        .await
        .unwrap_or_default();
    if token.is_empty() {
        return local_summary(&context, "local", None);
    }
    let result = if config.xai_api_style.eq_ignore_ascii_case("anthropic") {
        chat_completion_anthropic(config.clone(), client, &token, &prompt).await
    } else {
        chat_completion(config.clone(), client, &token, &prompt).await
    };
    match result {
        Ok(summary) if !summary.is_empty() => WorkSummary {
            provider: format!("hermes:{}", config.xai_model),
            summary: polish_summary(&summary, &context),
            generated_at: context["generatedAt"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
        },
        Ok(_) => local_summary(&context, "local", None),
        Err(error) => local_summary(&context, "local", Some(format!("Summary failed: {error}"))),
    }
}

async fn collect_context(config: Arc<Config>) -> serde_json::Value {
    let model = tmux::session_model(config.clone(), false).await;
    let panes = tmux::list_panes().await;
    let managed = tmux::managed_session_names(config.clone()).await;
    let private = private_sessions::load(config.clone()).await;
    let visible: Vec<String> = managed
        .into_iter()
        .filter(|name| !private.contains(name))
        .collect();
    let mut captures = Vec::new();
    let now_epoch = chrono::Utc::now().timestamp();
    for pane in panes
        .into_iter()
        .filter(|p| visible.contains(&p.session))
        .take(8)
    {
        let tail = sanitize(&focus_recent(&tmux::capture_pane(&pane, 40).await));
        captures.push(serde_json::json!({ "session": pane.session, "cwd": pane.cwd, "command": pane.command, "tail": tail }));
    }
    serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "hostname": model.hostname,
        "user": model.user,
        "sessions": model.sessions.iter().map(|s| {
            let activity_age_secs = s.activity.map(|activity| (now_epoch - activity as i64).max(0));
            serde_json::json!({ "name": s.name, "running": s.running, "attached": s.attached, "activity": s.activity, "activityAgeSecs": activity_age_secs })
        }).filter(|s| s["name"].as_str().map(|name| visible.contains(&name.to_string())).unwrap_or(false)).collect::<Vec<_>>(),
        "panes": captures
    })
}

// Keep the most recent meaningful lines of a pane capture for the summarizer: drop blank and
// box-drawing-only lines, then keep the last ~22 (the "end" of the session, where current work is).
fn focus_recent(raw: &str) -> String {
    let kept: Vec<&str> = raw
        .lines()
        .map(|l| l.trim_end())
        .filter(|l| l.trim().chars().any(|c| c.is_alphanumeric()))
        .filter(|l| !is_tui_chrome_line(l))
        .collect();
    let start = kept.len().saturating_sub(22);
    kept[start..].join("\n")
}

async fn shell_summary(
    config: Arc<Config>,
    prompt: &str,
    context: &serde_json::Value,
) -> WorkSummary {
    let output = Command::new("/usr/bin/bash")
        .args(["-lc", &config.summary_command])
        .env("SHELLDECK_CONTEXT", prompt)
        .output()
        .await;
    match output {
        Ok(out) if out.status.success() => {
            let summary = String::from_utf8_lossy(&out.stdout).trim().to_string();
            WorkSummary {
                provider: "hermes".to_string(),
                summary: if summary.is_empty() {
                    local_text(context)
                } else {
                    polish_summary(&summary, context)
                },
                generated_at: context["generatedAt"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            }
        }
        Ok(out) => local_summary(
            context,
            "local",
            Some(format!(
                "Hermes command failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )),
        ),
        Err(error) => local_summary(
            context,
            "local",
            Some(format!("Hermes command failed: {error}")),
        ),
    }
}

async fn chat_completion(
    config: Arc<Config>,
    client: reqwest::Client,
    token: &str,
    prompt: &str,
) -> Result<String, String> {
    let request = ChatRequest {
        model: config.xai_model.clone(),
        messages: vec![
            ChatMessage {
                role: "system",
                content: SYSTEM_PROMPT.to_string(),
            },
            ChatMessage {
                role: "user",
                content: prompt.to_string(),
            },
        ],
        temperature: 0.2,
        max_tokens: 420,
    };
    let url = format!(
        "{}/chat/completions",
        config.xai_base_url.trim_end_matches('/')
    );
    let response = client
        .post(&url)
        .bearer_auth(token)
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Summary model returned HTTP {}", response.status()));
    }
    let parsed: ChatResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(parsed
        .choices
        .first()
        .map(|c| c.message.content.trim().to_string())
        .unwrap_or_default())
}

// SuperGrok via the Hermes bridge (Anthropic Messages API at {base}/messages). Concatenates
// the assistant's text blocks, discarding any "thinking" blocks the model emits.
async fn chat_completion_anthropic(
    config: Arc<Config>,
    client: reqwest::Client,
    token: &str,
    prompt: &str,
) -> Result<String, String> {
    let request = AnthropicRequest {
        model: config.xai_model.clone(),
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        temperature: 0.2,
        messages: vec![AnthropicMessage {
            role: "user",
            content: prompt.to_string(),
        }],
    };
    let url = format!("{}/messages", config.xai_base_url.trim_end_matches('/'));
    let response = client
        .post(&url)
        .bearer_auth(token)
        .header("anthropic-version", "2023-06-01")
        .json(&request)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Summary model returned HTTP {}", response.status()));
    }
    let parsed: AnthropicResponse = response.json().await.map_err(|e| e.to_string())?;
    let text: String = parsed
        .content
        .iter()
        .filter(|b| b.kind == "text")
        .map(|b| b.text.as_str())
        .collect::<Vec<_>>()
        .join("");
    Ok(text.trim().to_string())
}

async fn bearer_token(config: Arc<Config>, client: reqwest::Client) -> Result<String, String> {
    if !config.xai_api_key.is_empty() {
        return Ok(config.xai_api_key.clone());
    }
    let auth = std::fs::read_to_string(&config.xai_auth_file).unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&auth).unwrap_or_default();
    let access = parsed["xai"]["access"].as_str().unwrap_or_default();
    let refresh = parsed["xai"]["refresh"].as_str().unwrap_or_default();
    let expires = parsed["xai"]["expires"].as_i64().unwrap_or_default();
    if !access.is_empty()
        && (expires == 0 || chrono::Utc::now().timestamp_millis() + 300_000 < expires)
    {
        return Ok(access.to_string());
    }
    if refresh.is_empty() {
        return Ok(access.to_string());
    }
    refresh_token(config, client, refresh)
        .await
        .or_else(|_| Ok(access.to_string()))
}

async fn refresh_token(
    config: Arc<Config>,
    client: reqwest::Client,
    refresh: &str,
) -> Result<String, String> {
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh),
        ("client_id", &config.xai_client_id),
    ];
    let response = client
        .post("https://auth.x.ai/oauth2/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("xAI auth returned HTTP {}", response.status()));
    }
    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(data["access_token"]
        .as_str()
        .unwrap_or_default()
        .to_string())
}

fn sanitize(value: &str) -> String {
    let mut output = value.to_string();
    for pattern in [
        r#"(?i)[A-Za-z0-9_]*(API|TOKEN|SECRET|PASSWORD|PASS|KEY)[A-Za-z0-9_]*\s*=\s*['"]?[^'"\s]+"#,
        r#"(?i)Bearer\s+[A-Za-z0-9._~+/=-]+"#,
        r#"sk-[A-Za-z0-9_-]{12,}"#,
    ] {
        output = Regex::new(pattern)
            .unwrap()
            .replace_all(&output, "<redacted>")
            .to_string();
    }
    output.chars().take(14_000).collect()
}

fn polish_summary(raw: &str, context: &serde_json::Value) -> String {
    let mut parsed = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for line in raw.lines() {
        let Some((session, text)) = parse_summary_line(line) else {
            continue;
        };
        let text = clean_summary_text(&text);
        let key = summary_key(&text);
        if !key.is_empty() {
            *counts.entry(key.clone()).or_insert(0) += 1;
        }
        parsed.push((session, text, key));
    }
    if parsed.is_empty() {
        return local_text(context);
    }
    parsed
        .into_iter()
        .map(|(session, text, key)| {
            let repeated = !key.is_empty() && counts.get(&key).copied().unwrap_or(0) > 1;
            let replacement = if text.is_empty() || repeated || is_generic_summary(&text) {
                pane_fallback(&session, context).unwrap_or_else(|| text.clone())
            } else {
                text.clone()
            };
            format!(
                "{session}: {}",
                replacement.chars().take(320).collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_summary_line(line: &str) -> Option<(String, String)> {
    let cleaned = line
        .trim()
        .trim_start_matches(|c| matches!(c, '-' | '*' | '•'))
        .trim()
        .replace("**", "")
        .replace('`', "");
    let (session, text) = cleaned.split_once(':')?;
    let session = session.trim();
    if session.is_empty() {
        return None;
    }
    Some((session.to_string(), text.trim().to_string()))
}

fn clean_summary_text(text: &str) -> String {
    let mut out = text.trim().trim_matches('.').trim().to_string();
    loop {
        let next = strip_stock_lead(&out);
        if next == out {
            break;
        }
        out = next;
    }
    out
}

fn strip_stock_lead(text: &str) -> String {
    let lower = text.to_lowercase();
    let filler = [
        "is ",
        "are ",
        "was ",
        "were ",
        "still ",
        "currently ",
        "appears to be ",
        "seems to be ",
        "looks like ",
        "continues ",
        "continuing ",
    ];
    for prefix in filler {
        if lower.starts_with(prefix) {
            return text[prefix.len()..]
                .trim()
                .trim_matches('.')
                .trim()
                .to_string();
        }
    }

    for action in [
        "working on ",
        "working through ",
        "reviewing ",
        "checking ",
        "monitoring ",
        "looking at ",
        "investigating ",
        "handling ",
        "dealing with ",
    ] {
        if lower.starts_with(action) {
            return text[action.len()..]
                .trim()
                .trim_matches('.')
                .trim()
                .to_string();
        }
    }

    text.to_string()
}

fn summary_key(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn is_generic_summary(text: &str) -> bool {
    let lower = text.to_lowercase();
    let words = lower.split_whitespace().count();
    words < 3
        || is_status_label(&lower)
        || (content_signal_score(text) < 2 && generic_word_ratio(&lower) > 0.55)
}

fn pane_fallback(session: &str, context: &serde_json::Value) -> Option<String> {
    let panes = context["panes"].as_array()?;
    let pane = panes
        .iter()
        .find(|pane| pane["session"].as_str() == Some(session))?;
    let command = pane["command"].as_str().unwrap_or("shell");
    let cwd = short_path(pane["cwd"].as_str().unwrap_or("~"));
    let last = last_meaningful_line(pane["tail"].as_str().unwrap_or_default());
    if last.is_empty() {
        Some(format!("{command} in {cwd}"))
    } else {
        Some(format!("{command} in {cwd}: {last}"))
    }
}

fn short_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    trimmed
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(trimmed)
        .chars()
        .take(48)
        .collect()
}

fn local_summary(context: &serde_json::Value, provider: &str, note: Option<String>) -> WorkSummary {
    let mut summary = local_text(context);
    if let Some(note) = note {
        summary.push_str("\n\n");
        summary.push_str(&note);
    }
    WorkSummary {
        provider: provider.to_string(),
        summary,
        generated_at: context["generatedAt"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    }
}

fn local_text(context: &serde_json::Value) -> String {
    let sessions = context["sessions"].as_array().cloned().unwrap_or_default();
    let live: Vec<String> = sessions
        .iter()
        .filter(|s| s["running"].as_bool().unwrap_or(false))
        .filter_map(|s| s["name"].as_str().map(str::to_string))
        .collect();
    let panes = context["panes"].as_array().cloned().unwrap_or_default();
    let pane_lines: Vec<String> = panes
        .iter()
        .map(|p| {
            let last = last_meaningful_line(p["tail"].as_str().unwrap_or_default());
            format!(
                "**{}** — {} · {}{}",
                p["session"].as_str().unwrap_or("?"),
                p["command"].as_str().unwrap_or("shell"),
                p["cwd"].as_str().unwrap_or("~"),
                if last.is_empty() {
                    String::new()
                } else {
                    format!("\n  {last}")
                }
            )
        })
        .collect();
    format!(
        "**{} shells active:** {}\n\n{}",
        live.len(),
        if live.is_empty() {
            "none".to_string()
        } else {
            live.join(", ")
        },
        if pane_lines.is_empty() {
            "No pane context was available yet.".to_string()
        } else {
            pane_lines.join("\n")
        }
    )
}

// Pick the last line that carries real content, ignoring blank lines and TUI chrome
// (box-drawing borders, spinners, prompt glyphs) so the local summary reads cleanly.
fn last_meaningful_line(tail: &str) -> String {
    let mut fallback = String::new();
    for line in tail.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if is_tui_chrome_line(trimmed) {
            continue;
        }
        if !trimmed.chars().any(|c| c.is_alphanumeric()) {
            continue;
        }
        let cleaned: String = trimmed.chars().filter(|c| !is_box_glyph(*c)).collect();
        let cleaned = cleaned.trim();
        if cleaned.chars().any(|c| c.is_alphanumeric()) {
            if content_signal_score(cleaned) >= 2 {
                return cleaned.chars().take(160).collect();
            }
            if fallback.is_empty() {
                fallback = cleaned.chars().take(160).collect();
            }
        }
    }
    fallback
}

fn is_tui_chrome_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    let signal = content_signal_score(line);
    lower == "^c"
        || looks_like_rating_prompt(&lower)
        || looks_like_keyboard_hint(&lower)
        || looks_like_template_hint(&lower)
        || looks_like_model_status(&lower)
        || looks_like_permission_mode_status(&lower)
        || looks_like_duration_only_status(&lower)
        || (looks_like_tool_tip(&lower) && signal < 2)
        || (is_status_label(&lower) && signal < 2)
}

fn content_signal_score(text: &str) -> i32 {
    let lower = text.to_lowercase();
    let mut score = 0;

    if lower.contains("/home/")
        || lower.contains("./")
        || lower.contains("../")
        || lower.contains("http://")
        || lower.contains("https://")
    {
        score += 2;
    }
    if has_file_or_config_token(&lower) {
        score += 2;
    }
    if has_command_token(&lower) {
        score += 2;
    }
    if has_work_signal(&lower) {
        score += 2;
    }
    if lower.contains('-') || lower.contains('_') || lower.contains('/') {
        score += 1;
    }
    if lower.chars().any(|c| c.is_ascii_digit()) && !looks_like_duration_only_status(&lower) {
        score += 1;
    }

    score
}

fn has_file_or_config_token(lower: &str) -> bool {
    lower
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | ')' | '(' | '[' | ']'))
        .any(|word| {
            word.contains('.')
                && [
                    ".rs", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".toml", ".yaml", ".yml",
                    ".css", ".html", ".py", ".go", ".sh", ".lock",
                ]
                .iter()
                .any(|ext| word.ends_with(ext))
        })
        || [
            "cargo.toml",
            "package.json",
            "bun.lock",
            "dockerfile",
            "readme",
            "agents.md",
        ]
        .iter()
        .any(|token| lower.contains(token))
}

fn has_command_token(lower: &str) -> bool {
    [
        "cargo",
        "bun",
        "npm",
        "pnpm",
        "node",
        "git",
        "docker",
        "podman",
        "tmux",
        "curl",
        "ssh",
        "pytest",
        "vitest",
        "wrangler",
        "systemctl",
        "journalctl",
        "codex",
        "claude",
        "grok",
        "opencode",
    ]
    .iter()
    .any(|cmd| {
        lower
            .split_whitespace()
            .any(|word| word.trim_matches(':') == *cmd)
    })
}

fn has_work_signal(lower: &str) -> bool {
    [
        "error",
        "failed",
        "failure",
        "panic",
        "exception",
        "test",
        "build",
        "lint",
        "format",
        "deploy",
        "route",
        "endpoint",
        "api",
        "component",
        "service",
        "container",
        "cache",
        "auth",
        "login",
        "token",
        "diff",
        "patch",
        "commit",
        "branch",
        "pr",
        "issue",
        "bug",
        "fix",
        "refactor",
        "summary",
        "prompt",
        "worker",
        "dashboard",
        "shelldeck",
    ]
    .iter()
    .any(|token| lower.contains(token))
}

fn generic_word_ratio(lower: &str) -> f32 {
    let mut total = 0_u32;
    let mut generic = 0_u32;
    for word in lower
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
    {
        if word.is_empty() {
            continue;
        }
        total += 1;
        if [
            "the",
            "a",
            "an",
            "this",
            "that",
            "current",
            "recent",
            "session",
            "task",
            "work",
            "working",
            "continuing",
            "checking",
            "reviewing",
            "monitoring",
            "appears",
            "seems",
            "looks",
            "ready",
            "input",
            "context",
            "activity",
            "same",
            "clear",
            "specific",
            "morning",
        ]
        .contains(&word)
        {
            generic += 1;
        }
    }
    if total == 0 {
        return 1.0;
    }
    generic as f32 / total as f32
}

fn looks_like_rating_prompt(lower: &str) -> bool {
    lower.contains("how is ") && lower.contains(" doing this session")
}

fn looks_like_keyboard_hint(lower: &str) -> bool {
    let has_key = ["esc", "ctrl", "shift", "tab", "enter", "return"]
        .iter()
        .any(|key| lower.contains(key));
    let has_action = [
        "interrupt",
        "cycle",
        "quit",
        "submit",
        "send",
        "paste",
        "close",
    ]
    .iter()
    .any(|action| lower.contains(action));
    has_key && has_action
}

fn looks_like_template_hint(lower: &str) -> bool {
    lower.contains("@filename")
        || lower.contains("<filename>")
        || lower.contains("{filename}")
        || lower.contains("placeholder")
}

fn looks_like_model_status(lower: &str) -> bool {
    let has_model = [
        "opus", "sonnet", "haiku", "gpt-", "claude", "codex", "grok", "gemini", "qwen",
    ]
    .iter()
    .any(|model| lower.starts_with(model) || lower.contains(&format!(" {model}")));
    let has_metric = lower.contains("ctx")
        || lower.contains("context")
        || lower.contains("tokens")
        || lower.contains("model:")
        || lower.contains("cost:")
        || lower.contains("xhigh")
        || lower.contains("high effort")
        || lower.contains('%');
    let mostly_status = has_metric && content_signal_score_without_ui_status(lower) < 2;
    has_model && (has_metric || lower.contains('·') || lower.ends_with('~')) || mostly_status
}

fn looks_like_permission_mode_status(lower: &str) -> bool {
    lower.contains("permission")
        && [" on", " off", "bypass", "mode", "agents"]
            .iter()
            .any(|marker| lower.contains(marker))
        && content_signal_score_without_ui_status(lower) < 2
}

fn looks_like_duration_only_status(lower: &str) -> bool {
    let has_duration = Regex::new(r"\b\d+\s*(ms|s|sec|secs|m|min|mins|h|hr|hrs)\b")
        .map(|re| re.is_match(lower))
        .unwrap_or(false);
    has_duration
        && [
            "worked for",
            "running for",
            "crunched for",
            "elapsed",
            "took ",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
        && content_signal_score_without_duration(lower) < 2
}

fn content_signal_score_without_duration(text: &str) -> i32 {
    let scrubbed = Regex::new(r"\b\d+\s*(ms|s|sec|secs|m|min|mins|h|hr|hrs)\b")
        .map(|re| re.replace_all(text, "").to_string())
        .unwrap_or_else(|_| text.to_string());
    let lower = scrubbed.to_lowercase();
    let mut score = 0;
    if has_file_or_config_token(&lower) {
        score += 2;
    }
    if has_command_token(&lower) {
        score += 2;
    }
    if has_work_signal(&lower) {
        score += 2;
    }
    score
}

fn looks_like_tool_tip(lower: &str) -> bool {
    lower.starts_with("tip:")
        || lower.contains(" use /")
        || lower.starts_with("use /")
        || lower.contains("press /")
        || (has_slash_command(lower)
            && ["save", "tokens", "ask", "type", "new task", "clear"]
                .iter()
                .any(|marker| lower.contains(marker)))
}

fn has_slash_command(lower: &str) -> bool {
    Regex::new(r"/[a-z][a-z0-9_-]+")
        .map(|re| re.is_match(lower))
        .unwrap_or(false)
}

fn content_signal_score_without_ui_status(text: &str) -> i32 {
    let scrubbed = Regex::new(
        r"(?i)\b(ctx|context|tokens?|model|cost|xhigh|effort|permissions?|bypass|agents?|shells?|on|off|over)\b|[·←~…]",
    )
    .map(|re| re.replace_all(text, "").to_string())
    .unwrap_or_else(|_| text.to_string());
    content_signal_score_without_duration(&scrubbed)
}

fn is_status_label(lower: &str) -> bool {
    let trimmed = lower
        .trim()
        .trim_matches(|c: char| matches!(c, '.' | ':' | '-' | '—'));
    matches!(
        trimmed,
        "idle" | "waiting" | "awaiting input" | "ready for input" | "running" | "finished" | "done"
    ) || trimmed.starts_with("waiting for ")
        || trimmed.starts_with("awaiting ")
}

fn is_box_glyph(c: char) -> bool {
    matches!(
        c,
        '─' | '│'
            | '┌'
            | '┐'
            | '└'
            | '┘'
            | '├'
            | '┤'
            | '┬'
            | '┴'
            | '┼'
            | '╭'
            | '╮'
            | '╯'
            | '╰'
            | '═'
            | '║'
            | '╔'
            | '╗'
            | '╚'
            | '╝'
            | '▌'
            | '▐'
            | '█'
            | '▏'
            | '▕'
            | '•'
            | '❯'
            | '❮'
            | '»'
            | '«'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_polish_strips_stock_prefixes() {
        let context = serde_json::json!({ "generatedAt": "now", "sessions": [], "panes": [] });
        let out = polish_summary("main: Working on the ShellDeck container panel.", &context);
        assert_eq!(out, "main: the ShellDeck container panel");
    }

    #[test]
    fn summary_polish_replaces_repeated_generic_lines() {
        let context = serde_json::json!({
            "generatedAt": "now",
            "sessions": [],
            "panes": [
                { "session": "main", "command": "codex", "cwd": "/home/falk/repos/shelldeck", "tail": "cargo test failed in summary.rs" },
                { "session": "slot1", "command": "zsh", "cwd": "/home/falk/repos/autonomy-news", "tail": "npm run build completed" }
            ]
        });
        let out = polish_summary("main: current task\nslot1: current task", &context);
        assert!(out.contains("main: codex in shelldeck: cargo test failed in summary.rs"));
        assert!(out.contains("slot1: zsh in autonomy-news: npm run build completed"));
        assert!(!out.contains("current task"));
    }

    #[test]
    fn chrome_filter_uses_categories_not_stock_sentences() {
        assert!(is_tui_chrome_line(
            "Tip: Use /btw to ask a quick side question"
        ));
        assert!(is_tui_chrome_line("Opus 4.8 | ctx 65% | 5u 82% over"));
        assert!(is_tui_chrome_line("gpt-5.5 xhigh · ~"));
        assert!(is_tui_chrome_line("Bypass permissions on · 1 shell"));
        assert!(is_tui_chrome_line("Worked for 21m 56s"));
        assert!(is_tui_chrome_line("Find and fix a bug in @filename"));
        assert!(is_tui_chrome_line("new task? /clear to save 336.2k tokens"));

        assert!(!is_tui_chrome_line("cargo test failed in src/summary.rs"));
        assert!(!is_tui_chrome_line(
            "Docker container route summary endpoint failing"
        ));
    }

    #[test]
    fn generic_summary_detection_keeps_concrete_topics() {
        assert!(is_generic_summary("recent session context"));
        assert!(!is_generic_summary(
            "summary.rs chrome filter failing cargo test"
        ));
        assert!(!is_generic_summary("running Docker containers panel"));
    }
}
