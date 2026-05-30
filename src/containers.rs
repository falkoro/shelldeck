use serde::Serialize;
use std::{collections::HashSet, time::Duration};
use tokio::{process::Command, time::timeout};

#[derive(Serialize)]
pub struct ContainerInfo {
    pub engine: String,
    pub name: String,
    pub image: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct ContainerList {
    pub containers: Vec<ContainerInfo>,
}

async fn engine_containers(engine: &str) -> Vec<ContainerInfo> {
    let mut command = Command::new(engine);
    command
        .args(["ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}"])
        .kill_on_drop(true);

    let Ok(Ok(output)) = timeout(Duration::from_millis(1200), command.output()).await else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
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
            })
        })
        .collect()
}

pub async fn running() -> ContainerList {
    let (mut docker, mut podman) =
        tokio::join!(engine_containers("docker"), engine_containers("podman"));
    docker.append(&mut podman);
    docker.sort_by(|a, b| a.engine.cmp(&b.engine).then(a.name.cmp(&b.name)));
    let mut seen = HashSet::new();
    docker.retain(|container| {
        seen.insert((
            container.name.clone(),
            container.image.clone(),
            container.status.clone(),
        ))
    });
    docker.truncate(32);
    ContainerList { containers: docker }
}
