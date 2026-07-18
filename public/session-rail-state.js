"use strict";
// Client state for rail extras: unread, multi-select, quiet mode, color tags.
const SESSION_COLORS_KEY = 'sdSessionColors';
const QUIET_MODE_KEY = 'sdQuietMode';
const SESSION_COLOR_PALETTE = ['cyan', 'green', 'amber', 'red', 'violet', 'slate'];
let unreadSessions = new Set();
let multiSelectMode = false;
let multiSelected = new Set();
let quietMode = localStorage.getItem(QUIET_MODE_KEY) === '1';
function sessionColors() {
    return storageJson(SESSION_COLORS_KEY, {});
}
function setSessionColor(name, color) {
    const all = sessionColors();
    if (!color || !SESSION_COLOR_PALETTE.includes(color)) {
        delete all[name];
    }
    else {
        all[name] = color;
    }
    localStorage.setItem(SESSION_COLORS_KEY, JSON.stringify(all));
}
function sessionColor(name) {
    return sessionColors()[name] || '';
}
function cycleSessionColor(name) {
    const current = sessionColor(name);
    const idx = SESSION_COLOR_PALETTE.indexOf(current);
    const next = idx < 0 ? SESSION_COLOR_PALETTE[0] : SESSION_COLOR_PALETTE[(idx + 1) % SESSION_COLOR_PALETTE.length];
    // After last color, clear tag
    if (idx === SESSION_COLOR_PALETTE.length - 1) {
        setSessionColor(name, null);
        return '';
    }
    setSessionColor(name, next);
    return next;
}
function markSessionUnread(name) {
    if (!name || name === selectedSession)
        return;
    unreadSessions.add(name);
}
function clearSessionUnread(name) {
    unreadSessions.delete(name);
}
function isSessionUnread(name) {
    return unreadSessions.has(name);
}
function noteUnreadFromShells(shells) {
    for (const shell of shells) {
        if (!shell.running)
            continue;
        // shellWorking is true when output just changed — treat as unread if not focused.
        if (typeof shellWorking === 'function' && shellWorking(shell.name)) {
            markSessionUnread(shell.name);
        }
    }
}
function setMultiSelectMode(on) {
    multiSelectMode = on;
    if (!on)
        multiSelected.clear();
    document.body.classList.toggle('rail-multiselect', on);
    if (typeof invalidateSessionRail === 'function')
        invalidateSessionRail();
    if (typeof renderSessionRail === 'function')
        renderSessionRail();
}
function toggleMultiSelectMode() {
    setMultiSelectMode(!multiSelectMode);
}
function isMultiSelectMode() {
    return multiSelectMode;
}
function toggleMultiSelected(name) {
    if (multiSelected.has(name))
        multiSelected.delete(name);
    else
        multiSelected.add(name);
}
function isMultiSelected(name) {
    return multiSelected.has(name);
}
function multiSelectedNames() {
    return Array.from(multiSelected);
}
function clearMultiSelected() {
    multiSelected.clear();
}
function applyQuietMode() {
    document.body.classList.toggle('quiet-mode', quietMode);
    const btn = document.getElementById('quietModeBtn');
    if (btn) {
        btn.classList.toggle('active', quietMode);
        btn.title = quietMode
            ? 'Quiet mode on — click to show panels and chrome'
            : 'Quiet mode — hide side panels for a clean focus layout';
        btn.setAttribute('aria-pressed', quietMode ? 'true' : 'false');
    }
    if (quietMode) {
        // Hide panels rail; keep session rail.
        document.body.classList.add('sidebar-hidden');
        if (typeof viewMode !== 'undefined' && viewMode !== 'focus' && typeof setViewMode === 'function') {
            /* keep current view — quiet only hides panels */
        }
    }
    else if (typeof applySidebar === 'function') {
        applySidebar();
    }
}
function setQuietMode(on) {
    quietMode = on;
    localStorage.setItem(QUIET_MODE_KEY, on ? '1' : '0');
    applyQuietMode();
}
function toggleQuietMode() {
    setQuietMode(!quietMode);
    toast(quietMode ? 'Quiet mode on' : 'Quiet mode off');
}
function isQuietMode() {
    return quietMode;
}
