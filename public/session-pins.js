"use strict";
// Pure pin helpers for the left session rail.
// Order and persistence are testable without DOM: pass storage get/set adapters.
const PINNED_SESSIONS_KEY = 'sdPinnedSessions';
/** Stable pin-above-unpinned order. Relative order within each group follows `sessions`. */
function orderSessionsByPins(sessions, pinnedNames) {
    const pinSet = new Set(pinnedNames);
    const byName = new Map(sessions.map((session) => [session.name, session]));
    const pinned = [];
    for (const name of pinnedNames) {
        const session = byName.get(name);
        if (session)
            pinned.push(session);
    }
    const unpinned = sessions.filter((session) => !pinSet.has(session.name));
    return [...pinned, ...unpinned];
}
function togglePinnedName(name, pinnedNames) {
    if (!name)
        return pinnedNames.slice();
    if (pinnedNames.includes(name))
        return pinnedNames.filter((item) => item !== name);
    return [...pinnedNames, name];
}
function isSessionPinned(name, pinnedNames) {
    return pinnedNames.includes(name);
}
function readPinnedSessionNames(getItem) {
    try {
        const raw = getItem(PINNED_SESSIONS_KEY);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.map((item) => String(item)).filter(Boolean);
    }
    catch {
        return [];
    }
}
function writePinnedSessionNames(names, setItem) {
    setItem(PINNED_SESSIONS_KEY, JSON.stringify(names));
}
// Browser-facing wrappers used by the dashboard (localStorage-backed).
function pinnedSessionNames() {
    return readPinnedSessionNames((key) => {
        try {
            return localStorage.getItem(key);
        }
        catch {
            return null;
        }
    });
}
function savePinnedSessionNames(names) {
    writePinnedSessionNames(names, (key, value) => {
        try {
            localStorage.setItem(key, value);
        }
        catch {
            /* ignore quota / private mode */
        }
    });
}
function setSessionPinned(name, pinned) {
    const current = pinnedSessionNames();
    const next = pinned
        ? current.includes(name)
            ? current
            : [...current, name]
        : current.filter((item) => item !== name);
    savePinnedSessionNames(next);
}
function toggleSessionPin(name) {
    const next = togglePinnedName(name, pinnedSessionNames());
    savePinnedSessionNames(next);
    return next;
}
