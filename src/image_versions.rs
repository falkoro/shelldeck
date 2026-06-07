use crate::containers::ContainerInfo;
use futures_util::future::join_all;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_IMAGES_PER_REFRESH: usize = 24;
const MAX_TAG_PAGES: usize = 4;

#[derive(Clone, Debug, Serialize)]
pub struct ContainerVersionInfo {
    pub current: String,
    pub latest: String,
    pub behind: usize,
    pub state: String,
    pub detail: String,
}

#[derive(Clone)]
struct CacheEntry {
    checked_at: Instant,
    info: Option<ContainerVersionInfo>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct VersionTag {
    prefix: String,
    nums: Vec<u64>,
    suffix: String,
}

#[derive(Clone, Debug)]
struct ImageRef {
    repo: String,
    tag: String,
}

#[derive(Deserialize)]
struct HubTagPage {
    next: Option<String>,
    results: Vec<HubTag>,
}

#[derive(Deserialize)]
struct HubTag {
    name: String,
}

static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
static TAG_RE: OnceLock<Regex> = OnceLock::new();

pub async fn annotate(containers: &mut [ContainerInfo]) {
    let images: Vec<(usize, String)> = containers
        .iter()
        .enumerate()
        .filter(|(_, c)| c.version.is_none())
        .filter_map(|(idx, c)| supported_ref(&c.image).map(|_| (idx, c.image.clone())))
        .take(MAX_IMAGES_PER_REFRESH)
        .collect();
    if images.is_empty() {
        return;
    }

    let checks = images
        .iter()
        .map(|(_, image)| version_for_image(image.clone()))
        .collect::<Vec<_>>();
    for ((idx, _), info) in images.into_iter().zip(join_all(checks).await) {
        containers[idx].version = info;
    }
}

async fn version_for_image(image: String) -> Option<ContainerVersionInfo> {
    if let Some(info) = cached(&image) {
        return info;
    }
    let info = resolve_version(&image).await;
    remember(image, info.clone());
    info
}

async fn resolve_version(image: &str) -> Option<ContainerVersionInfo> {
    let image_ref = supported_ref(image)?;
    let current = parse_version_tag(&image_ref.tag)?;
    let tags = tokio::time::timeout(
        Duration::from_millis(3500),
        fetch_docker_hub_tags(&image_ref.repo),
    )
    .await
    .ok()?
    .ok()?;

    let mut newer: Vec<(VersionTag, String)> = tags
        .into_iter()
        .filter_map(|tag| parse_version_tag(&tag).map(|v| (v, tag)))
        .filter(|(candidate, _)| {
            candidate.prefix == current.prefix && candidate.suffix == current.suffix
        })
        .filter(|(candidate, _)| {
            compare_versions(&candidate.nums, &current.nums) == Ordering::Greater
        })
        .collect();
    newer.sort_by(|(a, _), (b, _)| compare_versions(&a.nums, &b.nums));

    if let Some((_, latest)) = newer.last() {
        let behind = newer.len();
        Some(ContainerVersionInfo {
            current: image_ref.tag,
            latest: latest.clone(),
            behind,
            state: "behind".to_string(),
            detail: format!(
                "{behind} newer Docker Hub tag{} found",
                if behind == 1 { "" } else { "s" }
            ),
        })
    } else {
        Some(ContainerVersionInfo {
            current: image_ref.tag.clone(),
            latest: image_ref.tag,
            behind: 0,
            state: "current".to_string(),
            detail: "No newer matching Docker Hub semver tag found".to_string(),
        })
    }
}

async fn fetch_docker_hub_tags(repo: &str) -> Result<Vec<String>, reqwest::Error> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(2500))
        .build()?;
    let mut tags = Vec::new();
    let mut next = Some(format!(
        "https://registry.hub.docker.com/v2/repositories/{repo}/tags?page_size=100&ordering=last_updated"
    ));
    for _ in 0..MAX_TAG_PAGES {
        let Some(url) = next.take() else { break };
        let page = client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json::<HubTagPage>()
            .await?;
        tags.extend(page.results.into_iter().map(|tag| tag.name));
        next = page.next;
        if next.is_none() {
            break;
        }
    }
    Ok(tags)
}

fn supported_ref(image: &str) -> Option<ImageRef> {
    let image = image.trim();
    if image.is_empty() || image.contains('@') {
        return None;
    }
    let (name, tag) = image.rsplit_once(':')?;
    if tag.is_empty() || tag == "latest" || name.is_empty() {
        return None;
    }
    let mut parts = name.split('/');
    let first = parts.next()?;
    let repo =
        if first == "docker.io" || first == "registry.hub.docker.com" || first == "index.docker.io"
        {
            let rest = parts.collect::<Vec<_>>().join("/");
            if rest.split('/').count() == 1 {
                format!("library/{rest}")
            } else {
                rest
            }
        } else if first.contains('.') || first.contains(':') {
            return None;
        } else if name.contains('/') {
            name.to_string()
        } else {
            format!("library/{name}")
        };
    parse_version_tag(tag)?;
    Some(ImageRef {
        repo,
        tag: tag.to_string(),
    })
}

fn parse_version_tag(tag: &str) -> Option<VersionTag> {
    let re = TAG_RE.get_or_init(|| {
        Regex::new(r"^(?P<prefix>v?)(?P<num>\d+\.\d+(?:\.\d+){0,2})(?P<suffix>[._-][A-Za-z0-9][A-Za-z0-9._-]*)?$")
            .expect("valid semver-ish tag regex")
    });
    let caps = re.captures(tag)?;
    let nums = caps["num"]
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    Some(VersionTag {
        prefix: caps.name("prefix").map_or("", |m| m.as_str()).to_string(),
        nums,
        suffix: caps.name("suffix").map_or("", |m| m.as_str()).to_string(),
    })
}

fn compare_versions(left: &[u64], right: &[u64]) -> Ordering {
    let width = left.len().max(right.len()).max(3);
    for i in 0..width {
        let l = *left.get(i).unwrap_or(&0);
        let r = *right.get(i).unwrap_or(&0);
        match l.cmp(&r) {
            Ordering::Equal => {}
            order => return order,
        }
    }
    Ordering::Equal
}

fn cached(image: &str) -> Option<Option<ContainerVersionInfo>> {
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let cache = cache.lock().ok()?;
    let entry = cache.get(image)?;
    (entry.checked_at.elapsed() < CACHE_TTL).then(|| entry.info.clone())
}

fn remember(image: String, info: Option<ContainerVersionInfo>) {
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            image,
            CacheEntry {
                checked_at: Instant::now(),
                info,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supports_docker_hub_semver_refs_only() {
        assert_eq!(supported_ref("nginx:1.27.3").unwrap().repo, "library/nginx");
        assert_eq!(
            supported_ref("docker.io/grafana/grafana:11.2.0")
                .unwrap()
                .repo,
            "grafana/grafana"
        );
        assert!(supported_ref("nginx:latest").is_none());
        assert!(supported_ref("ghcr.io/acme/app:1.2.3").is_none());
        assert!(supported_ref("local-app:dev").is_none());
        assert!(supported_ref("redis:7").is_none());
    }

    #[test]
    fn parses_and_compares_version_tags() {
        let current = parse_version_tag("v1.2.3-alpine").unwrap();
        let next = parse_version_tag("v1.3.0-alpine").unwrap();
        let other_suffix = parse_version_tag("v1.3.0-bookworm").unwrap();
        assert_eq!(current.prefix, "v");
        assert_eq!(current.suffix, "-alpine");
        assert_eq!(
            compare_versions(&next.nums, &current.nums),
            Ordering::Greater
        );
        assert_ne!(next.suffix, other_suffix.suffix);
        assert!(parse_version_tag("22-bookworm-slim").is_none());
    }
}
