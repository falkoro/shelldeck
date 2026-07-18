"use strict";
// Pure pin helpers for the left session rail.
// Order and persistence are testable without DOM: pass storage get/set adapters.
const PINNED_SESSIONS_KEY = 'sdPinnedSessions';
const AUTO_PIN_SEEN_KEY = 'sdAutoPinSeen';
/** Agent preset / known agent session names (auto-pin candidates). */
const KNOWN_AGENT_NAMES = new Set([
    'codex', 'claude', 'grok', 'gemini', 'qwen', 'opencode', 'aider', 'goose', 'iflow', 'cursor',
]);
function isAgentSession(session) {
    if ((session.family || '').toLowerCase() === 'agent')
        return true;
    return KNOWN_AGENT_NAMES.has(String(session.name || '').toLowerCase());
}
function sessionFamilyBucket(session) {
    if (isAgentSession(session))
        return 'agent';
    const family = (session.family || '').toLowerCase();
    if (family === 'custom')
        return 'custom';
    return 'shell';
}
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
/** Partition unpinned sessions into Agents / Shells / Custom after pinned. */
function partitionRailGroups(sessions, pinnedNames) {
    const ordered = orderSessionsByPins(sessions, pinnedNames);
    const pinSet = new Set(pinnedNames);
    const pinned = ordered.filter((s) => pinSet.has(s.name));
    const rest = ordered.filter((s) => !pinSet.has(s.name));
    return {
        pinned,
        agents: rest.filter((s) => sessionFamilyBucket(s) === 'agent'),
        shells: rest.filter((s) => sessionFamilyBucket(s) === 'shell'),
        custom: rest.filter((s) => sessionFamilyBucket(s) === 'custom'),
    };
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
/** Reorder a pin list by moving `name` to a new index (clamped). */
function reorderPinnedName(pinnedNames, name, toIndex) {
    const without = pinnedNames.filter((n) => n !== name);
    if (!pinnedNames.includes(name))
        return pinnedNames.slice();
    const idx = Math.max(0, Math.min(toIndex, without.length));
    return [...without.slice(0, idx), name, ...without.slice(idx)];
}
/** Move pin up (-1) or down (+1) within the pin list. */
function movePinnedName(pinnedNames, name, delta) {
    const i = pinnedNames.indexOf(name);
    if (i < 0)
        return pinnedNames.slice();
    return reorderPinnedName(pinnedNames, name, i + delta);
}
/**
 * Auto-pin agent sessions the first time they appear.
 * `seen` tracks names already considered so user unpins stick.
 */
function applyAutoPinAgents(sessions, pinnedNames, seenNames) {
    const pins = pinnedNames.slice();
    const seen = new Set(seenNames);
    let changed = false;
    for (const session of sessions) {
        if (seen.has(session.name))
            continue;
        seen.add(session.name);
        changed = true;
        if (isAgentSession(session) && !pins.includes(session.name)) {
            pins.push(session.name);
        }
    }
    return { pins, seen: Array.from(seen) };
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
function readAutoPinSeen(getItem) {
    try {
        const raw = getItem(AUTO_PIN_SEEN_KEY);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    }
    catch {
        return [];
    }
}
function writeAutoPinSeen(names, setItem) {
    setItem(AUTO_PIN_SEEN_KEY, JSON.stringify(names));
}
// Browser-facing wrappers
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
            /* ignore */
        }
    });
}
function autoPinSeenNames() {
    return readAutoPinSeen((key) => {
        try {
            return localStorage.getItem(key);
        }
        catch {
            return null;
        }
    });
}
function saveAutoPinSeen(names) {
    writeAutoPinSeen(names, (key, value) => {
        try {
            localStorage.setItem(key, value);
        }
        catch {
            /* ignore */
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
/** Run auto-pin against current model sessions; returns true if pins changed. */
function runAutoPinForSessions(modelSessions) {
    const before = pinnedSessionNames();
    const result = applyAutoPinAgents(modelSessions, before, autoPinSeenNames());
    saveAutoPinSeen(result.seen);
    if (result.pins.join('\0') !== before.join('\0')) {
        savePinnedSessionNames(result.pins);
        return true;
    }
    return false;
}
function reorderSessionPin(name, toIndex) {
    const next = reorderPinnedName(pinnedSessionNames(), name, toIndex);
    savePinnedSessionNames(next);
    return next;
}
function moveSessionPin(name, delta) {
    const next = movePinnedName(pinnedSessionNames(), name, delta);
    savePinnedSessionNames(next);
    return next;
}
