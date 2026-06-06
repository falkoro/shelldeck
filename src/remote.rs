use crate::{
    config::RemoteHostConfig,
    containers::{attach_built, attach_inspect, attach_stats, parse_image_built, parse_inspect, ContainerInfo},
    image_versions,
    remote_metrics::{self, RemoteMetrics, REMOTE_METRICS_SCRIPT},
};
use chrono::Utc;
use futures_util::future::join_all;
use serde::Serialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};

// Always-run section: all containers (`ps -a`, so stopped show too) + the host's primary IP.
// `\t` are real tabs so docker/podman `--format` emits tab-separated rows we split on.
const PS_SCRIPT: &str = "echo '##SD_PS'\n\
(docker ps -a --format 'docker\t{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true)\n\
(podman ps -a --format 'podman\t{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true)\n\
echo '##SD_IP'\n\
(hostname -I 2>/dev/null || true)\n";

// Per-container CPU/mem + one inspect for StartedAt/description — slower calls, so only appended
// when metrics are enabled. INSPECT emits name<TAB>StartedAt<TAB>description (real tabs).
const STATS_SCRIPT: &str = "echo '##SD_STATS'\n\
(docker stats --no-stream --format 'docker\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null || true)\n\
(podman stats --no-stream --format 'podman\t{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null || true)\n\
echo '##SD_INSPECT'\n\
(docker inspect --format '{{.Name}}\t{{.State.StartedAt}}\t{{.Image}}\t{{with index .Config.Labels \"org.opencontainers.image.description\"}}{{.}}{{end}}' $(docker ps -aq) 2>/dev/null || true)\n\
(podman inspect --format '{{.Name}}\t{{.State.StartedAt}}\t{{.Image}}\t{{with index .Config.Labels \"org.opencontainers.image.description\"}}{{.}}{{end}}' $(podman ps -aq) 2>/dev/null || true)\n\
echo '##SD_IMAGES'\n\
(docker image inspect --format '{{.Id}}\t{{.Created}}' $(docker images -q 2>/dev/null | sort -u) 2>/dev/null || true)\n\
(podman image inspect --format '{{.Id}}\t{{.Created}}' $(podman images -q 2>/dev/null | sort -u) 2>/dev/null || true)\n";

#[derive(Serialize)]
pub struct RemoteHostStatus {
    pub id: String,
    pub label: String,
    pub target: String,
    pub online: bool,
    pub ping_ms: Option<u128>,
    pub ssh_ms: Option<u128>,
    pub checked_at: String,
    pub containers: Vec<ContainerInfo>,
    // Total containers the host reported, before the display cap — so the UI can show
    // "showing N of M" instead of silently hiding the tail on busy hosts.
    pub container_total: usize,
    // Primary IP the host reports (`hostname -I` first token); None if it didn't answer.
    pub ip: Option<String>,
    // Machine metrics (CPU/RAM/load/temps) when remote metrics are enabled and the host is a
    // reachable Linux box; None when disabled or unparseable.
    pub metrics: Option<RemoteMetrics>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct RemoteHostList {
    pub hosts: Vec<RemoteHostStatus>,
}

pub async fn check_all(
    hosts: Vec<RemoteHostConfig>,
    cap: usize,
    with_metrics: bool,
) -> RemoteHostList {
    RemoteHostList {
        hosts: join_all(
            hosts
                .into_iter()
                .map(|host| check_host(host, cap, with_metrics)),
        )
        .await,
    }
}

async fn check_host(host: RemoteHostConfig, cap: usize, with_metrics: bool) -> RemoteHostStatus {
    let ping_ms = ping_latency_ms(&host.target).await;
    let (containers, container_total, ip, metrics, ssh_ms, ssh_error) =
        ssh_probe(&host.target, cap, with_metrics).await;
    let online = ping_ms.is_some() || ssh_ms.is_some();
    RemoteHostStatus {
        id: host.id,
        label: host.label,
        target: host.target,
        online,
        ping_ms,
        ssh_ms,
        checked_at: Utc::now().to_rfc3339(),
        containers,
        container_total,
        ip,
        metrics,
        error: if online {
            ssh_error
        } else {
            ssh_error.or_else(|| Some("Host did not answer ping or SSH".to_string()))
        },
    }
}

async fn ping_latency_ms(target: &str) -> Option<u128> {
    let started = Instant::now();
    let mut command = Command::new("ping");
    // `--` ends option parsing so a target can never be read as a ping flag.
    command
        .args(["-c", "1", "-W", "1", "--", target])
        .kill_on_drop(true);
    let Ok(Ok(output)) = timeout(Duration::from_millis(1600), command.output()).await else {
        return None;
    };
    if !output.status.success() {
        return None;
    }
    parse_ping_time_ms(&String::from_utf8_lossy(&output.stdout))
        .or_else(|| Some(started.elapsed().as_millis()))
}

type ProbeResult = (
    Vec<ContainerInfo>,
    usize,
    Option<String>,
    Option<RemoteMetrics>,
    Option<u128>,
    Option<String>,
);

async fn ssh_probe(target: &str, cap: usize, with_metrics: bool) -> ProbeResult {
    let started = Instant::now();
    // One SSH round-trip returns the PS + IP sections always, plus per-container stats and the
    // /proc metrics sections when metrics are enabled (those add the slow `stats` call).
    let script = if with_metrics {
        format!("{PS_SCRIPT}{STATS_SCRIPT}{REMOTE_METRICS_SCRIPT}")
    } else {
        PS_SCRIPT.to_string()
    };
    // stats + two /proc samples need more headroom than a bare container check.
    let budget = if with_metrics { 9000 } else { 6000 };
    let timed_out = (
        Vec::new(),
        0,
        None,
        None,
        None,
        Some("SSH timed out while checking the host".to_string()),
    );
    let spawn_failed = (
        Vec::new(),
        0,
        None,
        None,
        None,
        Some("Could not start SSH for the remote host check".to_string()),
    );

    let mut command = Command::new("ssh");
    // The script is fed over STDIN to a login shell (`sh -ls`), NOT passed as a command-line
    // argument — ssh joins remote args with spaces and the remote shell re-parses them, which
    // mangles a multi-line script (it ate the first `echo` marker). stdin keeps it intact.
    // `-o` flags first, then the validated target. clean_remote_target() already rejects a
    // leading-dash target, so it can't be parsed as an ssh option.
    command
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=2",
            "-o",
            "NumberOfPasswordPrompts=0",
            target,
            "sh",
            "-ls",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let Ok(mut child) = command.spawn() else {
        return spawn_failed;
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes()).await;
        // Drop closes the pipe so `sh -ls` sees EOF and runs.
    }
    let Ok(result) = timeout(Duration::from_millis(budget), child.wait_with_output()).await else {
        return timed_out;
    };
    let Ok(output) = result else {
        return spawn_failed;
    };
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return (Vec::new(), 0, None, None, None, Some(clean_error(&err)));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let secs = remote_metrics::sections(&stdout);
    let mut containers =
        parse_remote_containers(secs.get("PS").map(String::as_str).unwrap_or_default());
    if let Some(stats) = secs.get("STATS") {
        attach_stats(&mut containers, &parse_remote_stats(stats));
    }
    if let Some(inspect) = secs.get("INSPECT") {
        attach_inspect(&mut containers, &parse_inspect(inspect));
    }
    if let Some(images) = secs.get("IMAGES") {
        attach_built(&mut containers, &parse_image_built(images));
    }
    let total = containers.len();
    containers.truncate(cap.max(1));
    image_versions::annotate(&mut containers).await;
    let ip = secs
        .get("IP")
        .and_then(|raw| raw.split_whitespace().next())
        .map(str::to_string);
    let metrics = if with_metrics {
        remote_metrics::parse_from(&secs)
    } else {
        None
    };
    (
        containers,
        total,
        ip,
        metrics,
        Some(started.elapsed().as_millis()),
        None,
    )
}

// `engine\tname\timage\tstatus` rows from the PS section (`ps -a`).
fn parse_remote_containers(raw: &str) -> Vec<ContainerInfo> {
    let mut containers: Vec<ContainerInfo> = raw
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let engine = parts.next()?.trim();
            let name = parts.next()?.trim();
            let image = parts.next()?.trim();
            let status = parts.next()?.trim();
            if !matches!(engine, "docker" | "podman") || name.is_empty() {
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
        .collect();
    containers.sort_by(|a, b| a.engine.cmp(&b.engine).then(a.name.cmp(&b.name)));
    containers
}

// `engine\tname\tcpu\tmem` rows from the STATS section → name -> (cpu, mem).
fn parse_remote_stats(raw: &str) -> HashMap<String, (String, String)> {
    raw.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(4, '\t');
            let engine = parts.next()?.trim();
            let name = parts.next()?.trim().to_string();
            let cpu = parts.next()?.trim().to_string();
            let mem = parts.next()?.trim().to_string();
            if !matches!(engine, "docker" | "podman") || name.is_empty() {
                return None;
            }
            Some((name, (cpu, mem)))
        })
        .collect()
}

fn parse_ping_time_ms(raw: &str) -> Option<u128> {
    let (_, rest) = raw.split_once("time=")?;
    let time = rest.split_whitespace().next()?;
    time.parse::<f64>()
        .ok()
        .map(|ms| ms.max(0.0).round() as u128)
}

fn clean_error(raw: &str) -> String {
    let line = raw
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(raw);
    let clean: String = line
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(180)
        .collect();
    if clean.is_empty() {
        "SSH check failed".to_string()
    } else {
        clean
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_container_rows() {
        let containers = parse_remote_containers(
            "docker\tmemoh-server\tmemoh:latest\tUp 2 hours\npodman\tworker\tops:1\tUp 4 minutes\nbad\tignored\timage\tUp\n",
        );
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].name, "memoh-server");
        assert_eq!(containers[1].engine, "podman");
    }

    #[test]
    fn parses_ping_time() {
        assert_eq!(
            parse_ping_time_ms("64 bytes from host: icmp_seq=1 ttl=64 time=2.34 ms"),
            Some(2)
        );
    }
}
