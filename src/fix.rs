use crate::{
    config::{clean_remote_target, Config},
    container_actions::{clean_name, engine_ok},
    dynamic_sessions, fix_agents, remote_hosts, tmux,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Arc, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};
#[derive(Deserialize)]
pub struct FixBody {
    pub host: String,
    pub target: String,
    pub engine: String,
    pub name: String,
    pub agent_id: String,
}

#[derive(Serialize)]
pub struct FixStarted {
    pub session: String,
    pub mode: String,
    pub message: String,
}

pub async fn start(config: Arc<Config>, body: FixBody) -> Result<FixStarted, String> {
    if !engine_ok(&body.engine) {
        return Err("Unknown container engine".to_string());
    }
    let name = clean_name(&body.name).ok_or_else(|| "Invalid container name".to_string())?;
    let agents = fix_agents::load(config.clone()).await;
    let agent = agents
        .into_iter()
        .find(|agent| agent.id == body.agent_id)
        .ok_or_else(|| "Unknown fix agent".to_string())?;
    let hosts = remote_hosts::load(config.clone()).await;
    let requested_host = body.host.trim();
    let raw_target = body.target.trim();
    let matched = hosts.iter().find(|h| {
        h.id == requested_host
            || h.label == requested_host
            || (!raw_target.is_empty() && h.target == raw_target)
    });
    let target = if raw_target.is_empty() {
        if requested_host.is_empty() {
            String::new()
        } else {
            matched
                .map(|host| host.target.clone())
                .ok_or_else(|| "Unknown remote host".to_string())?
        }
    } else {
        let clean = clean_remote_target(raw_target);
        if clean.is_empty() {
            return Err("Invalid SSH target".to_string());
        }
        clean
    };
    let host = hosts.iter().find(|h| {
        (!target.is_empty() && h.target == target)
            || h.id == requested_host
            || h.label == requested_host
    });
    let propose = host.is_some_and(|host| host.protected);
    let host_label = host
        .map(|host| host.label.clone())
        .or_else(|| (!requested_host.is_empty()).then(|| requested_host.to_string()))
        .unwrap_or_else(|| "local".to_string());
    let diagnostics = diagnostic(&target, &body.engine, &name).await?;
    let session = unique_session_name(config.clone(), &name).await?;
    let prompt = prompt_text(
        &name,
        &body.engine,
        &host_label,
        &target,
        &diagnostics,
        propose,
    );
    let prompt_path = write_prompt(config.clone(), &session, &prompt).await?;
    let start = start_command(&name, &target, propose, &agent.command, &prompt, &prompt_path);
    let entry = dynamic_sessions::new_entry(&session, &format!("Fix: {name}"), &start);
    tmux::create_dynamic_session(config, entry).await?;
    let mode = if propose { "propose" } else { "fix" };
    Ok(FixStarted {
        session: session.clone(),
        mode: mode.to_string(),
        message: format!("{session} started in {mode} mode"),
    })
}

fn diagnostic_script(engine: &str, name: &str) -> String {
    format!(
        "echo '## ps'\n{engine} ps -a --filter name=^/{name}$ --format '{{{{.Names}}}}\\t{{{{.Status}}}}\\t{{{{.Image}}}}' 2>/dev/null || true\n\
echo '## health'\n{engine} inspect -f 'State={{{{.State.Status}}}} Health={{{{with .State.Health}}}}{{{{.Status}}}}{{{{end}}}} ExitCode={{{{.State.ExitCode}}}} Restarts={{{{.RestartCount}}}}' {name} 2>/dev/null || true\n\
echo '## logs'\n{engine} logs --tail 200 {name} 2>&1 | tail -200 || true\n"
    )
}

async fn diagnostic(target: &str, engine: &str, name: &str) -> Result<String, String> {
    let script = diagnostic_script(engine, name);
    let output = if target.is_empty() {
        let mut command = Command::new("sh");
        command.args(["-c", script.as_str()]).kill_on_drop(true);
        timeout(Duration::from_millis(10_000), command.output())
            .await
            .map_err(|_| "Diagnostic timed out".to_string())?
            .map_err(|_| "Could not run diagnostic".to_string())?
    } else {
        let mut command = Command::new("ssh");
        command
            .args([
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=3",
                "-o",
                "NumberOfPasswordPrompts=0",
                target,
                "sh",
                "-s",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| "Could not start SSH diagnostic".to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(script.as_bytes()).await;
        }
        timeout(Duration::from_millis(10_000), child.wait_with_output())
            .await
            .map_err(|_| "Diagnostic timed out".to_string())?
            .map_err(|_| "SSH diagnostic failed".to_string())?
    };
    if !output.status.success() {
        return Err("Diagnostic command failed".to_string());
    }
    Ok(clean_output(&String::from_utf8_lossy(&output.stdout)))
}

fn clean_output(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(8_000)
        .collect()
}

fn prompt_text(
    name: &str,
    engine: &str,
    host_label: &str,
    target: &str,
    diagnostics: &str,
    propose: bool,
) -> String {
    let where_text = if target.is_empty() { "local".to_string() } else { target.to_string() };
    let act = if target.is_empty() {
        "Run remediation commands directly on this host.".to_string()
    } else {
        format!("To act on the host run `ssh {target} '<cmd>'`.")
    };
    let mode = if propose {
        format!("Host `{host_label}` is PROTECTED (production). Do NOT run ANY mutating command whatsoever. Inspect read-only, diagnose the root cause, and PRINT the exact commands you recommend a human run, with a one-line rationale each. Read-only only.")
    } else {
        format!("Container `{name}` (engine `{engine}`) on `{where_text}` is in a bad state. Diagnose the root cause from the diagnostics above and attempt a SAFE remediation - prefer `{engine} restart {name}`, fixing a bad env/config, or recreating via `{engine} compose up -d` for this service only. {act}\n\nYou are STRICTLY FORBIDDEN from destructive operations: do NOT run `rm`/`rmi`, `{engine} rm`, `{engine} compose down` (especially `-v`), `volume rm`/`volume prune`, `system prune`, `kill`, `reboot`/`shutdown`/`poweroff`, do NOT edit secret/.env files, and do NOT stop or touch ANY container other than `{name}`. Operate ONLY on `{name}`. Explain each command before you run it.")
    };
    format!("# ShellDeck Container Fix\n\nContainer: `{name}`\nEngine: `{engine}`\nHost: `{host_label}`\nSSH target: `{where_text}`\n\n## Diagnostics\n\n```text\n{diagnostics}\n```\n\n## Instructions\n\n{mode}\n")
}

async fn write_prompt(config: Arc<Config>, session: &str, prompt: &str) -> Result<String, String> {
    let dir = config.root_dir.join("fix-prompts");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!("{session}.md"));
    tokio::fs::write(&path, prompt)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn start_command(
    name: &str,
    target: &str,
    propose: bool,
    command: &str,
    prompt: &str,
    prompt_path: &str,
) -> String {
    let mode = if propose { "PROPOSE" } else { "FIX" };
    let where_text = if target.is_empty() { "local" } else { target };
    let prompt_file = shell_word(prompt_path);
    let launch = if command.contains("{promptfile}") {
        command.replace("{promptfile}", &prompt_file)
    } else if command.contains("{prompt}") {
        command.replace("{prompt}", &shell_word(prompt))
    } else {
        format!("{} \"$(cat {})\"", command.trim(), prompt_file)
    };
    let script = format!(
        "cd ~; echo {}; cat {}; exec {launch}",
        shell_word(&format!("ShellDeck fix - {name} on {where_text} ({mode} mode)")),
        prompt_file
    );
    format!("zsh -lic {}", shell_word(&script))
}

async fn unique_session_name(config: Arc<Config>, name: &str) -> Result<String, String> {
    let mut used: HashSet<String> = config
        .known_sessions
        .iter()
        .map(|session| session.name.clone())
        .collect();
    used.extend(tmux::session_names().await);
    used.extend(
        dynamic_sessions::load(config)
            .await
            .into_iter()
            .map(|session| session.name),
    );
    let stem = clean_session_stem(name);
    for n in 1..100 {
        let suffix = format!("-{n}");
        let cap = 40usize.saturating_sub(4 + suffix.len());
        let base: String = stem.chars().take(cap.max(1)).collect();
        let candidate = format!("fix-{base}{suffix}");
        if valid_session_name(&candidate) && !used.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err("Could not allocate a fix session".to_string())
}

fn clean_session_stem(raw: &str) -> String {
    let clean: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect();
    if clean.is_empty() { "container".to_string() } else { clean }
}

fn valid_session_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn shell_word(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_word_escapes_single_quotes() {
        assert_eq!(shell_word("plain"), "'plain'");
        assert_eq!(shell_word("a'b"), "'a'\"'\"'b'");
    }

    #[test]
    fn diagnostic_script_is_read_only() {
        let s = diagnostic_script("docker", "web");
        for bad in [" rm ", "rmi", "restart", " stop ", "compose down", "volume ", "prune", "kill"] {
            assert!(!s.contains(bad), "diagnostic must not contain `{bad}`");
        }
        assert!(s.contains("ps -a") && s.contains("inspect") && s.contains("logs --tail 200"));
    }

    #[test]
    fn default_branch_never_inlines_attacker_prompt() {
        // Container logs are attacker-influenced. With a seeded agent (no placeholder) the prompt
        // is read from the file via `"$(cat <path>)"`, so its bytes must never reach the shell.
        let evil = "x'; touch /tmp/pwn; echo '";
        let cmd = start_command("web", "", false, "claude", evil, "/root/fix-prompts/fix-web-1.md");
        assert!(cmd.starts_with("zsh -lic '"));
        assert!(!cmd.contains("touch /tmp/pwn"), "attacker prompt must not be inlined");
        assert!(cmd.contains("cat '"), "prompt is read from the quoted file path");
    }

    #[test]
    fn placeholder_branch_keeps_prompt_quoted() {
        // When the admin opts into {prompt}, the prompt is single-quote escaped, not raw.
        let cmd = start_command("web", "", false, "agent {prompt}", "a'b", "/p/x.md");
        assert!(cmd.contains("'\"'\"'"), "single quote in prompt must be escaped");
    }

    #[test]
    fn session_names_stay_in_charset() {
        assert!(valid_session_name("fix-web-1"));
        assert!(!valid_session_name("fix/../etc"));
        assert!(!valid_session_name(&"x".repeat(41)));
        assert_eq!(clean_session_stem("we/b;rm"), "webrm");
        assert_eq!(clean_session_stem("///"), "container");
    }
}
