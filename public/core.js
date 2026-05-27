"use strict";
const initialModel = JSON.parse(document.getElementById('initial-model')?.textContent || '{}');
let currentModel = initialModel;
let latestShells = [];
let latestAgents = [];
let latestSummaryText = '';
let summaryLoading = false;
// Pull the one-liner for a given session out of the Current Work summary (lines like
// "- main: ...", "main (claude): ...", "**slot1** — ..."), to use as a per-slot title.
function sessionWorkTitle(session) {
    for (const raw of latestSummaryText.split('\n')) {
        const head = raw.trim().replace(/^[\-*•\s]+/, '').replace(/\*\*/g, '');
        if (!new RegExp(`^${session}\\b`, 'i').test(head))
            continue;
        const after = head.slice(session.length);
        const sep = after.match(/[:–—]|\s-\s/);
        const text = sep && sep.index !== undefined ? after.slice(sep.index + sep[0].length) : after;
        return text.replace(/^[\s:\-–—)]+/, '').trim();
    }
    return '';
}
let shellUnlocked = Boolean(initialModel.unlocked);
let selectedSession = localStorage.getItem('sdSelectedSession') || '';
let pendingImageTarget = '';
const q = (selector) => {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing element: ${selector}`);
    return element;
};
const imageFile = q('#imageFile');
function selectorEscape(value) {
    return CSS.escape(value);
}
function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
const ICONS = {
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    play: '<polygon points="5 3 19 12 5 21 5 3"/>',
    restart: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    paste: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    enter: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
    stop: '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    rows: '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/>',
    follow: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
};
function icon(name) {
    return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
function fmtTime(epoch) {
    if (!epoch)
        return 'not yet';
    return new Date(epoch * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
function toast(text) {
    const el = q('#toast');
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
}
async function copyText(text) {
    if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
    }
    else {
        const fallback = document.createElement('textarea');
        fallback.value = text;
        document.body.appendChild(fallback);
        fallback.select();
        document.execCommand('copy');
        fallback.remove();
    }
    toast('Copied');
}
function sessions() {
    return currentModel.sessions || [];
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
function selectSession(name) {
    selectedSession = String(name || '');
    if (selectedSession)
        localStorage.setItem('sdSelectedSession', selectedSession);
    renderSessionList();
    markSelectedShell();
    updateUnlockState();
}
function inputFor(name) {
    return document.querySelector(`[data-command="${selectorEscape(name)}"]`);
}
function focusComposer(name) {
    const input = inputFor(name);
    if (input && !input.disabled)
        input.focus({ preventScroll: true });
}
function shellPreviewByName(name) {
    return latestShells.find((shell) => shell.name === name) || null;
}
// Is the agent in this shell actively working? Claude Code and Codex both render "esc to interrupt"
// only while a turn is running, so the live pane is a far more reliable signal than agent-office's
// status field (which gets stuck on "working" when a tool's completion event is missed).
function shellWorking(session) {
    const shell = latestShells.find((s) => s.name === session);
    return !!shell && /esc to interrupt/i.test(shell.output);
}
// Per-session badge: a session that hosts an agent shows running while its pane says "esc to
// interrupt", otherwise waiting (idle at its prompt).
function sessionAgentStatus() {
    const out = {};
    for (const agent of latestAgents) {
        if (!agent.session)
            continue;
        out[agent.session] = shellWorking(agent.session) ? 'active' : 'waiting';
    }
    return out;
}
function targetReady(name) {
    const shell = shellPreviewByName(name);
    const session = sessionByName(name);
    return Boolean(shellUnlocked && name && (shell?.running || session?.running));
}
function setAccessState(unlocked) {
    const el = q('#accessState');
    el.className = unlocked ? 'pill access-pill on' : 'pill access-pill';
    el.textContent = unlocked ? 'shells unlocked' : 'shells locked';
}
function setStreamState(text, live = false) {
    const el = q('#streamState');
    el.className = live ? 'pill stream-pill on' : 'pill stream-pill';
    el.textContent = text;
}
function updateUnlockState() {
    document.body.classList.toggle('shells-locked', !shellUnlocked);
    q('#unlockPanel').style.display = shellUnlocked ? 'none' : '';
    q('#refreshShellsTopBtn').disabled = !shellUnlocked;
    document.querySelectorAll('[data-send-shell]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.sendShell || '');
    });
    document.querySelectorAll('[data-paste-shell]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.pasteShell || '');
    });
    document.querySelectorAll('[data-add-image]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.addImage || '');
    });
    document.querySelectorAll('[data-key]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.shell || '');
    });
    document.querySelectorAll('[data-command]').forEach((input) => {
        input.disabled = !targetReady(input.dataset.command || '');
    });
    setAccessState(shellUnlocked);
}
function syncTargetUi() {
    chooseSession(false);
    updateUnlockState();
}
async function postJson(endpoint, body) {
    const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Codex-Action': '1' },
        body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok)
        throw new Error(payload.error || 'Request failed');
    return payload;
}
