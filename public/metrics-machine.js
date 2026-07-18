"use strict";
function meterLevel(pct) {
    return pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok';
}
function tempLevel(c) {
    return c >= 85 ? 'crit' : c >= 70 ? 'warn' : 'ok';
}
// Only the temps that matter — CPU, GPU, NVMe. Drops ACPI zones, Wi-Fi/chipset noise.
function isCoreSensor(rawLabel) {
    const l = rawLabel.toLowerCase();
    if (/nvme/.test(l))
        return true;
    if (/k10temp|coretemp|tctl|tdie|\bcpu\b|package id|\bcore\s*\d/.test(l))
        return true;
    if (/amdgpu|nouveau|nvidia|radeon|\bgpu\b/.test(l))
        return true;
    return false;
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
function formatTemp(celsius) {
    return `${celsius.toFixed(0)}°C`;
}
function sensorLabelAliases() {
    return storageJson(SENSOR_LABEL_ALIASES_KEY, {});
}
function friendlySensorLabel(label) {
    const compact = label.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lower = compact.toLowerCase();
    if (lower.includes('k10temp') && lower.includes('tctl'))
        return 'CPU package';
    if (lower.includes('k10temp') && lower.includes('tdie'))
        return 'CPU die';
    if (lower.includes('coretemp') && lower.includes('package'))
        return 'CPU package';
    if (lower.includes('coretemp') && lower.includes('core'))
        return compact.replace(/^coretemp\s*/i, 'CPU ');
    if (lower.includes('amdgpu') && lower.includes('edge'))
        return 'GPU edge';
    if (lower.includes('amdgpu') && lower.includes('junction'))
        return 'GPU hotspot';
    if (lower.includes('nvme') && lower.includes('composite'))
        return 'NVMe composite';
    if (lower.includes('nvme'))
        return 'NVMe drive';
    if (lower.includes('acpitz'))
        return 'ACPI thermal zone';
    if (lower.includes('mt7921') || lower.includes('iwlwifi') || lower.includes('wifi') || lower.includes('wlan'))
        return 'Wi-Fi adapter';
    const tempMatch = /\btemp\s*(\d+)\b/i.exec(compact);
    if (tempMatch)
        return `Thermal sensor ${tempMatch[1]}`;
    return compact || 'Thermal sensor';
}
function sensorDisplayLabel(raw) {
    const alias = sensorLabelAliases()[raw]?.trim();
    return alias || friendlySensorLabel(raw);
}
function renameSensorLabel(raw) {
    if (!raw)
        return;
    const fallback = friendlySensorLabel(raw);
    const current = sensorDisplayLabel(raw);
    const next = window.prompt('Sensor name', current);
    if (next === null)
        return;
    const clean = next.trim().replace(/\s+/g, ' ').slice(0, 48);
    const aliases = sensorLabelAliases();
    if (!clean || clean === raw || clean === fallback) {
        delete aliases[raw];
    }
    else {
        aliases[raw] = clean;
    }
    localStorage.setItem(SENSOR_LABEL_ALIASES_KEY, JSON.stringify(aliases));
    if (latestMachineMetrics)
        renderMetrics(latestMachineMetrics);
    toast('Sensor renamed');
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
    latestMachineMetrics = m;
    document.querySelector('.metrics')?.classList.remove('loading');
    const host = document.getElementById('metricsHost');
    const mhz = m.cpu_mhz ? ` · ${Math.round(m.cpu_mhz).toLocaleString()} MHz` : '';
    const ip = m.ip ? ` · ${m.ip}` : '';
    if (host)
        host.textContent = `${m.hostname}${ip} · CPU ${m.cpu_cores} cores${mhz} · uptime ${fmtUptime(m.uptime_secs)}`;
    setMeter('cpu', m.cpu_pct, `${m.cpu_pct.toFixed(0)}%`);
    setMeter('mem', m.mem_pct, `${fmtGiB(m.mem_used_kb)} / ${fmtGiB(m.mem_total_kb)} GiB · ${m.mem_pct.toFixed(0)}%`);
    const load = document.getElementById('metricLoad');
    if (load)
        load.textContent = `load ${m.load1.toFixed(2)} · ${m.load5.toFixed(2)} · ${m.load15.toFixed(2)}`;
    const temps = document.getElementById('metricTemps');
    if (temps) {
        if (!dashboardSettings.panels.machineSensors) {
            temps.hidden = true;
            temps.innerHTML = '';
        }
        else {
            temps.hidden = false;
            const list = (m.temps || []).filter((t) => isCoreSensor(t.label)).sort((a, b) => b.celsius - a.celsius);
            if (!list.length) {
                temps.innerHTML = '<div class="muted sensor-empty">No CPU/GPU/NVMe sensors</div>';
            }
            else {
                // Compact chips, identical to the remote-host cards — click a chip to rename the sensor.
                temps.innerHTML = `<div class="rm-temps">${list.map((t) => `<button type="button" class="rm-temp ${tempLevel(t.celsius)}" data-rename-sensor="${escapeHtml(t.label)}" title="${escapeHtml(t.label)} — click to rename">${escapeHtml(sensorDisplayLabel(t.label))} ${formatTemp(t.celsius)}</button>`).join('')}</div>`;
            }
        }
    }
}
