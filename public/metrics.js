"use strict";
async function loadMetrics() {
    if (!document.getElementById('metricsPanel') || !dashboardSettings.panels.machine)
        return;
    const response = await fetch('/api/metrics', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    renderMetrics(await response.json());
}
async function loadContainers() {
    if (!document.getElementById('containersPanel') || !dashboardSettings.panels.containers)
        return;
    const response = await fetch('/api/containers', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    const payload = await response.json();
    renderContainers(payload.containers || []);
}
async function loadRemoteHosts() {
    const panel = document.getElementById('remotePanel');
    const list = document.getElementById('remoteHostList');
    if (!panel || !list || !dashboardSettings.panels.remoteHosts)
        return;
    if (remoteHostsLoading)
        return;
    remoteHostsLoading = true;
    panel.classList.add('loading');
    list.setAttribute('aria-busy', 'true');
    if (!remoteHostsLoaded)
        list.innerHTML = remoteHostsLoadingHtml();
    try {
        const response = await fetch('/api/remote-hosts', { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok)
            throw new Error(`Remote hosts returned ${response.status}`);
        const payload = await response.json();
        remoteHostsLoaded = true;
        renderRemoteHosts(payload.hosts || []);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load remote hosts';
        if (!remoteHostsLoaded) {
            renderRemoteHostsError(message);
        }
        else if (!list.querySelector('.remote-stale-error')) {
            list.insertAdjacentHTML('afterbegin', `<div class="remote-error remote-stale-error">Remote refresh failed: ${escapeHtml(message)}</div>`);
        }
    }
    finally {
        remoteHostsLoading = false;
        panel.classList.remove('loading');
        list.removeAttribute('aria-busy');
    }
}
async function loadGhRuns() {
    const panel = document.getElementById('ciRunsPanel');
    const list = document.getElementById('ciRunsList');
    if (!panel || !list || !dashboardSettings.panels.ciRuns)
        return;
    if (ghRunsLoading)
        return;
    ghRunsLoading = true;
    panel.classList.add('loading');
    list.setAttribute('aria-busy', 'true');
    if (!ghRunsLoaded)
        list.innerHTML = ghRunsLoadingHtml();
    try {
        const response = await fetch('/api/gh-runs', { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok)
            throw new Error(`CI runs returned ${response.status}`);
        ghRunsLoaded = true;
        renderGhRuns(await response.json());
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load CI runs';
        if (!ghRunsLoaded) {
            renderGhRunsError(message);
        }
        else if (!list.querySelector('.gh-stale-error')) {
            list.insertAdjacentHTML('afterbegin', `<div class="remote-error remote-stale-error gh-stale-error">CI refresh failed: ${escapeHtml(message)}</div>`);
        }
    }
    finally {
        ghRunsLoading = false;
        panel.classList.remove('loading');
        list.removeAttribute('aria-busy');
    }
}
// Restart / pull-latest a container. Confirms first; server re-checks login + unlock + action header.
async function containerAction(host, engine, name, action) {
    if (!shellUnlocked) {
        toast('Unlock shells first to manage containers');
        return;
    }
    if (!name || !engine)
        return;
    const verb = action === 'pull' ? 'Pull latest image for' : 'Restart';
    const where = host ? ` on ${host}` : '';
    if (!window.confirm(`${verb} "${name}"${where}?`))
        return;
    toast(`${action === 'pull' ? 'Pulling' : 'Restarting'} ${name}…`);
    try {
        const payload = await postJson('/api/container-action', { host, engine, name, action });
        toast(payload.message || `${name}: done`);
    }
    catch (error) {
        toast(error.message || 'Action failed');
    }
    await Promise.allSettled([loadContainers(), loadRemoteHosts()]);
}
window.containerAction = containerAction;
window.loadMetrics = loadMetrics;
window.loadContainers = loadContainers;
window.loadRemoteHosts = loadRemoteHosts;
window.loadGhRuns = loadGhRuns;
applyAllContainerPrivacy();
applyPrivacyAll();
