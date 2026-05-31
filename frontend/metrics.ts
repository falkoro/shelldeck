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

// running = "Up ..."; flag unhealthy/restarting; everything else (Exited/Created) = stopped.
function containerState(status: string): 'running' | 'unhealthy' | 'stopped' {
  const s = (status || '').toLowerCase();
  if (s.includes('unhealthy')) return 'unhealthy';
  if (s.startsWith('restarting')) return 'unhealthy';
  if (s.startsWith('up')) return 'running';
  return 'stopped';
}

// "23 running · 2 stopped · 1 unhealthy" — omits zero buckets.
function containerHealth(containers: ContainerInfo[]): string {
  let running = 0; let stopped = 0; let unhealthy = 0;
  for (const c of containers) {
    const st = containerState(c.status);
    if (st === 'unhealthy') unhealthy += 1;
    else if (st === 'stopped') stopped += 1;
    else running += 1;
  }
  const parts: string[] = [];
  if (running) parts.push(`${running} running`);
  if (stopped) parts.push(`${stopped} stopped`);
  if (unhealthy) parts.push(`${unhealthy} unhealthy`);
  return parts.join(' · ') || 'no containers';
}

function containerStatsText(c: ContainerInfo): string {
  const bits: string[] = [];
  if (c.cpu) bits.push(`${c.cpu} CPU`);
  if (c.mem) bits.push(c.mem);
  return bits.join(' · ');
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

// Shared row for local + remote container lists: name + engine tag, image, status + age, stats,
// then actions. Stopped/unhealthy get a state class for greying/highlighting.
function containerRowHtml(c: ContainerInfo, extraClass = '', host = ''): string {
  const stats = containerStatsText(c);
  const statsHtml = stats ? `<div class="ci-stats">${escapeHtml(stats)}</div>` : '';
  const age = containerAge(c);
  const ageHtml = age ? `<span class="container-age" title="${escapeHtml(c.status)}">${escapeHtml(age)}</span>` : '';
  const desc = containerDescription(c);
  const descHtml = desc
    ? `<div class="ci-desc" data-edit-desc="${escapeHtml(c.name)}" title="${escapeHtml(desc)} — click to edit">${escapeHtml(desc)}</div>`
    : `<div class="ci-desc ci-desc-empty" data-edit-desc="${escapeHtml(c.name)}" title="Add a description">+ description</div>`;
  return `<div class="container-item ${extraClass} state-${containerState(c.status)}">`
    + `<div class="ci-row1"><b>${escapeHtml(c.name)}</b><small class="ci-engine">${escapeHtml(c.engine)}</small></div>`
    + `<div class="ci-image" title="${escapeHtml(c.image)}">${escapeHtml(c.image)}</div>`
    + descHtml
    + `<div class="ci-row2"><em>${escapeHtml(c.status)}</em>${ageHtml}</div>`
    + `${statsHtml}${containerActionsHtml(c, host)}</div>`;
}

// Denser 2-line row for the remote host cards: status dot + name + cpu/mem on top, image + age
// below. Full status lives in the dot/age tooltips. Keeps long lists short and tidy.
function compactContainerRowHtml(c: ContainerInfo, host: string): string {
  const state = containerState(c.status);
  const age = containerAge(c);
  const memUsed = (c.mem || '').split('/')[0].trim();
  const right = c.cpu ? `${c.cpu}${memUsed ? ` · ${memUsed}` : ''}` : '';
  const rightHtml = right ? `<span class="ci-cpu">${escapeHtml(right)}</span>` : '';
  const badge = age || c.status.split(/[\s(]/)[0];
  const badgeHtml = badge ? `<span class="container-age" title="${escapeHtml(c.status)}">${escapeHtml(badge)}</span>` : '';
  // Line 2 shows the description when there is one (image to the tooltip), else the image. Click
  // to edit/add a description either way.
  const desc = containerDescription(c);
  const subText = desc || c.image;
  const subTitle = desc ? `${desc}\n${c.image} — click to edit` : `${c.image} — click to add a description`;
  const subClass = desc ? 'ci-image ci-editdesc has-desc' : 'ci-image ci-editdesc';
  return `<div class="container-item remote-container compact state-${state}">`
    + `<div class="ci-top"><span class="ci-dot" title="${escapeHtml(c.status)}"></span><b>${escapeHtml(c.name)}</b>${rightHtml}</div>`
    + `<div class="ci-bot"><span class="${subClass}" data-edit-desc="${escapeHtml(c.name)}" title="${escapeHtml(subTitle)}">${escapeHtml(subText)}</span>${badgeHtml}</div>`
    + `${containerActionsHtml(c, host)}</div>`;
}

const SENSOR_LABEL_ALIASES_KEY = 'sdSensorLabelAliases';
let latestMachineMetrics: MachineMetrics | null = null;

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
      return;
    }
    temps.hidden = false;
    const list = (m.temps || []).filter((t) => isCoreSensor(t.label)).sort((a, b) => b.celsius - a.celsius);
    if (!list.length) {
      temps.innerHTML = '<div class="muted sensor-empty">No CPU/GPU/NVMe sensors reported</div>';
    } else {
      temps.innerHTML = `<div class="sensor-panel"><div class="sensor-panel-head"><b>Thermal sensors</b><small>${list.length} live readings</small></div><div class="sensor-list">${list.map((t) => {
        const display = sensorDisplayLabel(t.label);
        return `<div class="sensor-row ${tempLevel(t.celsius)}"><div><b>${escapeHtml(display)}</b><small title="${escapeHtml(t.label)}">${escapeHtml(t.label)}</small></div><span>${formatTemp(t.celsius)}</span><button type="button" class="sensor-rename" data-rename-sensor="${escapeHtml(t.label)}" title="Rename sensor">${icon('edit')}</button></div>`;
      }).join('')}</div></div>`;
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
  const summary = `<div class="container-health">${escapeHtml(containerHealth(containers))}</div>`;
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
  const legend = '<div class="remote-legend"><span class="lg"><i class="lg-dot running"></i>running</span><span class="lg"><i class="lg-dot unhealthy"></i>unhealthy</span><span class="lg"><i class="lg-dot stopped"></i>stopped</span><span class="lg"><b class="lg-ic">↻</b>restart</span><span class="lg"><b class="lg-ic">⬇</b>pull</span></div>';
  list.innerHTML = legend + hosts.map((host) => {
    const containers = host.containers || [];
    const total = typeof host.container_total === 'number' ? host.container_total : containers.length;
    const shownNote = total > containers.length ? ` · showing ${containers.length} of ${total}` : '';
    const containerHtml = containers.length
      ? `<div class="remote-count">${escapeHtml(containerHealth(containers))}${escapeHtml(shownNote)}</div><div class="remote-containers">${containers.map((c) => compactContainerRowHtml(c, host.id)).join('')}</div>`
      : `<div class="muted remote-empty">${host.online ? 'No containers' : escapeHtml(host.error || 'Remote host is offline')}</div>`;
    const error = host.error && host.online ? `<div class="remote-error">${escapeHtml(host.error)}</div>` : '';
    const metricsHtml = host.metrics ? remoteMetricsHtml(host.metrics) : '';
    const ipText = host.ip ? ` · ${host.ip}` : '';
    return `<div class="remote-host-card ${host.online ? 'online' : 'offline'}"><div class="remote-head"><span class="dot ${host.online ? 'on' : ''}"></span><div><b>${escapeHtml(host.label || host.id)}</b><small title="${escapeHtml(host.target)}">${host.online ? 'Online' : 'Offline'}${escapeHtml(ipText)} · ${escapeHtml(remoteCheckedText(host))}</small></div></div>${metricsHtml}${containerHtml}${error}</div>`;
  }).join('');
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
  if (!document.getElementById('remotePanel') || !dashboardSettings.panels.remoteHosts) return;
  const response = await fetch('/api/remote-hosts', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const payload = await response.json() as { hosts?: RemoteHostStatus[] };
  renderRemoteHosts(payload.hosts || []);
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
