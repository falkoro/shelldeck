use crate::image_versions;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};
use tokio::{process::Command, time::timeout};

#[derive(Serialize)]
pub struct ContainerInfo {
    pub engine: String,
    pub name: String,
    pub image: String,
    // Carries the running state ("Up 2 hours (healthy)", "Exited (0) 3 min ago", ...) since we
    // now list with `ps -a` — the frontend derives running/stopped/unhealthy from this.
    pub status: String,
    // Live CPU% / mem from `stats --no-stream`, only present for running containers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mem: Option<String>,
    // Container start time (RFC3339 from .State.StartedAt) for precise uptime.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started: Option<String>,
    // Image's org.opencontainers.image.description label, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    // Best-effort registry version state for semver-tagged Docker Hub images.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<image_versions::ContainerVersionInfo>,
}

// `name\tStartedAt\tdescription` rows from `inspect` → name -> (started, desc). Container names
// from inspect have a leading '/'. Empty fields stay None.
pub(crate) fn parse_inspect(
    raw: &str,
) -> std::collections::HashMap<String, (Option<String>, Option<String>)> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let name = parts.next()?.trim().trim_start_matches('/').to_string();
            if name.is_empty() {
                return None;
            }
            let started = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty() && *s != "0001-01-01T00:00:00Z")
                .map(str::to_string);
            let desc = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            Some((name, (started, desc)))
        })
        .collect()
}

// inspect `--format` template shared by local and remote: name, StartedAt, description label,
// tab-separated (real \t). Empty description renders as an empty field.
pub(crate) const INSPECT_FORMAT: &str =
    "{{.Name}}\t{{.State.StartedAt}}\t{{with index .Config.Labels \"org.opencontainers.image.description\"}}{{.}}{{end}}";

#[derive(Serialize)]
pub struct ContainerList {
    pub containers: Vec<ContainerInfo>,
}

async fn run_engine(engine: &str, args: &[&str], ms: u64) -> Option<String> {
    let mut command = Command::new(engine);
    command.args(args).kill_on_drop(true);
    let output = timeout(Duration::from_millis(ms), command.output())
        .await
        .ok()?
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

// `{{.Names}}\t{{.Image}}\t{{.Status}}` rows from `ps -a`.
pub(crate) fn parse_ps(engine: &str, raw: &str) -> Vec<ContainerInfo> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let name = parts.next()?.trim();
            let image = parts.next()?.trim();
            let status = parts.next()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(ContainerInfo {
                engine: engine.to_string(),
                name: name.to_string(),
                image: image.to_string(),
                status: status.to_string(),
                cpu: None,
                mem: None,
                started: None,
                desc: None,
                version: None,
            })
        })
        .collect()
}

// Attach StartedAt + description from an inspect map onto matching containers (by name).
pub(crate) fn attach_inspect(
    list: &mut [ContainerInfo],
    inspect: &HashMap<String, (Option<String>, Option<String>)>,
) {
    for container in list.iter_mut() {
        if let Some((started, desc)) = inspect.get(&container.name) {
            if container.started.is_none() {
                container.started = started.clone();
            }
            if container.desc.is_none() {
                container.desc = desc.clone();
            }
        }
    }
}

// `{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}` rows from `stats --no-stream` → name -> (cpu, mem).
pub(crate) fn parse_stats(raw: &str) -> HashMap<String, (String, String)> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let name = parts.next()?.trim().to_string();
            let cpu = parts.next()?.trim().to_string();
            let mem = parts.next()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some((name, (cpu, mem)))
        })
        .collect()
}

// Attach CPU/mem from a stats map onto the matching containers (by name).
pub(crate) fn attach_stats(list: &mut [ContainerInfo], stats: &HashMap<String, (String, String)>) {
    for container in list.iter_mut() {
        if let Some((cpu, mem)) = stats.get(&container.name) {
            container.cpu = Some(cpu.clone());
            container.mem = Some(mem.clone());
        }
    }
}

async fn engine_containers(engine: &str) -> Vec<ContainerInfo> {
    let Some(ps) = run_engine(
        engine,
        &[
            "ps",
            "-a",
            "--format",
            "{{.Names}}\t{{.Image}}\t{{.Status}}",
        ],
        1500,
    )
    .await
    else {
        return Vec::new();
    };
    let mut list = parse_ps(engine, &ps);
    // stats only reports running containers and is the slow call — give it more headroom.
    if let Some(raw) = run_engine(
        engine,
        &[
            "stats",
            "--no-stream",
            "--format",
            "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}",
        ],
        4000,
    )
    .await
    {
        attach_stats(&mut list, &parse_stats(&raw));
    }
    // One inspect over all containers for StartedAt + description label. Needs a shell for the
    // `$(... ps -aq)` substitution; engine is validated to docker/podman so it's injection-safe.
    if matches!(engine, "docker" | "podman") {
        let script =
            format!("{engine} inspect --format '{INSPECT_FORMAT}' $({engine} ps -aq) 2>/dev/null");
        let mut command = Command::new("sh");
        command.args(["-c", &script]).kill_on_drop(true);
        if let Ok(Ok(output)) = timeout(Duration::from_millis(2500), command.output()).await {
            if output.status.success() {
                attach_inspect(
                    &mut list,
                    &parse_inspect(&String::from_utf8_lossy(&output.stdout)),
                );
            }
        }
    }
    list
}

pub async fn running() -> ContainerList {
    let (mut docker, mut podman) =
        tokio::join!(engine_containers("docker"), engine_containers("podman"));
    docker.append(&mut podman);
    docker.sort_by(|a, b| a.engine.cmp(&b.engine).then(a.name.cmp(&b.name)));
    let mut seen = HashSet::new();
    docker.retain(|container| seen.insert((container.engine.clone(), container.name.clone())));
    docker.truncate(64);
    image_versions::annotate(&mut docker).await;
    ContainerList { containers: docker }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ps_parses_and_stats_attach_by_name() {
        let mut list = parse_ps(
            "docker",
            "web\tnginx:1\tUp 2 hours (healthy)\ndb\tpg:16\tExited (0) 5 minutes ago\n",
        );
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].status, "Exited (0) 5 minutes ago");
        let stats = parse_stats("web\t12.50%\t128MiB / 4GiB\nghost\t1%\t1MiB / 1GiB\n");
        attach_stats(&mut list, &stats);
        assert_eq!(list[0].cpu.as_deref(), Some("12.50%"));
        assert_eq!(list[0].mem.as_deref(), Some("128MiB / 4GiB"));
        // stopped container has no stats row → stays None
        assert!(list[1].cpu.is_none());
    }
}
