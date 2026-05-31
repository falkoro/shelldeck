use crate::{
    config::RemoteHostConfig,
    containers::ContainerInfo,
    remote_metrics::{self, RemoteMetrics, REMOTE_METRICS_SCRIPT},
};
use chrono::Utc;
use futures_util::future::join_all;
use serde::Serialize;
use std::time::{Duration, Instant};
use tokio::{process::Command, time::timeout};

const REMOTE_CONTAINER_SCRIPT: &str = r#"
(docker ps --format 'docker	{{.Names}}	{{.Image}}	{{.Status}}' 2>/dev/null || true)
(podman ps --format 'podman	{{.Names}}	{{.Image}}	{{.Status}}' 2>/dev/null || true)
"#;

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
    let (containers, container_total, metrics, ssh_ms, ssh_error) =
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
    Option<RemoteMetrics>,
    Option<u128>,
    Option<String>,
);

async fn ssh_probe(target: &str, cap: usize, with_metrics: bool) -> ProbeResult {
    let started = Instant::now();
    // One SSH round-trip returns containers and (optionally) the /proc metrics sections.
    let script = if with_metrics {
        format!("{REMOTE_CONTAINER_SCRIPT}{REMOTE_METRICS_SCRIPT}")
    } else {
        REMOTE_CONTAINER_SCRIPT.to_string()
    };
    let mut command = Command::new("ssh");
    // `-o` flags first, then the validated target. clean_remote_target() already rejects
    // a leading-dash target, so it can't be parsed as an ssh option.
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
            "-lc",
            script.as_str(),
        ])
        .kill_on_drop(true);

    let Ok(result) = timeout(Duration::from_millis(6000), command.output()).await else {
        return (
            Vec::new(),
            0,
            None,
            None,
            Some("SSH timed out while checking the host".to_string()),
        );
    };
    let Ok(output) = result else {
        return (
            Vec::new(),
            0,
            None,
            None,
            Some("Could not start SSH for the remote host check".to_string()),
        );
    };
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return (Vec::new(), 0, None, None, Some(clean_error(&err)));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut containers = parse_remote_containers(&stdout);
    let total = containers.len();
    containers.truncate(cap.max(1));
    let metrics = if with_metrics {
        remote_metrics::parse(&stdout)
    } else {
        None
    };
    (
        containers,
        total,
        metrics,
        Some(started.elapsed().as_millis()),
        None,
    )
}

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
            })
        })
        .collect();
    containers.sort_by(|a, b| a.engine.cmp(&b.engine).then(a.name.cmp(&b.name)));
    containers
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
