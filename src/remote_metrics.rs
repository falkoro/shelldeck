// Machine metrics (CPU / RAM / load / temps) for a remote SSH host, gathered in the same
// SSH round-trip as the container check. The remote shell emits clearly-marked sections
// (two /proc/stat samples for an instantaneous CPU%, plus meminfo/loadavg/uptime/nproc/hwmon)
// which we parse here, reusing the local /proc parsers in `metrics`.

use crate::metrics::{cpu_sample, meminfo_kb, Temp};
use serde::Serialize;

// Appended after the container script so one SSH call returns both. Markers are unique enough
// that the container parser (which only accepts `docker`/`podman` tab rows) ignores these lines.
pub const REMOTE_METRICS_SCRIPT: &str = r#"
echo '##SD_STAT1'; cat /proc/stat 2>/dev/null
sleep 0.2
echo '##SD_STAT2'; cat /proc/stat 2>/dev/null
echo '##SD_MEM'; cat /proc/meminfo 2>/dev/null
echo '##SD_LOAD'; cat /proc/loadavg 2>/dev/null
echo '##SD_UP'; cat /proc/uptime 2>/dev/null
echo '##SD_NPROC'; nproc 2>/dev/null
echo '##SD_TEMPS'; for h in /sys/class/hwmon/hwmon*; do [ -e "$h/name" ] || continue; n=$(cat "$h/name" 2>/dev/null); for f in "$h"/temp*_input; do [ -e "$f" ] || continue; v=$(cat "$f" 2>/dev/null); l=$(cat "${f%_input}_label" 2>/dev/null); printf '%s|%s|%s\n' "$n" "$l" "$v"; done; done 2>/dev/null
echo '##SD_END'
"#;

#[derive(Serialize)]
pub struct RemoteMetrics {
    pub cpu_pct: f64,
    pub cpu_cores: usize,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub mem_total_kb: u64,
    pub mem_used_kb: u64,
    pub mem_pct: f64,
    pub uptime_secs: u64,
    pub temps: Vec<Temp>,
}

// Split the blob into the `##SD_*` sections the remote script emits. Lines before the first
// marker (e.g. leftover container rows) are dropped.
fn sections(blob: &str) -> std::collections::HashMap<&str, String> {
    let mut map: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    let mut current: Option<&str> = None;
    for line in blob.lines() {
        if let Some(name) = line.strip_prefix("##SD_") {
            current = Some(name.trim());
            map.entry(name.trim()).or_default();
        } else if let Some(name) = current {
            let buf = map.entry(name).or_default();
            buf.push_str(line);
            buf.push('\n');
        }
    }
    map
}

fn cpu_percent(stat1: &str, stat2: &str) -> f64 {
    let (Some((idle_a, total_a)), Some((idle_b, total_b))) = (cpu_sample(stat1), cpu_sample(stat2))
    else {
        return 0.0;
    };
    let dt = total_b.saturating_sub(total_a);
    if dt == 0 {
        return 0.0;
    }
    let di = idle_b.saturating_sub(idle_a);
    (((dt - di) as f64) / (dt as f64) * 100.0).clamp(0.0, 100.0)
}

fn first_floats(line: &str, n: usize) -> Vec<f64> {
    line.split_whitespace()
        .filter_map(|v| v.parse::<f64>().ok())
        .take(n)
        .collect()
}

// `name|label|millidegrees` rows → friendly temps, mirroring metrics::read_temps (chip prefix,
// 1..150 °C sanity window, hottest-first, capped at 8).
fn parse_temps(raw: &str) -> Vec<Temp> {
    let mut temps: Vec<Temp> = raw
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '|');
            let chip = parts.next()?.trim();
            let label = parts.next()?.trim();
            let celsius = parts.next()?.trim().parse::<f64>().ok()? / 1000.0;
            if !(1.0..=150.0).contains(&celsius) {
                return None;
            }
            let label = if label.is_empty() {
                if chip.is_empty() {
                    "temp".to_string()
                } else {
                    chip.to_string()
                }
            } else if chip.is_empty() || label.to_lowercase().contains(&chip.to_lowercase()) {
                label.to_string()
            } else {
                format!("{chip} {label}")
            };
            Some(Temp { label, celsius })
        })
        .collect();
    temps.sort_by(|a, b| b.celsius.total_cmp(&a.celsius));
    temps.truncate(8);
    temps
}

// Parse the sectioned blob. Returns None when the host produced no usable metrics (e.g. a
// non-Linux target, or `with_metrics` disabled so the script was never appended).
pub fn parse(blob: &str) -> Option<RemoteMetrics> {
    let s = sections(blob);
    let stat1 = s.get("STAT1")?;
    let stat2 = s.get("STAT2")?;
    let mem = s.get("MEM").map(String::as_str).unwrap_or_default();
    let mem_total_kb = meminfo_kb(mem, "MemTotal:");
    let mem_avail_kb = meminfo_kb(mem, "MemAvailable:");
    if mem_total_kb == 0 {
        return None;
    }
    let mem_used_kb = mem_total_kb.saturating_sub(mem_avail_kb);
    let mem_pct = (mem_used_kb as f64) / (mem_total_kb as f64) * 100.0;

    let load = first_floats(s.get("LOAD").map(String::as_str).unwrap_or_default(), 3);
    let uptime_secs = s
        .get("UP")
        .and_then(|up| up.split_whitespace().next().map(str::to_string))
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0) as u64;
    let cpu_cores = s
        .get("NPROC")
        .and_then(|n| n.trim().lines().next())
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0);

    Some(RemoteMetrics {
        cpu_pct: cpu_percent(stat1, stat2),
        cpu_cores,
        load1: load.first().copied().unwrap_or(0.0),
        load5: load.get(1).copied().unwrap_or(0.0),
        load15: load.get(2).copied().unwrap_or(0.0),
        mem_total_kb,
        mem_used_kb,
        mem_pct,
        uptime_secs,
        temps: parse_temps(s.get("TEMPS").map(String::as_str).unwrap_or_default()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "docker\tweb\timg\tUp 2 hours\n##SD_STAT1\ncpu  100 0 50 1000 0 0 0\ncpu0 50 0 25 500\n##SD_STAT2\ncpu  140 0 70 1060 0 0 0\ncpu0 70 0 35 530\n##SD_MEM\nMemTotal:       16000000 kB\nMemAvailable:    4000000 kB\nSwapTotal:       2000000 kB\nSwapFree:        2000000 kB\n##SD_LOAD\n1.50 0.80 0.40 1/900 1234\n##SD_UP\n90061.12 700000.0\n##SD_NPROC\n8\n##SD_TEMPS\nk10temp|Tctl|65000\nnvme|Composite|40000\nbogus|bad|999000\n##SD_END\n";

    #[test]
    fn parses_cpu_mem_load_uptime_cores() {
        let m = parse(SAMPLE).expect("metrics");
        // total delta = 1140-1150? compute: stat1 total=1150 idle=1000; stat2 total=1270 idle=1060
        // dt=120, di=60 -> busy 60/120 = 50%
        assert_eq!(m.cpu_pct.round() as i64, 50);
        assert_eq!(m.cpu_cores, 8);
        assert_eq!(m.mem_total_kb, 16_000_000);
        assert_eq!(m.mem_used_kb, 12_000_000);
        assert_eq!(m.mem_pct.round() as i64, 75);
        assert_eq!(m.load1, 1.50);
        assert_eq!(m.load15, 0.40);
        assert_eq!(m.uptime_secs, 90061);
    }

    #[test]
    fn temps_filtered_sorted_and_labelled() {
        let m = parse(SAMPLE).expect("metrics");
        // 999 °C bogus row dropped; hottest first; chip prefixed when not already in label.
        assert_eq!(m.temps.len(), 2);
        assert_eq!(m.temps[0].label, "k10temp Tctl");
        assert_eq!(m.temps[0].celsius, 65.0);
        assert_eq!(m.temps[1].label, "nvme Composite");
    }

    #[test]
    fn returns_none_without_proc_sections() {
        assert!(parse("docker\tweb\timg\tUp 2 hours\n").is_none());
    }
}
