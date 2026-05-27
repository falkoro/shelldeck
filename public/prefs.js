"use strict";
let viewMode = localStorage.getItem('sdViewMode2') || 'grid';
let density = localStorage.getItem('sdDensity') || 'compact';
let terminalLines = Number(localStorage.getItem('sdTerminalLines') || '80');
let followOutput = localStorage.getItem('sdFollowOutput') !== '0';
let shellImages = {};
let clearedOutputs = {};
let historyCursor = {};
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
    localStorage.setItem('sdCommandHistory', JSON.stringify(all));
}
function cycleHistory(name, direction) {
    const history = commandHistory(name);
    if (!history.length)
        return;
    const current = historyCursor[name] ?? -1;
    const next = Math.max(-1, Math.min(history.length - 1, current + direction));
    historyCursor[name] = next;
    const input = inputFor(name);
    if (input)
        input.value = next >= 0 ? history[next] : '';
}
function applyPrefs() {
    document.body.classList.toggle('density-compact', density === 'compact');
    document.body.classList.toggle('density-comfortable', density === 'comfortable');
    q('#viewToggle').innerHTML = viewMode === 'focus' ? `${icon('focus')}<span>Focus</span>` : `${icon('grid')}<span>Grid</span>`;
    q('#densityToggle').innerHTML = `${icon('rows')}<span>${density === 'compact' ? 'Compact' : 'Comfort'}</span>`;
    q('#followToggle').classList.toggle('active', followOutput);
    q('#followToggle').innerHTML = `${icon('follow')}<span>${followOutput ? 'Follow' : 'Paused'}</span>`;
    q('#lineCount').value = String(terminalLines);
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
