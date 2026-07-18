"use strict";
function remoteProbeText(host) {
    if (typeof host.ping_ms === 'number')
        return `ping ${host.ping_ms} ms`;
    if (typeof host.ssh_ms === 'number')
        return `ssh ${host.ssh_ms} ms`;
    return 'no response';
}
function remoteCheckedText(host) {
    const checked = Date.parse(host.checked_at || '');
    if (!Number.isFinite(checked))
        return remoteProbeText(host);
    const age = Math.max(0, Math.round((Date.now() - checked) / 1000));
    return `${remoteProbeText(host)} · ${age < 5 ? 'now' : `${age}s ago`}`;
}
// Compact CPU/RAM/load (+ optional temps) block for a remote host card. Reuses the same
// .meter bar styling as the local Machine widget, but with static widths since there are
// many cards. Temps follow the machineSensors panel toggle, like the local widget.
function remoteMetricsHtml(m) {
    const cpu = Math.max(0, Math.min(100, m.cpu_pct));
    const memPct = Math.max(0, Math.min(100, m.mem_pct));
    const cores = m.cpu_cores ? `${m.cpu_cores} cores · ` : '';
    const up = m.uptime_secs ? ` · up ${fmtUptime(m.uptime_secs)}` : '';
    const meta = `${cores}load ${m.load1.toFixed(2)} · ${m.load5.toFixed(2)} · ${m.load15.toFixed(2)}${up}`;
    let temps = '';
    const coreTemps = (m.temps || []).filter((t) => isCoreSensor(t.label));
    if (dashboardSettings.panels.machineSensors && coreTemps.length) {
        const chips = coreTemps.slice(0, 5).map((t) => `<span class="rm-temp ${tempLevel(t.celsius)}" title="${escapeHtml(t.label)}">${escapeHtml(sensorDisplayLabel(t.label))} ${formatTemp(t.celsius)}</span>`).join('');
        temps = `<div class="rm-temps">${chips}</div>`;
    }
    const row = (label, pct, text) => `<div class="rm-line"><span>${label}</span><div class="meter"><i class="${meterLevel(pct)}" style="width:${pct.toFixed(0)}%"></i></div><b>${escapeHtml(text)}</b></div>`;
    return `<div class="remote-metrics">${row('CPU', cpu, `${cpu.toFixed(0)}%`)}${row('RAM', memPct, `${fmtGiB(m.mem_used_kb)}/${fmtGiB(m.mem_total_kb)}G · ${memPct.toFixed(0)}%`)}<div class="rm-meta">${escapeHtml(meta)}</div>${temps}</div>`;
}
function renderRemoteHosts(hosts) {
    const list = document.getElementById('remoteHostList');
    if (!list)
        return;
    if (!hosts.length) {
        list.innerHTML = '<div class="muted remote-empty">No remote hosts configured</div>';
        applyContainerPrivacy('remote');
        return;
    }
    const legendStates = ['running', 'unhealthy', 'restarting', 'crashed', 'paused', 'stopped'];
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
    applyContainerPrivacy('remote');
}
function remoteHostsLoadingHtml() {
    return `<div class="remote-loading"><div><b>Checking remote hosts</b><span>Checking...</span></div><div class="skeleton skel-line skel-w70"></div><div class="skeleton skel-bar"></div><div class="skeleton skel-crow"></div><div class="skeleton skel-crow"></div></div>`;
}
function renderRemoteHostsError(message) {
    const list = document.getElementById('remoteHostList');
    if (!list)
        return;
    list.innerHTML = `<div class="remote-error remote-load-error">${escapeHtml(message)}</div>`;
}
function isoRelativeTime(iso) {
    const ms = Date.parse(iso || '');
    if (!Number.isFinite(ms))
        return 'updated unknown';
    return `updated ${fmtTime(Math.floor(ms / 1000)).replace('just now', 'now')}`;
}
function ghRunState(run) {
    if (!run)
        return { label: 'no runs', cls: 'muted' };
    const status = (run.status || '').toLowerCase();
    const conclusion = (run.conclusion || '').toLowerCase();
    if (status === 'queued' || status === 'in_progress') {
        return { label: status.replace('_', ' '), cls: 'pending' };
    }
    if (status === 'completed') {
        if (conclusion === 'success')
            return { label: 'success', cls: 'success' };
        if (conclusion === 'failure')
            return { label: 'failure', cls: 'failure' };
        return { label: conclusion || 'completed', cls: 'muted' };
    }
    return { label: status || 'unknown', cls: 'muted' };
}
function ghRateLimitHtml(payload) {
    if (typeof payload.rate_limit_remaining !== 'number')
        return '';
    const reset = typeof payload.rate_limit_reset === 'number'
        ? ` · resets ${new Date(payload.rate_limit_reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : '';
    const cached = payload.cached ? ' · cached' : '';
    return `<div class="gh-rate-limit">GitHub API ${payload.rate_limit_remaining} left${reset}${cached}</div>`;
}
function ghRunCardHtml(repo) {
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
function renderGhRuns(payload) {
    const list = document.getElementById('ciRunsList');
    if (!list)
        return;
    if (!payload.repos.length) {
        list.innerHTML = '<div class="muted gh-runs-empty">No GitHub repos configured</div>';
        return;
    }
    list.innerHTML = ghRateLimitHtml(payload) + payload.repos.map(ghRunCardHtml).join('');
}
function ghRunsLoadingHtml() {
    return `<div class="remote-loading gh-runs-loading"><div><b>Checking CI runs</b><span>Checking...</span></div><div class="skeleton skel-line skel-w70"></div><div class="skeleton skel-bar"></div><div class="skeleton skel-line skel-w50"></div></div>`;
}
function renderGhRunsError(message) {
    const list = document.getElementById('ciRunsList');
    if (!list)
        return;
    list.innerHTML = `<div class="remote-error remote-load-error">${escapeHtml(message)}</div>`;
}
