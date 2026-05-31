use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct Temp {
    pub label: String,
    pub celsius: f64,
}

#[derive(Serialize)]
pub struct Metrics {
    pub hostname: String,
    pub ip: String,
    pub cpu_pct: f64,
    pub cpu_cores: usize,
    pub cpu_mhz: f64,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub mem_total_kb: u64,
    pub mem_used_kb: u64,
    pub mem_pct: f64,
    pub swap_total_kb: u64,
    pub swap_used_kb: u64,
    pub uptime_secs: u64,
    pub temps: Vec<Temp>,
}

// Primary outbound IP, found by asking the kernel which source address it would use to reach a
// public address. No packets are sent (UDP connect just selects the route); falls back to "".
fn local_ip() -> String {
    use std::net::UdpSocket;
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|sock| {
            sock.connect("1.1.1.1:80")?;
            sock.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_default()
}

// Aggregate "cpu" jiffies from /proc/stat as (idle, total).
pub(crate) fn cpu_sample(stat: &str) -> Option<(u64, u64)> {
    let line = stat.lines().find(|l| l.starts_with("cpu "))?;
    let nums: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .filter_map(|v| v.parse().ok())
        .collect();
    if nums.len() < 4 {
        return None;
    }
    // user nice system idle iowait irq softirq steal ...
    let idle = nums[3] + nums.get(4).copied().unwrap_or(0);
    let total: u64 = nums.iter().sum();
    Some((idle, total))
}

async fn cpu_percent() -> f64 {
    let Ok(a) = tokio::fs::read_to_string("/proc/stat").await else {
        return 0.0;
    };
    tokio::time::sleep(Duration::from_millis(200)).await;
    let Ok(b) = tokio::fs::read_to_string("/proc/stat").await else {
        return 0.0;
    };
    let (Some((idle_a, total_a)), Some((idle_b, total_b))) = (cpu_sample(&a), cpu_sample(&b))
    else {
        return 0.0;
    };
    let dt = total_b.saturating_sub(total_a);
    let di = idle_b.saturating_sub(idle_a);
    if dt == 0 {
        return 0.0;
    }
    (((dt - di) as f64) / (dt as f64) * 100.0).clamp(0.0, 100.0)
}

pub(crate) fn meminfo_kb(info: &str, key: &str) -> u64 {
    info.lines()
        .find(|l| l.starts_with(key))
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn cpu_mhz(cpuinfo: &str) -> f64 {
    let mut values: Vec<f64> = cpuinfo
        .lines()
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.trim() == "cpu MHz")
        .filter_map(|(_, value)| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .collect();
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    values[values.len() / 2]
}

// Read each hwmon's tempN_input (millidegrees) and its tempN_label, falling back to
// the hwmon `name` so AMD k10temp / Intel coretemp / nvme sensors all show up.
fn read_temps() -> Vec<Temp> {
    let mut temps = Vec::new();
    let Ok(entries) = std::fs::read_dir("/sys/class/hwmon") else {
        return temps;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        let chip = std::fs::read_to_string(dir.join("name"))
            .unwrap_or_default()
            .trim()
            .to_string();
        for i in 1..=16 {
            let input = dir.join(format!("temp{i}_input"));
            let Ok(raw) = std::fs::read_to_string(&input) else {
                continue;
            };
            let Ok(milli) = raw.trim().parse::<f64>() else {
                continue;
            };
            let celsius = milli / 1000.0;
            if !(1.0..=150.0).contains(&celsius) {
                continue;
            }
            let label = std::fs::read_to_string(dir.join(format!("temp{i}_label")))
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .map(|label| {
                    if chip.is_empty() || label.to_lowercase().contains(&chip.to_lowercase()) {
                        label
                    } else {
                        format!("{chip} {label}")
                    }
                })
                .unwrap_or_else(|| {
                    if chip.is_empty() {
                        format!("temp{i}")
                    } else {
                        format!("{chip} temp{i}")
                    }
                });
            temps.push(Temp { label, celsius });
        }
    }
    temps.sort_by(|a, b| b.celsius.total_cmp(&a.celsius));
    temps.truncate(8);
    temps
}

pub async fn gather() -> Metrics {
    let cpu_pct = cpu_percent().await;
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(0);
    let cpu_mhz = tokio::fs::read_to_string("/proc/cpuinfo")
        .await
        .map(|info| cpu_mhz(&info))
        .unwrap_or(0.0);
    let load = tokio::fs::read_to_string("/proc/loadavg")
        .await
        .unwrap_or_default();
    let mut lp = load.split_whitespace();
    let load1 = lp.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let load5 = lp.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let load15 = lp.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);

    let info = tokio::fs::read_to_string("/proc/meminfo")
        .await
        .unwrap_or_default();
    let mem_total_kb = meminfo_kb(&info, "MemTotal:");
    let mem_avail_kb = meminfo_kb(&info, "MemAvailable:");
    let mem_used_kb = mem_total_kb.saturating_sub(mem_avail_kb);
    let mem_pct = if mem_total_kb > 0 {
        (mem_used_kb as f64) / (mem_total_kb as f64) * 100.0
    } else {
        0.0
    };
    let swap_total_kb = meminfo_kb(&info, "SwapTotal:");
    let swap_free_kb = meminfo_kb(&info, "SwapFree:");
    let swap_used_kb = swap_total_kb.saturating_sub(swap_free_kb);

    let uptime = tokio::fs::read_to_string("/proc/uptime")
        .await
        .unwrap_or_default();
    let uptime_secs = uptime
        .split_whitespace()
        .next()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0) as u64;

    let hostname = std::fs::read_to_string("/etc/hostname")
        .unwrap_or_else(|_| "localhost".to_string())
        .trim()
        .to_string();

    Metrics {
        hostname,
        ip: local_ip(),
        cpu_pct,
        cpu_cores,
        cpu_mhz,
        load1,
        load5,
        load15,
        mem_total_kb,
        mem_used_kb,
        mem_pct,
        swap_total_kb,
        swap_used_kb,
        uptime_secs,
        temps: read_temps(),
    }
}
