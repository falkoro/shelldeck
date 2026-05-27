use crate::{config::Config, tmux};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::process::Command;

#[derive(Serialize)]
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

const SYSTEM_PROMPT: &str = "You are Hermes, a terse engineering-operations agent. You receive recent tmux pane captures for several sessions (main, slot1, …). For EACH session, write ONE short line naming WHAT it is working on — the current task or topic — judged from the most recent activity in its pane. Describe the work itself; do NOT label it busy/active/idle/waiting/finished (that running-vs-waiting status is shown separately by the dashboard, so never say 'idle' or 'awaiting input'). Ignore terminal chrome: status bars (context %, token counts, 'esc to interrupt', 'shift+tab to cycle', model name), the 'How is Claude doing this session' rating prompt, box-drawing borders, and greyed placeholder input hints. Format each line exactly as '<session>: <text>'. Never expose secrets. Keep the whole reply under 130 words.";

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
    let token = bearer_token(config.clone(), client.clone()).await.unwrap_or_default();
    if token.is_empty() {
        return local_summary(&context, "local", None);
    }
    let result = if config.xai_api_style.eq_ignore_ascii_case("anthropic") {
        chat_completion_anthropic(config.clone(), client, &token, &prompt).await
    } else {
        chat_completion(config.clone(), client, &token, &prompt).await
    };
    match result {
        Ok(summary) if !summary.is_empty() => WorkSummary { provider: format!("hermes:{}", config.xai_model), summary, generated_at: context["generatedAt"].as_str().unwrap_or_default().to_string() },
        Ok(_) => local_summary(&context, "local", None),
        Err(error) => local_summary(&context, "local", Some(format!("Summary failed: {error}"))),
    }
}

async fn collect_context(config: Arc<Config>) -> serde_json::Value {
    let model = tmux::session_model(config.clone(), false).await;
    let panes = tmux::list_panes().await;
    let known: Vec<String> = config.known_sessions.iter().map(|s| s.name.to_string()).collect();
    let mut captures = Vec::new();
    for pane in panes.into_iter().filter(|p| known.contains(&p.session)).take(8) {
        let tail = sanitize(&focus_recent(&tmux::capture_pane(&pane, 40).await));
        captures.push(serde_json::json!({ "session": pane.session, "cwd": pane.cwd, "command": pane.command, "tail": tail }));
    }
    serde_json::json!({
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "hostname": model.hostname,
        "user": model.user,
        "sessions": model.sessions.iter().map(|s| serde_json::json!({ "name": s.name, "running": s.running, "attached": s.attached, "activity": s.activity })).collect::<Vec<_>>(),
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
        .collect();
    let start = kept.len().saturating_sub(22);
    kept[start..].join("\n")
}

async fn shell_summary(config: Arc<Config>, prompt: &str, context: &serde_json::Value) -> WorkSummary {
    let output = Command::new("/usr/bin/bash")
        .args(["-lc", &config.summary_command])
        .env("SHELLDECK_CONTEXT", prompt)
        .output()
        .await;
    match output {
        Ok(out) if out.status.success() => {
            let summary = String::from_utf8_lossy(&out.stdout).trim().to_string();
            WorkSummary { provider: "hermes".to_string(), summary: if summary.is_empty() { local_text(context) } else { summary }, generated_at: context["generatedAt"].as_str().unwrap_or_default().to_string() }
        }
        Ok(out) => local_summary(context, "local", Some(format!("Hermes command failed: {}", String::from_utf8_lossy(&out.stderr).trim()))),
        Err(error) => local_summary(context, "local", Some(format!("Hermes command failed: {error}"))),
    }
}

async fn chat_completion(config: Arc<Config>, client: reqwest::Client, token: &str, prompt: &str) -> Result<String, String> {
    let request = ChatRequest {
        model: config.xai_model.clone(),
        messages: vec![
            ChatMessage { role: "system", content: SYSTEM_PROMPT.to_string() },
            ChatMessage { role: "user", content: prompt.to_string() },
        ],
        temperature: 0.2,
        max_tokens: 220,
    };
    let url = format!("{}/chat/completions", config.xai_base_url.trim_end_matches('/'));
    let response = client.post(&url).bearer_auth(token).json(&request).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Summary model returned HTTP {}", response.status()));
    }
    let parsed: ChatResponse = response.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.choices.first().map(|c| c.message.content.trim().to_string()).unwrap_or_default())
}

// SuperGrok via the Hermes bridge (Anthropic Messages API at {base}/messages). Concatenates
// the assistant's text blocks, discarding any "thinking" blocks the model emits.
async fn chat_completion_anthropic(config: Arc<Config>, client: reqwest::Client, token: &str, prompt: &str) -> Result<String, String> {
    let request = AnthropicRequest {
        model: config.xai_model.clone(),
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        temperature: 0.2,
        messages: vec![AnthropicMessage { role: "user", content: prompt.to_string() }],
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
    let text: String = parsed.content.iter().filter(|b| b.kind == "text").map(|b| b.text.as_str()).collect::<Vec<_>>().join("");
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
    if !access.is_empty() && (expires == 0 || chrono::Utc::now().timestamp_millis() + 300_000 < expires) {
        return Ok(access.to_string());
    }
    if refresh.is_empty() {
        return Ok(access.to_string());
    }
    refresh_token(config, client, refresh).await.or_else(|_| Ok(access.to_string()))
}

async fn refresh_token(config: Arc<Config>, client: reqwest::Client, refresh: &str) -> Result<String, String> {
    let params = [("grant_type", "refresh_token"), ("refresh_token", refresh), ("client_id", &config.xai_client_id)];
    let response = client.post("https://auth.x.ai/oauth2/token").form(&params).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("xAI auth returned HTTP {}", response.status()));
    }
    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(data["access_token"].as_str().unwrap_or_default().to_string())
}

fn sanitize(value: &str) -> String {
    let mut output = value.to_string();
    for pattern in [
        r#"(?i)[A-Za-z0-9_]*(API|TOKEN|SECRET|PASSWORD|PASS|KEY)[A-Za-z0-9_]*\s*=\s*['"]?[^'"\s]+"#,
        r#"(?i)Bearer\s+[A-Za-z0-9._~+/=-]+"#,
        r#"sk-[A-Za-z0-9_-]{12,}"#,
    ] {
        output = Regex::new(pattern).unwrap().replace_all(&output, "<redacted>").to_string();
    }
    output.chars().take(14_000).collect()
}

fn local_summary(context: &serde_json::Value, provider: &str, note: Option<String>) -> WorkSummary {
    let mut summary = local_text(context);
    if let Some(note) = note {
        summary.push_str("\n\n");
        summary.push_str(&note);
    }
    WorkSummary { provider: provider.to_string(), summary, generated_at: context["generatedAt"].as_str().unwrap_or_default().to_string() }
}

fn local_text(context: &serde_json::Value) -> String {
    let sessions = context["sessions"].as_array().cloned().unwrap_or_default();
    let live: Vec<String> = sessions.iter().filter(|s| s["running"].as_bool().unwrap_or(false)).filter_map(|s| s["name"].as_str().map(str::to_string)).collect();
    let panes = context["panes"].as_array().cloned().unwrap_or_default();
    let pane_lines: Vec<String> = panes.iter().map(|p| {
        let last = last_meaningful_line(p["tail"].as_str().unwrap_or_default());
        format!(
            "**{}** — {} · {}{}",
            p["session"].as_str().unwrap_or("?"),
            p["command"].as_str().unwrap_or("shell"),
            p["cwd"].as_str().unwrap_or("~"),
            if last.is_empty() { String::new() } else { format!("\n  {last}") }
        )
    }).collect();
    format!(
        "**{} shells active:** {}\n\n{}",
        live.len(),
        if live.is_empty() { "none".to_string() } else { live.join(", ") },
        if pane_lines.is_empty() { "No pane context was available yet.".to_string() } else { pane_lines.join("\n") }
    )
}

// Pick the last line that carries real content, ignoring blank lines and TUI chrome
// (box-drawing borders, spinners, prompt glyphs) so the local summary reads cleanly.
fn last_meaningful_line(tail: &str) -> String {
    for line in tail.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !trimmed.chars().any(|c| c.is_alphanumeric()) {
            continue;
        }
        let cleaned: String = trimmed.chars().filter(|c| !is_box_glyph(*c)).collect();
        let cleaned = cleaned.trim();
        if cleaned.chars().any(|c| c.is_alphanumeric()) {
            return cleaned.chars().take(120).collect();
        }
    }
    String::new()
}

fn is_box_glyph(c: char) -> bool {
    matches!(c, '─' | '│' | '┌' | '┐' | '└' | '┘' | '├' | '┤' | '┬' | '┴' | '┼' | '╭' | '╮' | '╯' | '╰' | '═' | '║' | '╔' | '╗' | '╚' | '╝' | '▌' | '▐' | '█' | '▏' | '▕' | '•' | '❯' | '❮' | '»' | '«')
}
