"use strict";
// Labels B
function hostAlias() {
    return localStorage.getItem(HOST_ALIAS_KEY)?.trim() || '';
}
function hostDisplayName(hostname) {
    const alias = hostAlias();
    if (alias)
        return alias;
    const host = hostname.trim();
    return host || '—';
}
function syncDashboardTitle(hostname) {
    const display = hostDisplayName(hostname);
    document.title = display === '—' ? 'ShellDeck' : display;
    const label = document.getElementById('hostLabel');
    if (label)
        label.textContent = display;
}
function renameHostLabel(hostname) {
    const current = hostDisplayName(hostname);
    const next = window.prompt('Dashboard name', current);
    if (next === null)
        return false;
    const clean = next.trim().replace(/\s+/g, ' ').slice(0, 48);
    const defaultHost = hostname.trim();
    if (!clean || clean === defaultHost) {
        localStorage.removeItem(HOST_ALIAS_KEY);
    }
    else {
        localStorage.setItem(HOST_ALIAS_KEY, clean);
    }
    syncDashboardTitle(hostname);
    return true;
}
function nextTmuxSessionName() {
    const used = new Set();
    sessions().forEach((session) => used.add(session.name));
    latestShells.forEach((shell) => used.add(shell.name));
    for (let i = 1; i <= 99; i += 1) {
        const name = String(i);
        if (!used.has(name))
            return name;
    }
    return `shell-${Date.now().toString(36)}`;
}
function promptNewTmuxSessionName(baseName, requireName = false) {
    const session = sessionByName(baseName);
    const fallback = session?.label || baseName;
    const display = shellDisplayLabel(baseName, fallback);
    const suggestion = requireName ? nextTmuxSessionName() : '';
    const value = window.prompt(requireName
        ? `Name for the extra tmux session from ${display}.`
        : `Name for the new tmux session from ${display}\nLeave blank to use ${baseName}.`, suggestion);
    if (value === null)
        return null;
    const clean = value.trim();
    if (!clean && requireName)
        throw new Error('Name the extra tmux session');
    if (!clean)
        return '';
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(clean)) {
        throw new Error('Use 1-64 letters, numbers, dash, or underscore for tmux session names');
    }
    return clean;
}
function stripTerminalDecor(value) {
    return value
        .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
        .replace(/[╭╮╰╯│┃║┆┊]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function cleanAutoFollowUp(value) {
    return stripTerminalDecor(value)
        .replace(/^(?:claude|codex|grok|gemini|cursor|agent|assistant)\s*[:>]\s*/i, '')
        .replace(/^(?:[>›»•*+-]|\d+[.)])\s*/, '')
        .replace(/^["'“”]+|["'“”]+$/g, '')
        .slice(0, AUTO_FOLLOW_UP_MAX_CHARS)
        .trim();
}
function looksLikeAutoFollowUp(line) {
    const text = cleanAutoFollowUp(line);
    if (text.length < 12)
        return false;
    if (/how is claude doing this session|esc to interrupt|shift\+tab|tokens|context left/i.test(text))
        return false;
    if (/^(?:would you like me to|do you want me to|should i|shall i|want me to|would you like|do you want|should we|shall we)\b/i.test(text))
        return true;
    if (/^(?:i can|next,? i can|i could|we can)\s+(?:also\s+)?(?:add|fix|run|update|review|commit|push|open|continue|test|deploy|implement|create|write|check|wire|rename)\b/i.test(text))
        return true;
    return /\?$/.test(text) && /\b(add|fix|run|update|review|commit|push|open|continue|test|deploy|implement|create|write|check|wire|rename)\b/i.test(text);
}
function extractAutoFollowUpDraft(output) {
    const lines = output.split('\n').map(stripTerminalDecor).filter(Boolean).slice(-90);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        const heading = line.match(/^(?:auto[- ]?)?(?:follow[- ]?up|suggested follow[- ]?up|suggested next prompt|next prompt|try asking|ask me)[:：-]\s*(.*)$/i);
        if (heading) {
            const inline = cleanAutoFollowUp(heading[1] || '');
            if (inline)
                return inline;
            const next = cleanAutoFollowUp(lines[i + 1] || '');
            if (next)
                return next;
        }
        if (looksLikeAutoFollowUp(line))
            return cleanAutoFollowUp(line);
    }
    return '';
}
function markAutoFollowUpSent(name, text) {
    const clean = text.trim();
    if (clean && autoFollowUpDrafts[name] === clean)
        autoFollowUpSentDrafts[name] = clean;
}
function sessionByName(name) {
    return sessions().find((session) => session.name === name) || null;
}
function selectedSessionModel() {
    return sessionByName(selectedSession);
}
function firstRunningSession() {
    return sessions().find((session) => session.running) || null;
}
function chooseSession(preferRunning = false) {
    const current = selectedSessionModel();
    if (current && (!preferRunning || current.running))
        return current;
    const selected = firstRunningSession() || sessions()[0] || null;
    selectedSession = selected ? selected.name : '';
    if (selectedSession)
        localStorage.setItem('sdSelectedSession', selectedSession);
    return selected;
}
