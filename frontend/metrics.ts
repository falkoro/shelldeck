// Live host machine stats (CPU / RAM / temps), polled from /api/metrics.
// Mirrors the CachyOS system-monitor widget: at-a-glance CPU%, RAM, and temperatures.

interface MetricTemp {
  label: string;
  celsius: number;
}

interface MachineMetrics {
  hostname: string;
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
  error?: string | null;
}

const SENSOR_LABEL_ALIASES_KEY = 'sdSensorLabelAliases';
let latestMachineMetrics: MachineMetrics | null = null;

function meterLevel(pct: number): string {
  return pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
}

function tempLevel(c: number): string {
  return c >= 85 ? 'crit' : c >= 70 ? 'warn' : 'ok';
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
  const host = document.getElementById('metricsHost');
  const mhz = m.cpu_mhz ? ` · ${Math.round(m.cpu_mhz).toLocaleString()} MHz` : '';
  if (host) host.textContent = `${m.hostname} · CPU ${m.cpu_cores} cores${mhz} · uptime ${fmtUptime(m.uptime_secs)}`;

  setMeter('cpu', m.cpu_pct, `${m.cpu_pct.toFixed(0)}%`);
  setMeter('mem', m.mem_pct, `${fmtGiB(m.mem_used_kb)} / ${fmtGiB(m.mem_total_kb)} GiB`);

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
    const list = (m.temps || []).slice().sort((a, b) => b.celsius - a.celsius);
    if (!list.length) {
      temps.innerHTML = '<div class="muted sensor-empty">No thermal sensors reported</div>';
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
    list.innerHTML = '<div class="muted container-empty">No running containers</div>';
    return;
  }
  list.innerHTML = containers.map((container) => `<div class="container-item"><div><b>${escapeHtml(container.name)}</b><span>${escapeHtml(container.image)}</span></div><small>${escapeHtml(container.engine)}</small><em>${escapeHtml(container.status)}</em></div>`).join('');
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

function renderRemoteHosts(hosts: RemoteHostStatus[]): void {
  const list = document.getElementById('remoteHostList');
  if (!list) return;
  if (!hosts.length) {
    list.innerHTML = '<div class="muted remote-empty">No remote hosts configured</div>';
    return;
  }
  list.innerHTML = hosts.map((host) => {
    const containers = host.containers || [];
    const containerHtml = containers.length
      ? `<div class="remote-containers">${containers.slice(0, 8).map((container) => `<div class="container-item remote-container"><div><b>${escapeHtml(container.name)}</b><span>${escapeHtml(container.image)}</span></div><small>${escapeHtml(container.engine)}</small><em>${escapeHtml(container.status)}</em></div>`).join('')}</div>`
      : `<div class="muted remote-empty">${host.online ? 'No running containers' : escapeHtml(host.error || 'Remote host is offline')}</div>`;
    const error = host.error && host.online ? `<div class="remote-error">${escapeHtml(host.error)}</div>` : '';
    return `<div class="remote-host-card ${host.online ? 'online' : 'offline'}"><div class="remote-head"><span class="dot ${host.online ? 'on' : ''}"></span><div><b>${escapeHtml(host.label || host.id)}</b><small title="${escapeHtml(host.target)}">${host.online ? 'Online' : 'Offline'} · ${escapeHtml(remoteCheckedText(host))}</small></div></div>${containerHtml}${error}</div>`;
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

(window as any).loadMetrics = loadMetrics;
(window as any).loadContainers = loadContainers;
(window as any).loadRemoteHosts = loadRemoteHosts;
