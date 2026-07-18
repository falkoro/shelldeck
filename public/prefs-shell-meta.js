"use strict";
function saveHiddenClosedShells() {
    localStorage.setItem(HIDDEN_CLOSED_SHELLS_KEY, JSON.stringify(Array.from(hiddenClosedShells)));
}
function coreShellName(name) {
    return /^\d+$/.test(name) || name === 'main' || /^slot\d+$/.test(name);
}
function canRemoveClosedShell(session) {
    return Boolean(session && !session.running);
}
function removeClosedShell(name) {
    const session = sessionByName(name);
    if (!canRemoveClosedShell(session))
        throw new Error('Only closed sessions can be removed from the dashboard');
    hideClosedShell(name);
}
function hideClosedShell(name) {
    if (!name)
        return;
    hiddenClosedShells.add(name);
    saveHiddenClosedShells();
    if (selectedSession === name)
        chooseSession(false);
    renderShells({ shells: latestShells });
    renderSelectedSessionActions();
}
function terminateShellInDashboard(name) {
    hideClosedShell(name);
    toast('Terminated session');
}
function restoreHiddenClosedShells() {
    if (!hiddenClosedShells.size)
        return;
    hiddenClosedShells.clear();
    saveHiddenClosedShells();
    renderShells({ shells: latestShells });
    renderShellTabs();
    renderSelectedSessionActions();
    toast('Terminated sessions shown');
}
function hiddenClosedShellCount() {
    return hiddenClosedShells.size;
}
function unhideShell(name) {
    if (!hiddenClosedShells.delete(name))
        return;
    saveHiddenClosedShells();
}
function visibleSessions(modelSessions) {
    let changed = false;
    const visible = modelSessions.filter((session) => {
        if (session.running && hiddenClosedShells.has(session.name)) {
            hiddenClosedShells.delete(session.name);
            changed = true;
            return true;
        }
        return !hiddenClosedShells.has(session.name);
    });
    if (changed)
        saveHiddenClosedShells();
    return visible;
}
function visibleShellPreviews(shells) {
    let changed = false;
    const visible = shells.filter((shell) => {
        if (shell.running && hiddenClosedShells.has(shell.name)) {
            hiddenClosedShells.delete(shell.name);
            changed = true;
            return true;
        }
        return !hiddenClosedShells.has(shell.name);
    });
    if (changed)
        saveHiddenClosedShells();
    return visible;
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
