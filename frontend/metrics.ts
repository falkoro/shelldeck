// Live host machine stats (CPU / RAM / temps), polled from /api/metrics.
// Mirrors the CachyOS system-monitor widget: at-a-glance CPU%, RAM, and temperatures.

interface MetricTemp {
  label: string;
  celsius: number;
}

interface MachineMetrics {
  hostname: string;
  ip?: string;
  cpu_pct: number;
  cpu_cores: number;
  cpu_mhz: number;
  load1: number;
  load5: number;
  load15: number;
  mem_total_kb: number;
  mem_used_kb: number;
  mem_pct: number;
  swap_total_kb: number;
  swap_used_kb: number;
  uptime_secs: number;
  temps: MetricTemp[];
}

interface ContainerInfo {
  engine: string;
  name: string;
  image: string;
  status: string;
  cpu?: string | null;
  mem?: string | null;
  started?: string | null;
  desc?: string | null;
  version?: ContainerVersionInfo | null;
}

interface ContainerVersionInfo {
  current: string;
  latest: string;
  behind: number;
  state: 'current' | 'behind';
  detail: string;
}

interface RemoteMetrics {
  cpu_pct: number;
  cpu_cores: number;
  load1: number;
  load5: number;
  load15: number;
  mem_total_kb: number;
  mem_used_kb: number;
  mem_pct: number;
  uptime_secs: number;
  temps: MetricTemp[];
}

interface RemoteHostStatus {
  id: string;
  label: string;
  target: string;
  online: boolean;
  ping_ms: number | null;
  ssh_ms: number | null;
  checked_at: string;
  containers: ContainerInfo[];
  container_total?: number;
  ip?: string | null;
  metrics?: RemoteMetrics | null;
  error?: string | null;
}

interface GhRun {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion?: string | null;
  head_branch?: string | null;
  run_number: number;
  html_url: string;
  updated_at: string;
  event: string;
}

interface GhRepoStatus {
  repo: string;
  ok: boolean;
  error?: string | null;
  run?: GhRun | null;
}

interface GhRunsResult {
  repos: GhRepoStatus[];
  rate_limit_remaining?: number | null;
  rate_limit_reset?: number | null;
  fetched_at: string;
  cached: boolean;
}

type ContainerStateKind =
  | 'running' | 'unhealthy' | 'restarting' | 'paused' | 'crashed' | 'created' | 'stopped';

// Display order (most attention-worthy first) for the health rollup + legend, plus each
// state's legend label and status-dot colour class.
const CONTAINER_STATE_ORDER: ContainerStateKind[] =
  ['running', 'unhealthy', 'restarting', 'crashed', 'paused', 'created', 'stopped'];
const CONTAINER_STATE_LABEL: Record<ContainerStateKind, string> = {
  running: 'running', unhealthy: 'unhealthy', restarting: 'restarting',
  crashed: 'crashed', paused: 'paused', created: 'created', stopped: 'stopped',
};

// Fine-grained lifecycle/health from a docker/podman status string. Beyond running/stopped it
// surfaces unhealthy (failed healthcheck), restarting (crash-looping), paused, created, and —
// crucially — distinguishes a clean stop (Exited 0) from a crash (Exited non-zero / Dead).
function containerState(status: string): ContainerStateKind {
  const s = (status || '').toLowerCase().trim();
  if (s.includes('unhealthy')) return 'unhealthy';
  if (s.startsWith('restarting')) return 'restarting';
  if (s.includes('paused')) return 'paused';
  if (s.startsWith('created')) return 'created';
  if (s.startsWith('dead')) return 'crashed';
  const exit = /^exited \((\d+)\)/.exec(s);
  if (exit) return exit[1] === '0' ? 'stopped' : 'crashed';
  if (s.startsWith('up')) return 'running';
  return 'stopped';
}

// "23 running · 1 unhealthy · 2 crashed · 1 stopped" — every non-empty bucket, severity order.
function containerHealth(containers: ContainerInfo[]): string {
  const counts: Partial<Record<ContainerStateKind, number>> = {};
  for (const c of containers) {
    const st = containerState(c.status);
    counts[st] = (counts[st] || 0) + 1;
  }
  const parts = CONTAINER_STATE_ORDER
    .filter((st) => counts[st])
    .map((st) => `${counts[st]} ${CONTAINER_STATE_LABEL[st]}`);
  return parts.join(' · ') || 'no containers';
}

function containerVersionSummary(containers: ContainerInfo[]): string {
  let staleContainers = 0;
  let totalBehind = 0;
  for (const c of containers) {
    if (c.version?.state === 'behind' && c.version.behind > 0) {
      staleContainers += 1;
      totalBehind += c.version.behind;
    }
  }
  if (!staleContainers) return '';
  const rows = staleContainers === 1 ? '1 update' : `${staleContainers} updates`;
  const versions = totalBehind === 1 ? '1 version' : `${totalBehind} versions`;
  return `${rows} · ${versions} behind`;
}

function containerOverview(containers: ContainerInfo[]): string {
  const version = containerVersionSummary(containers);
  return version ? `${containerHealth(containers)} · ${version}` : containerHealth(containers);
}

// "12.50%" → 12.5; null when there's no parseable number.
function parsePercent(s?: string | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

// "128MiB" / "1.5GiB" / "512kB" → bytes. Handles docker's IEC (KiB/MiB/GiB) and SI (kB/MB/GB) units.
function parseBytes(s?: string | null): number | null {
  if (!s) return null;
  const m = /([\d.]+)\s*([kmgtp]i?b|b)?/i.exec(s.trim());
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  const mult: Record<string, number> = {
    b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, pib: 1024 ** 5,
  };
  return val * (mult[(m[2] || 'b').toLowerCase()] ?? 1);
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes.toFixed(0)} B`;
}

// One stat pill with an inline intensity bar (the `--fill` width) behind the text.
function statChip(kind: 'cpu' | 'mem', fillPct: number, text: string, title: string): string {
  const fill = Math.max(0, Math.min(100, fillPct)).toFixed(0);
  return `<span class="ci-stat ci-stat-${kind} ${meterLevel(fillPct)}" style="--fill:${fill}%" title="${escapeHtml(title)}"><span>${escapeHtml(text)}</span></span>`;
}

// Compact CPU + mem pills shared by the local and remote container rows so both lists read alike.
// CPU% can exceed 100 on multi-core hosts, so the bar clamps but the printed number is the real
// value; mem shows used + %-of-limit, with the full "used / limit" string in the tooltip.
function containerStatChipsHtml(c: ContainerInfo): string {
  const chips: string[] = [];
  const cpu = parsePercent(c.cpu);
  if (cpu !== null) chips.push(statChip('cpu', cpu, `CPU ${cpu.toFixed(cpu < 10 ? 1 : 0)}%`, `CPU ${c.cpu}`));
  if (c.mem) {
    const [usedRaw, limitRaw] = c.mem.split('/').map((p) => p.trim());
    const used = parseBytes(usedRaw);
    const limit = parseBytes(limitRaw);
    if (used !== null && limit && limit > 0) {
      const pct = (used / limit) * 100;
      chips.push(statChip('mem', pct, `${fmtBytes(used)} · ${pct.toFixed(pct < 10 ? 1 : 0)}%`, `RAM ${c.mem}`));
    } else if (used !== null) {
      chips.push(statChip('mem', 0, fmtBytes(used), `RAM ${c.mem}`));
    } else {
      chips.push(`<span class="ci-stat ci-stat-mem ok"><span>${escapeHtml(c.mem)}</span></span>`);
    }
  }
  return chips.join('');
}

// Compact age from a docker status string, e.g. "Up 7 days (healthy)" → "7d", "Up About an hour"
// → "~1h", "Exited (0) 3 minutes ago" → "" (stopped, no age badge).
function containerUptime(status: string): string {
  if (!/^up\b/i.test(status)) return '';
  if (/about an hour/i.test(status)) return '~1h';
  if (/less than a (second|minute)/i.test(status)) return '<1m';
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(status);
  if (!m) return '';
  const unit = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }[m[2].toLowerCase()] || '';
  return `${m[1]}${unit}`;
}

// Precise uptime from StartedAt: "7d 3h 12m", "14h 4m 9s", "3m 22s", "47s".
function preciseUptime(startedIso?: string | null): string {
  if (!startedIso) return '';
  const start = Date.parse(startedIso);
  if (!Number.isFinite(start)) return '';
  let s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

// Running containers show precise uptime (from StartedAt); stopped show nothing here.
function containerAge(c: ContainerInfo): string {
  if (containerState(c.status) !== 'running') return '';
  return preciseUptime(c.started) || containerUptime(c.status);
}

// Descriptions: localStorage override > seed map (our own apps) > the image's label.
const CONTAINER_DESC_KEY = 'sdContainerDesc';
const DEFAULT_CONTAINER_DESC: Record<string, string> = {
  'autonomy-ev-ops': 'AutonomyEV publishing bot — drafts/reviews/publishes articles + Reddit/X',
  'spot-cloud-chat': 'Spot Cloud website-chat operator + repo-agent bot',
  'linkedin-ops': 'LinkedIn approval + publishing for the Spot brands',
  'wsb-digest': 'Daily r/wallstreetbets digest emailer',
  'smtp-graph-relay': 'SMTP → Microsoft Graph mail relay',
  'memoh-server': 'Memoh AI House — Discord persona fleet server',
  'memoh-web': 'Memoh web UI',
  'memoh-postgres': 'Memoh Postgres database',
  'memoh-qdrant': 'Memoh Qdrant vector store',
  'memoh-sparse': 'Memoh sparse-embedding service',
  'remark42': 'Comments backend (autonomy-ev.com)',
  'logan-services-tunnel': 'Cloudflare tunnel for the gl502vs sidecar services',
  'glances': 'System + container monitor (this dashboard reads it)',
  'plex': 'Plex media server',
  'sonarr': 'TV series management',
  'radarr': 'Movie management',
  'sabnzbd': 'Usenet downloader',
  'qbittorrent': 'Torrent client',
  'jackett': 'Indexer proxy',
  'adguardhome': 'Network-wide ad-blocking DNS',
  'homeassistant': 'Home automation',
  'smokeping': 'Network latency monitor',
};
function containerDescStore(): Record<string, string> {
  return storageJson<Record<string, string>>(CONTAINER_DESC_KEY, {});
}
function containerDescription(c: ContainerInfo): string {
  return (containerDescStore()[c.name] || DEFAULT_CONTAINER_DESC[c.name] || c.desc || '').trim();
}
function editContainerDescription(name: string): void {
  if (!name) return;
  const store = containerDescStore();
  const current = store[name] || DEFAULT_CONTAINER_DESC[name] || '';
  const next = window.prompt(`Description for ${name}`, current);
  if (next === null) return;
  const clean = next.trim().slice(0, 160);
  if (clean) store[name] = clean; else delete store[name];
  localStorage.setItem(CONTAINER_DESC_KEY, JSON.stringify(store));
  Promise.allSettled([loadContainers(), loadRemoteHosts()]);
  toast('Description saved');
}
(window as any).editContainerDescription = editContainerDescription;

// Restart + Pull-latest as small icon buttons. Hidden via CSS unless shells are unlocked; the
// click handler confirms and the server re-checks login + unlock + action header.
function containerActionsHtml(c: ContainerInfo, host: string): string {
  const attrs = `data-cname="${escapeHtml(c.name)}" data-cengine="${escapeHtml(c.engine)}" data-chost="${escapeHtml(host)}"`;
  return `<div class="container-actions"><button type="button" class="container-action ca-restart" data-container-action="restart" ${attrs} title="Restart ${escapeHtml(c.name)}" aria-label="Restart ${escapeHtml(c.name)}">↻</button><button type="button" class="container-action ca-pull" data-container-action="pull" ${attrs} title="Pull latest image + recreate ${escapeHtml(c.name)}" aria-label="Pull latest ${escapeHtml(c.name)}">⬇</button></div>`;
}

function containerVersionBadgeHtml(c: ContainerInfo): string {
  const v = c.version;
  if (!v) return '';
  const current = v.current || '';
  const latest = v.latest || current;
  const title = `${c.image}\ncurrent: ${current}\nlatest: ${latest}\n${v.detail || ''}`.trim();
  if (v.state === 'behind' && v.behind > 0) {
    return `<span class="ci-version behind" title="${escapeHtml(title)}">${escapeHtml(String(v.behind))} behind</span>`;
  }
  return `<span class="ci-version current" title="${escapeHtml(title)}">current</span>`;
}

// Shared row for local + remote container lists: name + engine tag, image, status + age, stats,
// then actions. Stopped/unhealthy get a state class for greying/highlighting.
function containerRowHtml(c: ContainerInfo, extraClass = '', host = ''): string {
  const chips = containerStatChipsHtml(c);
  const statsHtml = chips ? `<div class="ci-stats">${chips}</div>` : '';
  const age = containerAge(c);
  const ageHtml = age ? `<span class="container-age" title="${escapeHtml(c.status)}">${escapeHtml(age)}</span>` : '';
  const desc = containerDescription(c);
  const descHtml = desc
    ? `<div class="ci-desc" data-edit-desc="${escapeHtml(c.name)}" title="${escapeHtml(desc)} — click to edit">${escapeHtml(desc)}</div>`
    : `<div class="ci-desc ci-desc-empty" data-edit-desc="${escapeHtml(c.name)}" title="Add a description">+ description</div>`;
  return `<div class="container-item ${extraClass} state-${containerState(c.status)}">`
    + `<div class="ci-row1"><b>${escapeHtml(c.name)}</b><small class="ci-engine">${escapeHtml(c.engine)}</small>${containerActionsHtml(c, host)}</div>`
    + `<div class="ci-image-line"><div class="ci-image" title="${escapeHtml(c.image)}">${escapeHtml(c.image)}</div>${containerVersionBadgeHtml(c)}</div>`
    + descHtml
    + `<div class="ci-row2"><em>${escapeHtml(c.status)}</em>${ageHtml}</div>`
    + statsHtml + `</div>`;
}

// Denser 2-line row for the remote host cards: status dot + name + cpu/mem on top, image + age
// below. Full status lives in the dot/age tooltips. Keeps long lists short and tidy.
function compactContainerRowHtml(c: ContainerInfo, host: string): string {
  const state = containerState(c.status);
  const age = containerAge(c);
  // Same CPU/mem pills as the local panel (intensity bar + %-of-limit), kept on one line.
  const chips = containerStatChipsHtml(c);
  const rightHtml = chips ? `<span class="ci-cpu">${chips}</span>` : '';
  const badge = age || c.status.split(/[\s(]/)[0];
  const badgeHtml = badge ? `<span class="container-age" title="${escapeHtml(c.status)}">${escapeHtml(badge)}</span>` : '';
  // Line 2 shows the description when there is one (image to the tooltip), else the image.
  // Compact remote rows are passive except for their explicit action buttons.
  const desc = containerDescription(c);
  const subText = desc || c.image;
  const subTitle = desc ? `${desc}\n${c.image}` : c.image;
  const subClass = desc ? 'ci-image has-desc' : 'ci-image';
  const versionHtml = containerVersionBadgeHtml(c);
  const badges = versionHtml || badgeHtml ? `<span class="ci-badges">${versionHtml}${badgeHtml}</span>` : '';
  return `<div class="container-item remote-container compact state-${state}">`
    + `<div class="ci-top"><span class="ci-dot" title="${escapeHtml(c.status)}"></span><b>${escapeHtml(c.name)}</b>${rightHtml}${containerActionsHtml(c, host)}</div>`
    + `<div class="ci-bot"><span class="${subClass}" title="${escapeHtml(subTitle)}">${escapeHtml(subText)}</span>${badges}</div>`
    + `</div>`;
}

const SENSOR_LABEL_ALIASES_KEY = 'sdSensorLabelAliases';
let latestMachineMetrics: MachineMetrics | null = null;
let remoteHostsLoaded = false;
let remoteHostsLoading = false;
let ghRunsLoaded = false;
let ghRunsLoading = false;

function meterLevel(pct: number): string {
  return pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
}

function tempLevel(c: number): string {
  return c >= 85 ? 'crit' : c >= 70 ? 'warn' : 'ok';
}

// Only the temps that matter — CPU, GPU, NVMe. Drops ACPI zones, Wi-Fi/chipset noise.
function isCoreSensor(rawLabel: string): boolean {
  const l = rawLabel.toLowerCase();
  if (/nvme/.test(l)) return true;
  if (/k10temp|coretemp|tctl|tdie|\bcpu\b|package id|\bcore\s*\d/.test(l)) return true;
  if (/amdgpu|nouveau|nvidia|radeon|\bgpu\b/.test(l)) return true;
  return false;
}

function fmtGiB(kb: number): string {
  return (kb / 1048576).toFixed(1);
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTemp(celsius: number): string {
  return `${celsius.toFixed(0)}°C`;
}

function sensorLabelAliases(): Record<string, string> {
  return storageJson<Record<string, string>>(SENSOR_LABEL_ALIASES_KEY, {});
}

function friendlySensorLabel(label: string): string {
  const compact = label.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = compact.toLowerCase();
  if (lower.includes('k10temp') && lower.includes('tctl')) return 'CPU package';
  if (lower.includes('k10temp') && lower.includes('tdie')) return 'CPU die';
  if (lower.includes('coretemp') && lower.includes('package')) return 'CPU package';
  if (lower.includes('coretemp') && lower.includes('core')) return compact.replace(/^coretemp\s*/i, 'CPU ');
  if (lower.includes('amdgpu') && lower.includes('edge')) return 'GPU edge';
  if (lower.includes('amdgpu') && lower.includes('junction')) return 'GPU hotspot';
  if (lower.includes('nvme') && lower.includes('composite')) return 'NVMe composite';
  if (lower.includes('nvme')) return 'NVMe drive';
  if (lower.includes('acpitz')) return 'ACPI thermal zone';
  if (lower.includes('mt7921') || lower.includes('iwlwifi') || lower.includes('wifi') || lower.includes('wlan')) return 'Wi-Fi adapter';
  const tempMatch = /\btemp\s*(\d+)\b/i.exec(compact);
  if (tempMatch) return `Thermal sensor ${tempMatch[1]}`;
  return compact || 'Thermal sensor';
}

function sensorDisplayLabel(raw: string): string {
  const alias = sensorLabelAliases()[raw]?.trim();
  return alias || friendlySensorLabel(raw);
}

function renameSensorLabel(raw: string): void {
  if (!raw) return;
  const fallback = friendlySensorLabel(raw);
  const current = sensorDisplayLabel(raw);
  const next = window.prompt('Sensor name', current);
  if (next === null) return;
  const clean = next.trim().replace(/\s+/g, ' ').slice(0, 48);
  const aliases = sensorLabelAliases();
  if (!clean || clean === raw || clean === fallback) {
    delete aliases[raw];
  } else {
    aliases[raw] = clean;
  }
  localStorage.setItem(SENSOR_LABEL_ALIASES_KEY, JSON.stringify(aliases));
  if (latestMachineMetrics) renderMetrics(latestMachineMetrics);
  toast('Sensor renamed');
}

function setMeter(name: string, pct: number, text: string): void {
  const bar = document.querySelector<HTMLElement>(`[data-bar="${name}"]`);
  const val = document.querySelector<HTMLElement>(`[data-m="${name}"]`);
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(0)}%`;
    bar.className = meterLevel(pct);
  }
  if (val) val.textContent = text;
}

function renderMetrics(m: MachineMetrics): void {
  latestMachineMetrics = m;
  document.querySelector('.metrics')?.classList.remove('loading');
  const host = document.getElementById('metricsHost');
  const mhz = m.cpu_mhz ? ` · ${Math.round(m.cpu_mhz).toLocaleString()} MHz` : '';
  const ip = m.ip ? ` · ${m.ip}` : '';
  if (host) host.textContent = `${m.hostname}${ip} · CPU ${m.cpu_cores} cores${mhz} · uptime ${fmtUptime(m.uptime_secs)}`;

  setMeter('cpu', m.cpu_pct, `${m.cpu_pct.toFixed(0)}%`);
  setMeter('mem', m.mem_pct, `${fmtGiB(m.mem_used_kb)} / ${fmtGiB(m.mem_total_kb)} GiB · ${m.mem_pct.toFixed(0)}%`);

  const load = document.getElementById('metricLoad');
  if (load) load.textContent = `load ${m.load1.toFixed(2)} · ${m.load5.toFixed(2)} · ${m.load15.toFixed(2)}`;

  const temps = document.getElementById('metricTemps');
  if (temps) {
    if (!dashboardSettings.panels.machineSensors) {
      temps.hidden = true;
      temps.innerHTML = '';
    } else {
      temps.hidden = false;
      const list = (m.temps || []).filter((t) => isCoreSensor(t.label)).sort((a, b) => b.celsius - a.celsius);
      if (!list.length) {
        temps.innerHTML = '<div class="muted sensor-empty">No CPU/GPU/NVMe sensors</div>';
      } else {
        // Compact chips, identical to the remote-host cards — click a chip to rename the sensor.
        temps.innerHTML = `<div class="rm-temps">${list.map((t) =>
          `<button type="button" class="rm-temp ${tempLevel(t.celsius)}" data-rename-sensor="${escapeHtml(t.label)}" title="${escapeHtml(t.label)} — click to rename">${escapeHtml(sensorDisplayLabel(t.label))} ${formatTemp(t.celsius)}</button>`
        ).join('')}</div>`;
      }
    }
  }
}

function renderContainers(containers: ContainerInfo[]): void {
  const list = document.getElementById('containerList');
  if (!list) return;
  if (!containers.length) {
    list.innerHTML = '<div class="muted container-empty">No containers</div>';
    return;
  }
  const summary = `<div class="container-health">${escapeHtml(containerOverview(containers))}</div>`;
  list.innerHTML = summary + containers.map((c) => containerRowHtml(c)).join('');
}

function remoteProbeText(host: RemoteHostStatus): string {
  if (typeof host.ping_ms === 'number') return `ping ${host.ping_ms} ms`;
  if (typeof host.ssh_ms === 'number') return `ssh ${host.ssh_ms} ms`;
  return 'no response';
}

function remoteCheckedText(host: RemoteHostStatus): string {
  const checked = Date.parse(host.checked_at || '');
  if (!Number.isFinite(checked)) return remoteProbeText(host);
  const age = Math.max(0, Math.round((Date.now() - checked) / 1000));
  return `${remoteProbeText(host)} · ${age < 5 ? 'now' : `${age}s ago`}`;
}

// Compact CPU/RAM/load (+ optional temps) block for a remote host card. Reuses the same
// .meter bar styling as the local Machine widget, but with static widths since there are
// many cards. Temps follow the machineSensors panel toggle, like the local widget.
function remoteMetricsHtml(m: RemoteMetrics): string {
  const cpu = Math.max(0, Math.min(100, m.cpu_pct));
  const memPct = Math.max(0, Math.min(100, m.mem_pct));
  const cores = m.cpu_cores ? `${m.cpu_cores} cores · ` : '';
  const up = m.uptime_secs ? ` · up ${fmtUptime(m.uptime_secs)}` : '';
  const meta = `${cores}load ${m.load1.toFixed(2)} · ${m.load5.toFixed(2)} · ${m.load15.toFixed(2)}${up}`;
  let temps = '';
  const coreTemps = (m.temps || []).filter((t) => isCoreSensor(t.label));
  if (dashboardSettings.panels.machineSensors && coreTemps.length) {
    const chips = coreTemps.slice(0, 5).map((t) =>
      `<span class="rm-temp ${tempLevel(t.celsius)}" title="${escapeHtml(t.label)}">${escapeHtml(sensorDisplayLabel(t.label))} ${formatTemp(t.celsius)}</span>`).join('');
    temps = `<div class="rm-temps">${chips}</div>`;
  }
  const row = (label: string, pct: number, text: string) =>
    `<div class="rm-line"><span>${label}</span><div class="meter"><i class="${meterLevel(pct)}" style="width:${pct.toFixed(0)}%"></i></div><b>${escapeHtml(text)}</b></div>`;
  return `<div class="remote-metrics">${row('CPU', cpu, `${cpu.toFixed(0)}%`)}${row('RAM', memPct, `${fmtGiB(m.mem_used_kb)}/${fmtGiB(m.mem_total_kb)}G · ${memPct.toFixed(0)}%`)}<div class="rm-meta">${escapeHtml(meta)}</div>${temps}</div>`;
}

function renderRemoteHosts(hosts: RemoteHostStatus[]): void {
  const list = document.getElementById('remoteHostList');
  if (!list) return;
  if (!hosts.length) {
    list.innerHTML = '<div class="muted remote-empty">No remote hosts configured</div>';
    return;
  }
  const legendStates: ContainerStateKind[] = ['running', 'unhealthy', 'restarting', 'crashed', 'paused', 'stopped'];
  const legendDots = legendStates
    .map((st) => `<span class="lg"><i class="lg-dot ${st}"></i>${CONTAINER_STATE_LABEL[st]}</span>`).join('');
  const legend = `<div class="remote-legend">${legendDots}<span class="lg"><b class="lg-ic">↻</b>restart</span><span class="lg"><b class="lg-ic">⬇</b>pull</span></div>`;
  list.innerHTML = legend + hosts.map((host) => {
    const containers = host.containers || [];
    const total = typeof host.container_total === 'number' ? host.container_total : containers.length;
    const shownNote = total > containers.length ? ` · showing ${containers.length} of ${total}` : '';
    const containerHtml = containers.length
      ? `<div class="remote-count">${escapeHtml(containerOverview(containers))}${escapeHtml(shownNote)}</div><div class="remote-containers">${containers.map((c) => compactContainerRowHtml(c, host.id)).join('')}</div>`
      : `<div class="muted remote-empty">${host.online ? 'No containers' : escapeHtml(host.error || 'Remote host is offline')}</div>`;
    const error = host.error && host.online ? `<div class="remote-error">${escapeHtml(host.error)}</div>` : '';
    const metricsHtml = host.metrics ? remoteMetricsHtml(host.metrics) : '';
    const ipText = host.ip ? ` · ${host.ip}` : '';
    return `<div class="remote-host-card ${host.online ? 'online' : 'offline'}"><div class="remote-head"><span class="dot ${host.online ? 'on' : ''}"></span><div><b>${escapeHtml(host.label || host.id)}</b><small title="${escapeHtml(host.target)}">${host.online ? 'Online' : 'Offline'}${escapeHtml(ipText)} · ${escapeHtml(remoteCheckedText(host))}</small></div></div>${metricsHtml}${containerHtml}${error}</div>`;
  }).join('');
}

function remoteHostsLoadingHtml(): string {
  return `<div class="remote-loading"><div><b>Checking remote hosts</b><span>Checking...</span></div><div class="skeleton skel-line skel-w70"></div><div class="skeleton skel-bar"></div><div class="skeleton skel-crow"></div><div class="skeleton skel-crow"></div></div>`;
}

function renderRemoteHostsError(message: string): void {
  const list = document.getElementById('remoteHostList');
  if (!list) return;
  list.innerHTML = `<div class="remote-error remote-load-error">${escapeHtml(message)}</div>`;
}

function isoRelativeTime(iso: string | null | undefined): string {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return 'updated unknown';
  return `updated ${fmtTime(Math.floor(ms / 1000)).replace('just now', 'now')}`;
}

function ghRunState(run?: GhRun | null): { label: string; cls: string } {
  if (!run) return { label: 'no runs', cls: 'muted' };
  const status = (run.status || '').toLowerCase();
  const conclusion = (run.conclusion || '').toLowerCase();
  if (status === 'queued' || status === 'in_progress') {
    return { label: status.replace('_', ' '), cls: 'pending' };
  }
  if (status === 'completed') {
    if (conclusion === 'success') return { label: 'success', cls: 'success' };
    if (conclusion === 'failure') return { label: 'failure', cls: 'failure' };
    return { label: conclusion || 'completed', cls: 'muted' };
  }
  return { label: status || 'unknown', cls: 'muted' };
}

function ghRateLimitHtml(payload: GhRunsResult): string {
  if (typeof payload.rate_limit_remaining !== 'number') return '';
  const reset = typeof payload.rate_limit_reset === 'number'
    ? ` · resets ${new Date(payload.rate_limit_reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';
  const cached = payload.cached ? ' · cached' : '';
  return `<div class="gh-rate-limit">GitHub API ${payload.rate_limit_remaining} left${reset}${cached}</div>`;
}

function ghRunCardHtml(repo: GhRepoStatus): string {
  const run = repo.run || null;
  const state = ghRunState(run);
  const error = repo.error ? `<div class="remote-error gh-run-error">${escapeHtml(repo.error)}</div>` : '';
  if (!run) {
    return `<div class="gh-run-card empty ${repo.ok ? '' : 'stale'}"><div class="gh-run-head"><b>${escapeHtml(repo.repo)}</b><span class="run-status-badge ${state.cls}">${escapeHtml(state.label)}</span></div>${error}</div>`;
  }
  const title = run.display_title || run.name || 'Workflow run';
  const titleHtml = run.html_url
    ? `<a href="${escapeHtml(run.html_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
    : escapeHtml(title);
  const branch = run.head_branch ? `<span class="run-branch-tag">${escapeHtml(run.head_branch)}</span>` : '';
  const runNumber = run.run_number ? `<span class="gh-run-number">#${run.run_number}</span>` : '';
  const event = run.event ? `<span>${escapeHtml(run.event)}</span>` : '';
  const workflow = run.name && run.name !== title ? `<div class="gh-run-workflow">${escapeHtml(run.name)}</div>` : '';
  return `<div class="gh-run-card ${state.cls} ${repo.ok ? '' : 'stale'}"><div class="gh-run-head"><b>${escapeHtml(repo.repo)}</b><span class="run-status-badge ${state.cls}">${escapeHtml(state.label)}</span></div><div class="gh-run-title">${titleHtml}</div>${workflow}<div class="gh-run-meta">${branch}${runNumber}${event}<span>${escapeHtml(isoRelativeTime(run.updated_at))}</span></div>${error}</div>`;
}

function renderGhRuns(payload: GhRunsResult): void {
  const list = document.getElementById('ciRunsList');
  if (!list) return;
  if (!payload.repos.length) {
    list.innerHTML = '<div class="muted gh-runs-empty">No GitHub repos configured</div>';
    return;
  }
  list.innerHTML = ghRateLimitHtml(payload) + payload.repos.map(ghRunCardHtml).join('');
}

function ghRunsLoadingHtml(): string {
  return `<div class="remote-loading gh-runs-loading"><div><b>Checking CI runs</b><span>Checking...</span></div><div class="skeleton skel-line skel-w70"></div><div class="skeleton skel-bar"></div><div class="skeleton skel-line skel-w50"></div></div>`;
}

function renderGhRunsError(message: string): void {
  const list = document.getElementById('ciRunsList');
  if (!list) return;
  list.innerHTML = `<div class="remote-error remote-load-error">${escapeHtml(message)}</div>`;
}

async function loadMetrics(): Promise<void> {
  if (!document.getElementById('metricsPanel') || !dashboardSettings.panels.machine) return;
  const response = await fetch('/api/metrics', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  renderMetrics(await response.json() as MachineMetrics);
}

async function loadContainers(): Promise<void> {
  if (!document.getElementById('containersPanel') || !dashboardSettings.panels.containers) return;
  const response = await fetch('/api/containers', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const payload = await response.json() as { containers?: ContainerInfo[] };
  renderContainers(payload.containers || []);
}

async function loadRemoteHosts(): Promise<void> {
  const panel = document.getElementById('remotePanel');
  const list = document.getElementById('remoteHostList');
  if (!panel || !list || !dashboardSettings.panels.remoteHosts) return;
  if (remoteHostsLoading) return;
  remoteHostsLoading = true;
  panel.classList.add('loading');
  list.setAttribute('aria-busy', 'true');
  if (!remoteHostsLoaded) list.innerHTML = remoteHostsLoadingHtml();
  try {
    const response = await fetch('/api/remote-hosts', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Remote hosts returned ${response.status}`);
    const payload = await response.json() as { hosts?: RemoteHostStatus[] };
    remoteHostsLoaded = true;
    renderRemoteHosts(payload.hosts || []);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load remote hosts';
    if (!remoteHostsLoaded) {
      renderRemoteHostsError(message);
    } else if (!list.querySelector('.remote-stale-error')) {
      list.insertAdjacentHTML('afterbegin', `<div class="remote-error remote-stale-error">Remote refresh failed: ${escapeHtml(message)}</div>`);
    }
  } finally {
    remoteHostsLoading = false;
    panel.classList.remove('loading');
    list.removeAttribute('aria-busy');
  }
}

async function loadGhRuns(): Promise<void> {
  const panel = document.getElementById('ciRunsPanel');
  const list = document.getElementById('ciRunsList');
  if (!panel || !list || !dashboardSettings.panels.ciRuns) return;
  if (ghRunsLoading) return;
  ghRunsLoading = true;
  panel.classList.add('loading');
  list.setAttribute('aria-busy', 'true');
  if (!ghRunsLoaded) list.innerHTML = ghRunsLoadingHtml();
  try {
    const response = await fetch('/api/gh-runs', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`CI runs returned ${response.status}`);
    ghRunsLoaded = true;
    renderGhRuns(await response.json() as GhRunsResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load CI runs';
    if (!ghRunsLoaded) {
      renderGhRunsError(message);
    } else if (!list.querySelector('.gh-stale-error')) {
      list.insertAdjacentHTML('afterbegin', `<div class="remote-error remote-stale-error gh-stale-error">CI refresh failed: ${escapeHtml(message)}</div>`);
    }
  } finally {
    ghRunsLoading = false;
    panel.classList.remove('loading');
    list.removeAttribute('aria-busy');
  }
}

// Restart / pull-latest a container. Confirms first; server re-checks login + unlock + action header.
async function containerAction(host: string, engine: string, name: string, action: string): Promise<void> {
  if (!shellUnlocked) { toast('Unlock shells first to manage containers'); return; }
  if (!name || !engine) return;
  const verb = action === 'pull' ? 'Pull latest image for' : 'Restart';
  const where = host ? ` on ${host}` : '';
  if (!window.confirm(`${verb} "${name}"${where}?`)) return;
  toast(`${action === 'pull' ? 'Pulling' : 'Restarting'} ${name}…`);
  try {
    const payload = await postJson('/api/container-action', { host, engine, name, action }) as { message?: string };
    toast(payload.message || `${name}: done`);
  } catch (error) {
    toast((error as Error).message || 'Action failed');
  }
  await Promise.allSettled([loadContainers(), loadRemoteHosts()]);
}

(window as any).containerAction = containerAction;
(window as any).loadMetrics = loadMetrics;
(window as any).loadContainers = loadContainers;
(window as any).loadRemoteHosts = loadRemoteHosts;
(window as any).loadGhRuns = loadGhRuns;
