"use strict";
const termWindows = new Map();
let dockEl = null;
let nextZ = 75;
let cascade = 0;
const DEFAULT_W = 880;
const DEFAULT_H = 540;
const MOBILE_BREAKPOINT = 760;
const TERMINAL_PASTE_CHUNK_BYTES = 4096;
const CURSOR_AGENT_SCROLLBACK = 2500;
const DEFAULT_SCROLLBACK = 4000;
const terminalLinkCache = new WeakMap();
function sessionUsesCursorAgent(name) {
    const shell = shellPreviewByName(name);
    const cmd = shell?.command || '';
    return /\bagent\b/i.test(cmd) || /\bcursor\b/i.test(cmd);
}
function queueTerminalOutput(tw, data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (!bytes.length)
        return;
    tw.writeQueue.push(bytes);
    if (tw.writeFrame)
        return;
    tw.writeFrame = requestAnimationFrame(() => {
        tw.writeFrame = 0;
        flushTerminalOutput(tw);
    });
}
function flushTerminalOutput(tw) {
    if (!tw.writeQueue.length || !tw.term)
        return;
    let total = 0;
    for (const chunk of tw.writeQueue)
        total += chunk.length;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of tw.writeQueue) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    tw.writeQueue.length = 0;
    tw.term.write(merged);
}
// On-screen keys for the mobile terminal — a phone soft-keyboard can't send these,
// yet they're essential for driving tmux / vim / coding agents. Shown only on mobile.
const TERMINAL_KEY_SEQUENCES = {
    esc: '\x1b',
    tab: '\t',
    'ctrl-c': '\x03',
    home: '\x1b[H',
    end: '\x1b[F',
    up: '\x1b[A',
    down: '\x1b[B',
    left: '\x1b[D',
    right: '\x1b[C',
};
// When the sticky Ctrl key is armed, tapping a navigation key sends its Ctrl-modified
// form (xterm modifier 5 = Ctrl): Ctrl+arrows = word-jump in readline shells, and
// Ctrl+Home / Ctrl+End = jump to top/bottom (e.g. Claude Code's "Jump to bottom (ctrl+End)").
const TERMINAL_CTRL_SEQUENCES = {
    up: '\x1b[1;5A',
    down: '\x1b[1;5B',
    left: '\x1b[1;5D',
    right: '\x1b[1;5C',
    home: '\x1b[1;5H',
    end: '\x1b[1;5F',
};
// NB: use data-termkey, NOT data-key — the dashboard force-disables every [data-key]
// button (the per-pane send-key controls) via updateUnlockState(), which would kill these.
const TERMINAL_KEYBAR_HTML = `
    <div class="term-keybar" data-keybar>
      <button type="button" class="term-key" data-termkey="esc">Esc</button>
      <button type="button" class="term-key" data-termkey="tab">Tab</button>
      <button type="button" class="term-key" data-termkey="ctrl" title="Ctrl — tap, then a letter (e.g. d → Ctrl-D), an arrow (word jump), or Home/End (jump to top/bottom)">Ctrl</button>
      <button type="button" class="term-key" data-termkey="ctrl-c" title="Ctrl-C (interrupt)">^C</button>
      <button type="button" class="term-key term-key-upload" data-termkey="upload" title="Upload image and insert its path">Img</button>
      <button type="button" class="term-key" data-termkey="home" title="Home (start of line)">Home</button>
      <button type="button" class="term-key" data-termkey="end" title="End (end of line)">End</button>
      <button type="button" class="term-key" data-termkey="up" aria-label="Arrow up">↑</button>
      <button type="button" class="term-key" data-termkey="down" aria-label="Arrow down">↓</button>
      <button type="button" class="term-key" data-termkey="left" aria-label="Arrow left">←</button>
      <button type="button" class="term-key" data-termkey="right" aria-label="Arrow right">→</button>
      <button type="button" class="term-key term-key-wide" data-termkey="copy" title="Copy selected text">Copy</button>
      <button type="button" class="term-key term-key-wide" data-termkey="copyall" title="Copy all scrollback">All</button>
      <button type="button" class="term-key term-key-wide" data-termkey="paste" title="Paste from clipboard">Paste</button>
    </div>`;
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}
function viewportSize() {
    const vv = window.visualViewport;
    return {
        width: Math.floor(vv?.width || window.innerWidth),
        height: Math.floor(vv?.height || window.innerHeight),
    };
}
function compactTerminalViewport() {
    const width = viewportSize().width;
    return width <= MOBILE_BREAKPOINT || (width <= 1024 && window.matchMedia('(pointer: coarse)').matches);
}
// Pin a full-screen mobile terminal to the *visual* viewport. CSS reads these vars so the
// on-screen keyboard shrinks the window (keybar rides just above the keyboard) instead of
// covering the prompt. Falls back to 100dvh when the vars are unset (e.g. before first run).
function applyMobileViewportVars(el) {
    const vv = window.visualViewport;
    el.style.setProperty('--svh', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    el.style.setProperty('--svh-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
}
function refreshTerminalViewportMode() {
    const compact = compactTerminalViewport();
    termWindows.forEach((tw) => {
        tw.el.classList.toggle('mobile', compact);
        if (compact) {
            applyMobileViewportVars(tw.el);
            if (!tw.minimized)
                tw.el.style.display = '';
        }
        doFit(tw);
    });
}
function ensureDock() {
    if (dockEl)
        return dockEl;
    dockEl = document.createElement('div');
    dockEl.id = 'term-dock';
    document.body.appendChild(dockEl);
    return dockEl;
}
function renderDock() {
    const dock = ensureDock();
    dock.innerHTML = '';
    let any = false;
    termWindows.forEach((tw) => {
        if (!tw.minimized)
            return;
        any = true;
        const item = document.createElement('div');
        item.className = 'term-min-item';
        item.innerHTML = `<span class="tm-name">${escapeHtml(tw.name)}</span><button type="button" class="tm-btn" data-act="restore" title="Restore window">▴</button><button type="button" class="tm-btn tm-close" data-act="close" title="Detach (the tmux session keeps running)">×</button>`;
        item.querySelectorAll('button').forEach((btn) => {
            const act = btn.dataset.act;
            btn.addEventListener('click', (e) => { e.stopPropagation(); if (act === 'restore')
                restoreWindow(tw);
            else
                closeWindow(tw); });
        });
        item.addEventListener('click', () => restoreWindow(tw));
        dock.appendChild(item);
    });
    // Also show minimized main-dashboard shell *previews*
    minimizedPreviews.forEach((name) => {
        any = true;
        const item = document.createElement('div');
        item.className = 'term-min-item shell-preview-min';
        item.innerHTML = `<span class="tm-name">◻︎ ${escapeHtml(name)}</span><button type="button" class="tm-btn" data-act="restore-preview" title="Restore preview to grid">▴</button><button type="button" class="tm-btn tm-close" data-act="close-preview" title="Hide preview">×</button>`;
        item.querySelectorAll('button').forEach((btn) => {
            const act = btn.dataset.act;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (act === 'restore-preview')
                    restoreShellPreview(name);
                else if (act === 'close-preview') {
                    minimizedPreviews.delete(name);
                    renderDock();
                }
            });
        });
        item.addEventListener('click', () => restoreShellPreview(name));
        dock.appendChild(item);
    });
    dock.style.display = any ? 'flex' : 'none';
    const restoreAllBtn = document.getElementById('restoreAllPreviewsBtn');
    if (restoreAllBtn)
        restoreAllBtn.style.display = minimizedPreviews.size > 0 ? '' : 'none';
}
function bringToFront(tw) {
    tw.el.style.zIndex = String(++nextZ);
}
function applyGeometry(tw) {
    tw.el.style.left = `${tw.x}px`;
    tw.el.style.top = `${tw.y}px`;
    tw.el.style.width = `${tw.w}px`;
    tw.el.style.height = `${tw.h}px`;
}
function posKey(name) { return 'sdTerm:' + name; }
function savePos(tw) {
    try {
        localStorage.setItem(posKey(tw.name), JSON.stringify({ x: tw.x, y: tw.y, w: tw.w, h: tw.h }));
    }
    catch { }
}
function loadSavedPos(name) {
    try {
        const raw = localStorage.getItem(posKey(name));
        if (!raw)
            return null;
        const p = JSON.parse(raw);
        if (typeof p.x === 'number' && typeof p.w === 'number')
            return p;
    }
    catch { }
    return null;
}
