"use strict";
// Split from core-orig.ts L547-763
function selectSession(name) {
    selectedSession = String(name || '');
    if (selectedSession)
        localStorage.setItem('sdSelectedSession', selectedSession);
    if (selectedSession && typeof clearSessionUnread === 'function')
        clearSessionUnread(selectedSession);
    renderShellTabs();
    if (typeof renderSessionRail === 'function')
        renderSessionRail();
    renderSelectedSessionActions();
    markSelectedShell();
    updateUnlockState();
    // Live-center: attach real tmux only when the session is actually running (avoid WSS 400 on offline).
    if (selectedSession && shellUnlocked && typeof openTerminal === 'function' && targetReady(selectedSession)) {
        openTerminal(selectedSession);
    }
    else {
        showLiveStageIdle(selectedSession);
    }
}
function showLiveStageIdle(name) {
    // Hide any docked terminal while showing the offline / empty prompt.
    if (typeof termWindows !== 'undefined') {
        termWindows.forEach((tw) => {
            if (tw.el.classList.contains('term-docked')) {
                tw.el.hidden = true;
                tw.minimized = true;
            }
        });
    }
    const empty = document.getElementById('liveStageEmpty');
    if (empty)
        empty.removeAttribute('hidden');
    const title = document.getElementById('liveStageTitle');
    const hint = document.getElementById('liveStageHint');
    if (!name) {
        if (title)
            title.textContent = 'Live terminal';
        if (hint)
            hint.textContent = 'Select a session on the left to attach.';
        return;
    }
    if (title)
        title.textContent = `${name} · offline`;
    if (hint)
        hint.textContent = shellUnlocked
            ? 'Session is not running. Use New tmux (toolbar) to start it, then it attaches here.'
            : 'Unlock shells first, then start or select a running session.';
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
function saveShellPreviewCache(shells) {
    if (!shells.length)
        return;
    try {
        localStorage.setItem(SHELL_PREVIEW_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), shells }));
    }
    catch { }
}
function cachedShellPreviews() {
    const cached = storageJson(SHELL_PREVIEW_CACHE_KEY, {});
    if (!Array.isArray(cached.shells) || !cached.shells.length)
        return [];
    if (!cached.savedAt || Date.now() - cached.savedAt > SHELL_PREVIEW_CACHE_MAX_AGE_MS)
        return [];
    return cached.shells.filter((shell) => shell && typeof shell.name === 'string');
}
function setShellsLoading(loading) {
    shellsLoading = loading;
    document.body.classList.toggle('shells-refreshing', loading);
    document.querySelectorAll('[data-shell-card]').forEach((card) => {
        card.classList.toggle('shell-refreshing', loading);
    });
}
// "Running" = the pane is actively changing. Claude Code / Codex animate a spinner with a
// per-second elapsed timer while a turn runs, so consecutive captures differ; an idle prompt is
// static. This beats scanning for "esc to interrupt", which also matched the visible conversation
// (false running) and missed turns whose captured frame lacked the exact phrase (false waiting).
const shellActivity = {};
function noteShellActivity(name, output) {
    const prev = shellActivity[name];
    if (!prev || prev.out !== output) {
        shellActivity[name] = { out: output, at: Date.now() };
        // Fresh output on a non-selected shell → unread badge on the rail.
        if (name && name !== selectedSession && typeof markSessionUnread === 'function') {
            markSessionUnread(name);
        }
    }
}
function shellWorking(name) {
    const a = shellActivity[name];
    return !!a && Date.now() - a.at < 3500;
}
function targetReady(name) {
    const shell = shellPreviewByName(name);
    const session = sessionByName(name);
    return Boolean(shellUnlocked && name && (shell?.running || session?.running));
}
function createReady(name) {
    const session = sessionByName(name);
    return Boolean(shellUnlocked && session && !session.running && session.family !== 'custom');
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
    scheduleShellGridFit();
}
function formatTopbarClock(now = new Date()) {
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}
function applyBrandIcon() {
    const img = document.getElementById('brandIcon');
    if (!img)
        return;
    img.src = localStorage.getItem(BRAND_ICON_KEY) || DEFAULT_BRAND_ICON;
}
function readBrandIconFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('Could not read icon file'));
        reader.readAsDataURL(file);
    });
}
async function changeBrandIcon(file) {
    if (!file.type.startsWith('image/'))
        throw new Error('Pick an image file');
    if (file.size > BRAND_ICON_MAX_BYTES)
        throw new Error('Icon must be under 512 KB');
    const dataUrl = await readBrandIconFile(file);
    if (!dataUrl)
        throw new Error('Could not read icon file');
    localStorage.setItem(BRAND_ICON_KEY, dataUrl);
    applyBrandIcon();
}
function resetBrandIcon() {
    localStorage.removeItem(BRAND_ICON_KEY);
    applyBrandIcon();
}
function updateTopbarClock() {
    const el = document.getElementById('topbarClock');
    if (!el)
        return;
    const next = formatTopbarClock();
    if (el.textContent !== next)
        el.textContent = next;
}
function startTopbarClock() {
    updateTopbarClock();
    if (window.__sdTopbarClock)
        return;
    window.__sdTopbarClock = window.setInterval(updateTopbarClock, 1000);
}
function updateSummaryRefreshState() {
    const button = document.getElementById('refreshSummaryBtn');
    if (!button)
        return;
    button.disabled = !shellUnlocked || summaryLoading;
    button.classList.toggle('active', summaryLoading);
    button.innerHTML = `${icon('summary')}<span>${summaryLoading ? 'Summarising' : 'Summary'}</span>`;
}
function updateUnlockState() {
    document.body.classList.toggle('shells-locked', !shellUnlocked);
    q('#unlockPanel').style.display = shellUnlocked ? 'none' : '';
    q('#refreshShellsTopBtn').disabled = !shellUnlocked;
    updateSummaryRefreshState();
    document.querySelectorAll('[data-send-shell]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.sendShell || '');
    });
    document.querySelectorAll('[data-paste-shell]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.pasteShell || '');
    });
    document.querySelectorAll('[data-add-image]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.addImage || '');
    });
    document.querySelectorAll('[data-dictate-shell]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.dictateShell || '');
    });
    document.querySelectorAll('[data-key]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.shell || '');
    });
    document.querySelectorAll('[data-stop]').forEach((button) => {
        button.disabled = !targetReady(button.dataset.stop || '');
    });
    document.querySelectorAll('[data-create]').forEach((button) => {
        button.disabled = !createReady(button.dataset.create || '');
    });
    document.querySelectorAll('[data-command]').forEach((input) => {
        input.disabled = !targetReady(input.dataset.command || '');
    });
    setAccessState(shellUnlocked);
}
function updateLastActivityTimes() {
    // Live-tick the relative last-activity labels so "3m ago" becomes "4m ago" without full refresh.
    document.querySelectorAll('[data-act-epoch]').forEach((el) => {
        const raw = el.getAttribute('data-act-epoch');
        const ep = raw ? parseInt(raw, 10) : 0;
        if (ep > 0) {
            const rel = fmtTime(ep);
            if (el.textContent !== rel)
                el.textContent = rel;
        }
    });
    renderShellTabs();
    renderSelectedSessionActions();
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
