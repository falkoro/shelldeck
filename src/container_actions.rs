// Mutating container actions (restart / pull-latest) for the dashboard, run locally via `sh -c`
// or on a remote host via SSH stdin (`sh -s`). Names and engines are strictly validated before
// they ever reach a shell, so there is nothing to inject. These endpoints are login + shell-unlock
// + action-header gated in routes.rs.

use std::time::Duration;
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

// docker/podman names: first char alphanumeric, then [A-Za-z0-9_.-]. This charset has no shell
// metacharacters, so a validated name is safe to splice into a shell command.
pub fn clean_name(raw: &str) -> Option<String> {
    let name: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        .take(64)
        .collect();
    let starts_ok = name
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric());
    (starts_ok && name.len() == raw.trim().len()).then_some(name)
}

pub fn engine_ok(engine: &str) -> bool {
    matches!(engine, "docker" | "podman")
}

// Pull-latest: if the container is compose-managed (has project labels) pull + recreate that
// service; otherwise pull the image and restart (a plain `docker run` container can't be recreated
// without its original args, so we at least fetch the new image and bounce it).
const PULL_TEMPLATE: &str = r#"set -e
ENG=__ENGINE__
NAME=__NAME__
proj=$($ENG inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$NAME" 2>/dev/null || true)
svc=$($ENG inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "$NAME" 2>/dev/null || true)
dir=$($ENG inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$NAME" 2>/dev/null || true)
img=$($ENG inspect -f '{{ .Config.Image }}' "$NAME" 2>/dev/null || true)
if [ -n "$proj" ] && [ -n "$svc" ]; then
  [ -n "$dir" ] && cd "$dir" 2>/dev/null || true
  $ENG compose -f "$proj" pull "$svc" && $ENG compose -f "$proj" up -d "$svc" && echo "pulled + recreated $NAME ($svc)"
else
  $ENG pull "$img" && $ENG restart "$NAME" && echo "pulled $img + restarted $NAME (not compose-managed)"
fi
"#;

// Returns (script, timeout_ms) for the action, or None for an unknown action.
fn action_script(engine: &str, name: &str, action: &str) -> Option<(String, u64)> {
    match action {
        "restart" => Some((format!("{engine} restart {name} && echo \"restarted {name}\"\n"), 30_000)),
        "pull" => Some((
            PULL_TEMPLATE
                .replace("__ENGINE__", engine)
                .replace("__NAME__", name),
            // image pulls can be slow.
            240_000,
        )),
        _ => None,
    }
}

fn validate(engine: &str, name: &str, action: &str) -> Result<(String, u64), String> {
    if !engine_ok(engine) {
        return Err("Unknown container engine".to_string());
    }
    let name = clean_name(name).ok_or_else(|| "Invalid container name".to_string())?;
    action_script(engine, &name, action).ok_or_else(|| "Unknown action".to_string())
}

fn finish(stdout: &[u8], stderr: &[u8], ok: bool, fallback: &str) -> Result<String, String> {
    let pick = |bytes: &[u8]| {
        String::from_utf8_lossy(bytes)
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .chars()
            .filter(|c| !c.is_control())
            .take(200)
            .collect::<String>()
    };
    if ok {
        let msg = pick(stdout);
        Ok(if msg.is_empty() {
            fallback.to_string()
        } else {
            msg
        })
    } else {
        let err = pick(stderr);
        Err(if err.is_empty() {
            "Command failed".to_string()
        } else {
            err
        })
    }
}

// Run an action against a container on the ShellDeck host itself.
pub async fn local(engine: &str, name: &str, action: &str) -> Result<String, String> {
    let (script, budget) = validate(engine, name, action)?;
    let mut command = Command::new("sh");
    command.args(["-c", script.as_str()]).kill_on_drop(true);
    let output = timeout(Duration::from_millis(budget), command.output())
        .await
        .map_err(|_| "Action timed out".to_string())?
        .map_err(|_| "Could not run the action".to_string())?;
    finish(
        &output.stdout,
        &output.stderr,
        output.status.success(),
        "done",
    )
}

// Run an action against a container on a remote host, feeding the script over SSH stdin.
pub async fn remote(
    target: &str,
    engine: &str,
    name: &str,
    action: &str,
) -> Result<String, String> {
    let (script, budget) = validate(engine, name, action)?;
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
        .map_err(|_| "Could not start SSH".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes()).await;
    }
    let output = timeout(Duration::from_millis(budget), child.wait_with_output())
        .await
        .map_err(|_| "Action timed out".to_string())?
        .map_err(|_| "SSH failed".to_string())?;
    finish(
        &output.stdout,
        &output.stderr,
        output.status.success(),
        "done",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_names_and_engines() {
        assert!(clean_name("memoh-server").is_some());
        assert!(clean_name("ig-yente-api").is_some());
        assert!(clean_name("a b").is_none()); // space
        assert!(clean_name("$(rm -rf /)").is_none()); // injection
        assert!(clean_name("-bad").is_none()); // leading dash
        assert!(clean_name("").is_none());
        assert!(engine_ok("docker"));
        assert!(!engine_ok("sh"));
    }

    #[test]
    fn builds_scripts_and_rejects_unknown_action() {
        let (restart, _) = validate("docker", "glances", "restart").unwrap();
        assert!(restart.contains("docker restart glances"));
        let (pull, ms) = validate("docker", "glances", "pull").unwrap();
        assert!(pull.contains("compose -f") && pull.contains("glances"));
        assert!(ms > 60_000);
        assert!(validate("docker", "glances", "delete").is_err());
        assert!(validate("evil", "glances", "restart").is_err());
    }
}
