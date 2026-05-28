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
  const host = document.getElementById('metricsHost');
  if (host) host.textContent = `${m.hostname} · ${m.cpu_cores} cores · up ${fmtUptime(m.uptime_secs)}`;

  setMeter('cpu', m.cpu_pct, `${m.cpu_pct.toFixed(0)}%`);
  setMeter('mem', m.mem_pct, `${fmtGiB(m.mem_used_kb)} / ${fmtGiB(m.mem_total_kb)} GiB`);

  const load = document.getElementById('metricLoad');
  if (load) load.textContent = `load ${m.load1.toFixed(2)} · ${m.load5.toFixed(2)} · ${m.load15.toFixed(2)}`;

  const temps = document.getElementById('metricTemps');
  if (temps) {
    temps.innerHTML = (m.temps || [])
      .map((t) => `<span class="temp-chip ${tempLevel(t.celsius)}" title="${escapeHtml(t.label)}">${escapeHtml(t.label)} <b>${t.celsius.toFixed(0)}°</b></span>`)
      .join('');
  }
}

async function loadMetrics(): Promise<void> {
  if (!document.getElementById('metricsPanel')) return;
  const response = await fetch('/api/metrics', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  renderMetrics(await response.json() as MachineMetrics);
}

(window as any).loadMetrics = loadMetrics;
