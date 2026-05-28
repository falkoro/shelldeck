"use strict";
// Live host machine stats (CPU / RAM / temps), polled from /api/metrics.
// Mirrors the CachyOS system-monitor widget: at-a-glance CPU%, RAM, and temperatures.
function meterLevel(pct) {
    return pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
}
function tempLevel(c) {
    return c >= 85 ? 'crit' : c >= 70 ? 'warn' : 'ok';
}
function fmtGiB(kb) {
    return (kb / 1048576).toFixed(1);
}
function fmtUptime(secs) {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (d > 0)
        return `${d}d ${h}h`;
    if (h > 0)
        return `${h}h ${m}m`;
    return `${m}m`;
}
function setMeter(name, pct, text) {
    const bar = document.querySelector(`[data-bar="${name}"]`);
    const val = document.querySelector(`[data-m="${name}"]`);
    if (bar) {
        bar.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(0)}%`;
        bar.className = meterLevel(pct);
    }
    if (val)
        val.textContent = text;
}
function renderMetrics(m) {
    const host = document.getElementById('metricsHost');
    if (host)
        host.textContent = `${m.hostname} · ${m.cpu_cores} cores · up ${fmtUptime(m.uptime_secs)}`;
    setMeter('cpu', m.cpu_pct, `${m.cpu_pct.toFixed(0)}%`);
    setMeter('mem', m.mem_pct, `${fmtGiB(m.mem_used_kb)} / ${fmtGiB(m.mem_total_kb)} GiB`);
    const load = document.getElementById('metricLoad');
    if (load)
        load.textContent = `load ${m.load1.toFixed(2)} · ${m.load5.toFixed(2)} · ${m.load15.toFixed(2)}`;
    const temps = document.getElementById('metricTemps');
    if (temps) {
        temps.innerHTML = (m.temps || [])
            .map((t) => `<span class="temp-chip ${tempLevel(t.celsius)}" title="${escapeHtml(t.label)}">${escapeHtml(t.label)} <b>${t.celsius.toFixed(0)}°</b></span>`)
            .join('');
    }
}
async function loadMetrics() {
    if (!document.getElementById('metricsPanel'))
        return;
    const response = await fetch('/api/metrics', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    renderMetrics(await response.json());
}
window.loadMetrics = loadMetrics;
