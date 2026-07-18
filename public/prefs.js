"use strict";
let viewMode = localStorage.getItem('sdViewMode2') || 'grid';
let density = localStorage.getItem('sdDensity') || 'compact';
let terminalLines = Number(localStorage.getItem('sdTerminalLines') || '80');
let followOutput = localStorage.getItem('sdFollowOutput') !== '0';
// Side panels (Machine/Remote/Containers/Links/Unlock) are an OPTIONAL left rail. Default shown on
// this instance; productized tenants can default it hidden. Persisted per browser as sdSidebar.
let sidebarVisible = localStorage.getItem('sdSidebar') !== 'hidden';
let shellImages = {};
let privateShells = new Set(storageJson('sdPrivateShells', []));
let hiddenClosedShells = new Set(storageJson(HIDDEN_CLOSED_SHELLS_KEY, []));
let historyCursor = {};
let historyDrafts = {};
function storageJson(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) || '');
    }
    catch {
        return fallback;
    }
}
function sendModes() {
    return storageJson('sdSendModes', {});
}
function sendMode(name) {
    return sendModes()[name] || 'send';
}
function setSendMode(name, mode) {
    const modes = sendModes();
    modes[name] = mode;
    localStorage.setItem('sdSendModes', JSON.stringify(modes));
    markSelectedShell();
}
function commandHistory(name) {
    return storageJson('sdCommandHistory', {})[name] || [];
}
function pushHistory(name, text) {
    const all = storageJson('sdCommandHistory', {});
    const next = [text, ...(all[name] || []).filter((item) => item !== text)].slice(0, 20);
    all[name] = next;
    historyCursor[name] = -1;
    delete historyDrafts[name];
    localStorage.setItem('sdCommandHistory', JSON.stringify(all));
}
function resetHistoryNavigation(name) {
    historyCursor[name] = -1;
    delete historyDrafts[name];
}
function cycleHistory(name, direction) {
    const history = commandHistory(name);
    const input = inputFor(name);
    if (!input)
        return false;
    if (!history.length && direction > 0)
        return false;
    const current = historyCursor[name] ?? -1;
    if (direction < 0 && current < 0)
        return false;
    if (direction > 0 && current < 0)
        historyDrafts[name] = input.value;
    const next = Math.max(-1, Math.min(history.length - 1, current + direction));
    historyCursor[name] = next;
    input.value = next >= 0 ? history[next] : (historyDrafts[name] || '');
    if (next < 0)
        delete historyDrafts[name];
    updateUnlockState();
    return true;
}
function applyPrefs() {
    document.body.classList.toggle('density-compact', density === 'compact');
    document.body.classList.toggle('density-comfortable', density === 'comfortable');
    document.body.classList.toggle('view-grid', viewMode === 'grid');
    document.body.classList.toggle('view-focus', viewMode === 'focus');
    // Live-center layout may omit grid/density/follow controls — keep applyPrefs safe either way.
    const viewToggle = document.getElementById('viewToggle');
    if (viewToggle) {
        viewToggle.innerHTML = viewMode === 'focus' ? `${icon('focus')}<span>Focus</span>` : `${icon('grid')}<span>Grid</span>`;
        viewToggle.title = viewMode === 'focus'
            ? 'Focus: one shell at a time — click for Grid (side-by-side)'
            : 'Grid: all shells side-by-side — drag ⋮⋮ grips to reorder — click for Focus';
        viewToggle.classList.toggle('active', viewMode === 'grid');
    }
    const densityToggle = document.getElementById('densityToggle');
    if (densityToggle) {
        densityToggle.innerHTML = `${icon('rows')}<span>${density === 'compact' ? 'Compact' : 'Comfort'}</span>`;
        densityToggle.title = density === 'compact' ? 'Density: compact — tap for comfort' : 'Density: comfort — tap for compact';
    }
    const followToggle = document.getElementById('followToggle');
    if (followToggle) {
        followToggle.classList.toggle('active', followOutput);
        followToggle.innerHTML = `${icon('follow')}<span>${followOutput ? 'Follow' : 'Paused'}</span>`;
        followToggle.title = followOutput ? 'Output follow: on' : 'Output follow: paused';
    }
    const lineSel = document.getElementById('lineCount');
    if (lineSel) {
        lineSel.value = String(terminalLines);
        lineSel.title = 'Recent output lines shown in each shell preview';
        if (lineSel.dataset.labeled !== '1') {
            Array.from(lineSel.options).forEach((opt) => { opt.textContent = `${opt.value} lines`; });
            lineSel.dataset.labeled = '1';
        }
    }
    document.getElementById('shells')?.classList.toggle('focus-mode', viewMode === 'focus');
    applySidebar();
}
// Show/hide the optional side rail. The body class drives the layout (see app.css); the top-bar
// Panels button reflects state. Null-safe so it can run before the button is injected.
function applySidebar() {
    document.body.classList.toggle('sidebar-hidden', !sidebarVisible);
    const btn = document.getElementById('sidebarToggle');
    if (btn) {
        btn.classList.toggle('active', sidebarVisible);
        btn.title = sidebarVisible ? 'Monitor rail shown — click to hide' : 'Monitor rail hidden — click to show';
    }
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    if (collapseBtn) {
        collapseBtn.title = 'Collapse sidebar';
        collapseBtn.setAttribute('aria-label', 'Collapse sidebar');
    }
    const expandBtn = document.getElementById('sidebarExpandBtn');
    if (expandBtn) {
        expandBtn.hidden = sidebarVisible;
        expandBtn.title = 'Expand sidebar';
        expandBtn.setAttribute('aria-label', 'Expand sidebar');
    }
}
function toggleSidebar() {
    sidebarVisible = !sidebarVisible;
    localStorage.setItem('sdSidebar', sidebarVisible ? 'shown' : 'hidden');
    applySidebar();
}
function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('sdViewMode2', mode);
    applyPrefs();
    markSelectedShell();
    scheduleShellGridFit();
    if (mode === 'grid') {
        toast('Grid: all shells side-by-side. Drag the ⋮⋮ grip onto another shell to reorder.');
    }
    else {
        toast('Focus: one shell at a time. Press g or click Grid to see all shells.');
    }
}
function toggleDensity() {
    density = density === 'compact' ? 'comfortable' : 'compact';
    localStorage.setItem('sdDensity', density);
    applyPrefs();
}
function setTerminalLines(value) {
    terminalLines = [80, 200, 500].includes(value) ? value : 80;
    localStorage.setItem('sdTerminalLines', String(terminalLines));
    restartShellStream();
    loadShells(false).catch((error) => toast(error.message));
    applyPrefs();
}
function shellEndpoint(base) {
    return `${base}?lines=${encodeURIComponent(String(terminalLines))}`;
}
function addShellImage(name, image) {
    shellImages[name] = [image, ...(shellImages[name] || [])].slice(0, 5);
    renderShellImages(name);
}
function removeShellImage(name, path) {
    shellImages[name] = (shellImages[name] || []).filter((image) => image.path !== path);
    renderShellImages(name);
}
function clearShellImages(name) {
    delete shellImages[name];
    renderShellImages(name);
}
function shellPrivate(name) {
    return privateShells.has(name);
}
function setShellPrivate(name, on) {
    if (on)
        privateShells.add(name);
    else
        privateShells.delete(name);
    localStorage.setItem('sdPrivateShells', JSON.stringify(Array.from(privateShells)));
    const card = document.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
    if (card)
        applyShellPrivacy(card, name);
}
function applyShellPrivacy(card, name) {
    const on = shellPrivate(name) || privacyAllOn();
    card.classList.toggle('privacy-blur', on);
    const button = card.querySelector('[data-privacy-shell]');
    if (!button)
        return;
    button.classList.toggle('active', on);
    button.title = on ? 'Show this shell text' : 'Blur this shell text';
    button.setAttribute('aria-label', on ? 'Show shell text' : 'Blur shell text');
}
