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
    // Short image digest (12 hex, no "sha256:") the container is actually running.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_id: Option<String>,
    // RFC3339 build time of the running image (image .Created).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub built: Option<String>,
}

// "sha256:abcdef0123..." (or bare hex) -> first 12 hex chars; short ids pass through unchanged.
pub(crate) fn short_image_id(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("sha256:")
        .chars()
        .take(12)
        .collect()
}

// `name\tStartedAt\timageId\tdescription` rows from `inspect` -> name -> (started, desc, image_id).
// Container names from inspect have a leading '/'. Empty fields stay None.
pub(crate) fn parse_inspect(
    raw: &str,
) -> std::collections::HashMap<String, (Option<String>, Option<String>, Option<String>)> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let name = parts.next()?.trim().trim_start_matches('/').to_string();
            if name.is_empty() {
                return None;
            }
            let started = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty() && *s != "0001-01-01T00:00:00Z")
                .map(str::to_string);
            let image_id = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(short_image_id);
            let desc = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            Some((name, (started, desc, image_id)))
        })
        .collect()
}

// inspect `--format` template shared by local and remote: name, StartedAt, image id, description
// label, tab-separated (real \t). Empty description renders as an empty field.
pub(crate) const INSPECT_FORMAT: &str =
    "{{.Name}}\t{{.State.StartedAt}}\t{{.Image}}\t{{with index .Config.Labels \"org.opencontainers.image.description\"}}{{.}}{{end}}";

// `image inspect` format: full image id + RFC3339 build time.
const IMAGE_INSPECT_FORMAT: &str = "{{.Id}}\t{{.Created}}";

// short image id -> RFC3339 build time, from `<engine> image inspect` over every local image.
pub(crate) fn parse_image_built(raw: &str) -> HashMap<String, String> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let id = short_image_id(parts.next()?);
            let created = parts.next()?.trim();
            if id.is_empty() || created.is_empty() {
                return None;
            }
            Some((id, created.to_string()))
        })
        .collect()
}

// Attach the image build time onto containers by matching their short image id.
pub(crate) fn attach_built(list: &mut [ContainerInfo], built: &HashMap<String, String>) {
    for container in list.iter_mut() {
        if container.built.is_some() {
            continue;
        }
        if let Some(id) = &container.image_id {
            if let Some(ts) = built.get(id) {
                container.built = Some(ts.clone());
            }
        }
    }
}

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
                image_id: None,
                built: None,
            })
        })
        .collect()
}

// Attach StartedAt + description + image_id from an inspect map onto matching containers (by name).
pub(crate) fn attach_inspect(
    list: &mut [ContainerInfo],
    inspect: &HashMap<String, (Option<String>, Option<String>, Option<String>)>,
) {
    for container in list.iter_mut() {
        if let Some((started, desc, image_id)) = inspect.get(&container.name) {
            if container.started.is_none() {
                container.started = started.clone();
            }
            if container.desc.is_none() {
                container.desc = desc.clone();
            }
            if container.image_id.is_none() {
                container.image_id = image_id.clone();
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

fn engine_preference(engine: &str) -> u8 {
    match engine {
        // On Arch/CachyOS, docker can be a Podman compatibility CLI. Prefer the native name when
        // both commands report the same container.
        "podman" => 0,
        "docker" => 1,
        _ => 2,
    }
}

fn dedupe_key(
    container: &ContainerInfo,
) -> (String, String, String, Option<String>, Option<String>) {
    (
        container.name.clone(),
        container.image.clone(),
        container.status.clone(),
        container.started.clone(),
        container.image_id.clone(),
    )
}

pub(crate) fn dedupe_engine_aliases(containers: &mut Vec<ContainerInfo>) {
    containers.sort_by(|a, b| {
        dedupe_key(a)
            .cmp(&dedupe_key(b))
            .then(engine_preference(&a.engine).cmp(&engine_preference(&b.engine)))
    });
    let mut seen = HashSet::new();
    containers.retain(|container| seen.insert(dedupe_key(container)));
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
    // One inspect over all containers for StartedAt + description label + image id. Needs a shell
    // for the `$(... ps -aq)` substitution; engine is validated to docker/podman so it's
    // injection-safe.
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
    // One image-inspect over all local images for RFC3339 build time of the running image.
    if matches!(engine, "docker" | "podman") {
        let script = format!(
            "{engine} image inspect --format '{IMAGE_INSPECT_FORMAT}' $({engine} images -q 2>/dev/null | sort -u) 2>/dev/null"
        );
        let mut command = Command::new("sh");
        command.args(["-c", &script]).kill_on_drop(true);
        if let Ok(Ok(output)) = timeout(Duration::from_millis(2500), command.output()).await {
            if output.status.success() {
                attach_built(
                    &mut list,
                    &parse_image_built(&String::from_utf8_lossy(&output.stdout)),
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
    dedupe_engine_aliases(&mut docker);
    docker.sort_by(|a, b| a.engine.cmp(&b.engine).then(a.name.cmp(&b.name)));
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
        // stopped container has no stats row -> stays None
        assert!(list[1].cpu.is_none());
    }

    #[test]
    fn parses_image_built_and_inspect_with_image_id() {
        let inspect =
            parse_inspect("/web\t2026-06-01T10:00:00Z\tsha256:abc123def4567890\tThe web app\n");
        let row = inspect.get("web").unwrap();
        assert_eq!(row.0.as_deref(), Some("2026-06-01T10:00:00Z"));
        assert_eq!(row.1.as_deref(), Some("The web app"));
        assert_eq!(row.2.as_deref(), Some("abc123def456"));
        let built = parse_image_built("sha256:abc123def4567890\t2026-05-30T08:00:00Z\n");
        assert_eq!(
            built.get("abc123def456").map(String::as_str),
            Some("2026-05-30T08:00:00Z")
        );
    }

    #[test]
    fn dedupes_podman_docker_alias_rows() {
        let mut list = vec![
            ContainerInfo {
                engine: "docker".to_string(),
                name: "web".to_string(),
                image: "nginx:alpine".to_string(),
                status: "Up 2 hours".to_string(),
                cpu: Some("1%".to_string()),
                mem: Some("10MiB / 1GiB".to_string()),
                started: Some("2026-06-01T10:00:00Z".to_string()),
                desc: None,
                version: None,
                image_id: Some("abc123def456".to_string()),
                built: None,
            },
            ContainerInfo {
                engine: "podman".to_string(),
                name: "web".to_string(),
                image: "nginx:alpine".to_string(),
                status: "Up 2 hours".to_string(),
                cpu: Some("1%".to_string()),
                mem: Some("10MiB / 1GiB".to_string()),
                started: Some("2026-06-01T10:00:00Z".to_string()),
                desc: None,
                version: None,
                image_id: Some("abc123def456".to_string()),
                built: None,
            },
        ];
        dedupe_engine_aliases(&mut list);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].engine, "podman");
    }
}
