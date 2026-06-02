"use strict";
let viewMode = localStorage.getItem('sdViewMode2') || 'grid';
let density = localStorage.getItem('sdDensity') || 'compact';
let terminalLines = Number(localStorage.getItem('sdTerminalLines') || '80');
let followOutput = localStorage.getItem('sdFollowOutput') !== '0';
let shellImages = {};
let clearedOutputs = {};
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
    const viewToggle = q('#viewToggle');
    viewToggle.innerHTML = viewMode === 'focus' ? `${icon('focus')}<span>Focus</span>` : `${icon('grid')}<span>Grid</span>`;
    viewToggle.title = viewMode === 'focus' ? 'View: focus — tap for grid' : 'View: grid — tap for focus';
    const densityToggle = q('#densityToggle');
    densityToggle.innerHTML = `${icon('rows')}<span>${density === 'compact' ? 'Compact' : 'Comfort'}</span>`;
    densityToggle.title = density === 'compact' ? 'Density: compact — tap for comfort' : 'Density: comfort — tap for compact';
    const followToggle = q('#followToggle');
    followToggle.classList.toggle('active', followOutput);
    followToggle.innerHTML = `${icon('follow')}<span>${followOutput ? 'Follow' : 'Paused'}</span>`;
    followToggle.title = followOutput ? 'Output follow: on' : 'Output follow: paused';
    const lineSel = q('#lineCount');
    lineSel.value = String(terminalLines);
    lineSel.title = 'Recent output lines shown in each shell preview';
    if (lineSel.dataset.labeled !== '1') {
        Array.from(lineSel.options).forEach((opt) => { opt.textContent = `${opt.value} lines`; });
        lineSel.dataset.labeled = '1';
    }
    q('#authState').textContent = 'dashboard signed in';
    q('#shells').classList.toggle('focus-mode', viewMode === 'focus');
}
function setViewMode(mode) {
    viewMode = mode;
    localStorage.setItem('sdViewMode2', mode);
    applyPrefs();
    markSelectedShell();
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
// --- Shell card order persistence ---
// Persist the preferred sort order of shell cards so drag-to-reorder survives refresh.
function shellOrder() {
    return storageJson('sdShellOrder', []);
}
function saveShellOrder(names) {
    localStorage.setItem('sdShellOrder', JSON.stringify(names));
}
// Merge known shells into the saved order: keep any previously-seen names in their
// saved position, append newly-seen names at the end, and drop stale ones.
function orderedShellList(shells) {
    const saved = shellOrder();
    const nameSet = new Set(shells.map((s) => s.name));
    // Remove names from saved list that are no longer in the shell list
    const validSaved = saved.filter((n) => nameSet.has(n));
    // Add shells that are in the current list but not yet in saved order
    const newNames = shells.map((s) => s.name).filter((n) => !validSaved.includes(n));
    const merged = [...validSaved, ...newNames];
    // Update the saved order
    saveShellOrder(merged);
    // Reorder shells array to match
    const byName = {};
    shells.forEach((s) => { byName[s.name] = s; });
    return merged.map((n) => byName[n]).filter(Boolean);
}
function shellCardSizes() {
    return storageJson('sdShellSizes', {});
}
function saveShellCardSize(name, size) {
    const sizes = shellCardSizes();
    sizes[name] = size;
    localStorage.setItem('sdShellSizes', JSON.stringify(sizes));
}
function loadShellCardSize(name) {
    const s = shellCardSizes()[name];
    if (s && typeof s.w === 'number' && typeof s.h === 'number')
        return s;
    return null;
}
function resetShellCardSize(name) {
    const sizes = shellCardSizes();
    delete sizes[name];
    localStorage.setItem('sdShellSizes', JSON.stringify(sizes));
}
// --- Shell card drag-to-reorder threshold ---
const DRAG_REORDER_THRESHOLD = 8;
