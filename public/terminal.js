"use strict";
const termWindows = new Map();
let dockEl = null;
let nextZ = 75;
let cascade = 0;
const DEFAULT_W = 880;
const DEFAULT_H = 540;
const MOBILE_BREAKPOINT = 760;
const TERMINAL_PASTE_CHUNK_BYTES = 4096;
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
function doFit(tw) {
    if (!tw.fitAddon || !tw.term)
        return;
    window.clearTimeout(tw.fitTimer);
    tw.fitTimer = window.setTimeout(() => {
        try {
            tw.fitAddon.fit();
            const cols = tw.term.cols, rows = tw.term.rows;
            if (tw.ws && tw.ws.readyState === WebSocket.OPEN && (cols !== tw.lastCols || rows !== tw.lastRows)) {
                tw.lastCols = cols;
                tw.lastRows = rows;
                tw.ws.send(JSON.stringify({ cols, rows }));
            }
        }
        catch { /* transient */ }
    }, 140);
}
function terminalClipboardImages(event) {
    return Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file) => Boolean(file));
}
function terminalDroppedImages(event) {
    return Array.from(event.dataTransfer?.files || []).filter((file) => String(file.type || '').startsWith('image/'));
}
function terminalPasteText(tw, text) {
    const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u0000/g, '');
    if (tw.term?.modes?.bracketedPasteMode)
        return `\x1b[200~${clean}\x1b[201~`;
    return clean.replace(/\n/g, '\r');
}
function sendTerminalText(tw, text) {
    if (!text || !tw.ws || tw.ws.readyState !== WebSocket.OPEN)
        return;
    const bytes = new TextEncoder().encode(text);
    for (let offset = 0; offset < bytes.length; offset += TERMINAL_PASTE_CHUNK_BYTES) {
        tw.ws.send(bytes.slice(offset, offset + TERMINAL_PASTE_CHUNK_BYTES));
    }
}
async function insertTerminalImages(tw, files) {
    const paths = [];
    for (const file of files) {
        const result = await uploadImageForShell(file, tw.name, (text) => {
            tw.statusEl.textContent = text;
            setShellStatus(tw.name, text);
        });
        paths.push(result.image.path);
    }
    if (!paths.length)
        return;
    sendTerminalText(tw, paths.join(' '));
    const message = paths.length === 1 ? `Inserted ${paths[0]}` : `Inserted ${paths.length} image paths`;
    tw.statusEl.textContent = message;
    toast('Image path inserted in Shell in');
}
function uploadTerminalImages(tw, files) {
    const images = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/'));
    if (!images.length)
        return;
    insertTerminalImages(tw, images).catch((error) => {
        tw.statusEl.textContent = 'image upload failed';
        toast(error.message);
    }).finally(() => {
        tw.imageInput.value = '';
        tw.term?.focus?.();
    });
}
function openTerminalImagePicker(tw) {
    tw.imageInput.value = '';
    tw.imageInput.click();
}
function handleTerminalPaste(tw, event) {
    const files = terminalClipboardImages(event);
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!files.length && !text)
        return;
    event.preventDefault();
    event.stopPropagation();
    if (text) {
        const paste = terminalPasteText(tw, text);
        sendTerminalText(tw, paste);
        tw.statusEl.textContent = `pasted ${text.length.toLocaleString()} chars`;
        return;
    }
    insertTerminalImages(tw, files).catch((error) => {
        tw.statusEl.textContent = 'image paste failed';
        toast(error.message);
    });
}
function handleTerminalDrop(tw, event) {
    const files = terminalDroppedImages(event);
    if (!files.length)
        return;
    event.preventDefault();
    event.stopPropagation();
    insertTerminalImages(tw, files).catch((error) => {
        tw.statusEl.textContent = 'image drop failed';
        toast(error.message);
    });
}
async function copyTerminalSelection(tw) {
    const selection = terminalSelection(tw);
    if (!selection?.trim()) {
        return copyTerminalAll(tw);
    }
    await copyTerminalText(tw, selection);
}
function terminalSelection(tw) {
    return tw.term?.getSelection?.() || '';
}
async function copyTerminalText(tw, text, suffix = '') {
    tw.statusEl.textContent = 'copying...';
    try {
        await copyText(text);
    }
    catch (error) {
        tw.statusEl.textContent = 'copy failed';
        toast(error instanceof Error ? error.message : String(error));
        return;
    }
    tw.statusEl.textContent = `copied ${text.length.toLocaleString()} chars${suffix}`;
}
// Copy the entire terminal buffer (scrollback included) without the user having to
// hand-select — the only practical way to copy from the terminal on a touch device.
async function copyTerminalAll(tw) {
    const term = tw.term;
    if (!term?.selectAll)
        return copyTerminalSelection(tw);
    term.selectAll();
    const text = term.getSelection?.() || '';
    term.clearSelection?.();
    if (!text.trim()) {
        tw.statusEl.textContent = 'nothing to copy';
        return;
    }
    await copyTerminalText(tw, text, ' (all)');
}
// Read the rich clipboard (so images paste too); fall back to text-only when the browser blocks
// clipboard.read() (e.g. no permission). Mirrors the native paste handler's behaviour.
async function pasteTerminalClipboard(tw) {
    try {
        const items = await navigator.clipboard.read();
        const files = [];
        let text = '';
        for (const item of items) {
            const imageType = item.types.find((type) => type.startsWith('image/'));
            if (imageType) {
                files.push(new File([await item.getType(imageType)], 'pasted-image.png', { type: imageType }));
            }
            else if (item.types.includes('text/plain')) {
                text = await (await item.getType('text/plain')).text();
            }
        }
        if (files.length)
            return insertTerminalImages(tw, files);
        if (text) {
            sendTerminalText(tw, terminalPasteText(tw, text));
            tw.statusEl.textContent = `pasted ${text.length.toLocaleString()} chars`;
            return;
        }
    }
    catch { /* clipboard.read unsupported/blocked — fall back to text */ }
    try {
        const text = await navigator.clipboard.readText();
        if (!text)
            return;
        sendTerminalText(tw, terminalPasteText(tw, text));
        tw.statusEl.textContent = `pasted ${text.length.toLocaleString()} chars`;
    }
    catch {
        tw.statusEl.textContent = 'clipboard blocked — try right-click paste';
    }
}
// xterm renders to canvas/DOM rows without anchors, so URLs in the live terminal are
// otherwise neither clickable nor copyable as links. This provider detects http(s) URLs
// (including ones that soft-wrap across rows), makes them click-to-open, and Ctrl/Cmd+click
// copies the URL to the clipboard.
const TERMINAL_URL_RE = /https?:\/\/[^\s"'`<>]+/g;
const TERMINAL_URL_TRAILING_PUNCT_RE = /[),.;:!?\]]+$/;
const TERMINAL_LINK_HINT_MAX_CHARS = 60;
// Rebuild the logical (unwrapped) line containing the given buffer row: walk up past
// wrap continuations, then concatenate rows until the wrap run ends.
function terminalLogicalLine(term, row) {
    const buffer = term?.buffer?.active;
    if (!buffer)
        return null;
    let first = row;
    while (first > 0 && buffer.getLine(first)?.isWrapped)
        first -= 1;
    let last = row;
    while (buffer.getLine(last + 1)?.isWrapped)
        last += 1;
    let text = '';
    for (let y = first; y <= last; y += 1) {
        const line = buffer.getLine(y);
        if (!line)
            return null;
        // Keep intermediate wrapped rows untrimmed (they are full-width by definition) so
        // string offsets keep mapping 1:1 onto buffer columns; only trim the final row.
        text += line.translateToString(y === last);
    }
    return { first, text };
}
function detectTerminalLinks(tw, bufferLineNumber) {
    const term = tw.term;
    const logical = terminalLogicalLine(term, bufferLineNumber - 1);
    if (!logical)
        return undefined;
    const cols = term.cols;
    const links = [];
    TERMINAL_URL_RE.lastIndex = 0;
    let match;
    while ((match = TERMINAL_URL_RE.exec(logical.text))) {
        const url = match[0].replace(TERMINAL_URL_TRAILING_PUNCT_RE, '');
        if (!/^https?:\/\/[^/]/.test(url))
            continue;
        const startIndex = match.index;
        const endIndex = startIndex + url.length - 1;
        links.push({
            text: url,
            range: {
                start: { x: (startIndex % cols) + 1, y: logical.first + Math.floor(startIndex / cols) + 1 },
                end: { x: (endIndex % cols) + 1, y: logical.first + Math.floor(endIndex / cols) + 1 },
            },
            decorations: { pointerCursor: true, underline: true },
            activate: (event, text) => activateTerminalLink(tw, event, text),
            hover: () => showTerminalLinkHint(tw, url),
            leave: () => clearTerminalLinkHint(tw),
        });
    }
    return links.length ? links : undefined;
}
function activateTerminalLink(tw, event, url) {
    if (event.ctrlKey || event.metaKey) {
        copyText(url).then(() => {
            tw.statusEl.textContent = 'link copied';
        }).catch((error) => {
            tw.statusEl.textContent = 'copy failed';
            toast(error.message);
        });
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}
function showTerminalLinkHint(tw, url) {
    if (tw.statusEl.dataset.linkHint === undefined) {
        tw.statusEl.dataset.linkHint = tw.statusEl.textContent || '';
    }
    const short = url.length > TERMINAL_LINK_HINT_MAX_CHARS ? `${url.slice(0, TERMINAL_LINK_HINT_MAX_CHARS - 1)}…` : url;
    tw.statusEl.textContent = `${short} — click opens · Ctrl+click copies`;
}
function clearTerminalLinkHint(tw) {
    const prev = tw.statusEl.dataset.linkHint;
    if (prev === undefined)
        return;
    delete tw.statusEl.dataset.linkHint;
    tw.statusEl.textContent = prev;
}
function setupTerminalLinks(tw) {
    if (typeof tw.term?.registerLinkProvider !== 'function')
        return;
    tw.term.registerLinkProvider({
        provideLinks: (lineNumber, callback) => {
            callback(detectTerminalLinks(tw, lineNumber));
        },
    });
}
// Wire Ctrl/Cmd+C (copy selection, leaving plain Ctrl+C as SIGINT when nothing is selected),
// Ctrl/Cmd+Shift+C (always copy), and Ctrl/Cmd+V / +Shift+V (paste text or image).
function setupTerminalClipboard(tw) {
    if (typeof tw.term?.attachCustomKeyEventHandler !== 'function')
        return;
    tw.term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey))
            return true;
        const key = event.key.toLowerCase();
        if (key === 'c' && (event.shiftKey || Boolean(terminalSelection(tw)))) {
            event.preventDefault();
            copyTerminalSelection(tw).catch((error) => {
                tw.statusEl.textContent = 'copy failed';
                toast(error.message);
            });
            return false;
        }
        if (key === 'v') {
            event.preventDefault();
            pasteTerminalClipboard(tw).catch(() => { });
            return false;
        }
        return true;
    });
}
function makeDraggable(tw, bar) {
    bar.addEventListener('mousedown', (ev) => {
        if (ev.target.closest('button'))
            return;
        bringToFront(tw);
        const startX = ev.clientX, startY = ev.clientY;
        const origX = tw.x, origY = tw.y;
        const move = (e) => {
            tw.x = clamp(origX + (e.clientX - startX), 4, window.innerWidth - 220);
            tw.y = clamp(origY + (e.clientY - startY), 4, window.innerHeight - 140);
            tw.el.style.left = tw.x + 'px';
            tw.el.style.top = tw.y + 'px';
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            savePos(tw);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up, { once: true });
    });
}
function makeResizable(tw, handle) {
    handle.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        bringToFront(tw);
        const startX = ev.clientX, startY = ev.clientY;
        const origW = tw.w, origH = tw.h;
        const move = (e) => {
            tw.w = clamp(origW + (e.clientX - startX), 520, Math.min(1600, window.innerWidth - 40));
            tw.h = clamp(origH + (e.clientY - startY), 320, Math.min(1100, window.innerHeight - 60));
            applyGeometry(tw);
            doFit(tw);
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            savePos(tw);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up, { once: true });
    });
}
function createTermWindow(name) {
    const saved = loadSavedPos(name);
    const off = (cascade++ % 5) * 28;
    const compact = compactTerminalViewport();
    const viewport = viewportSize();
    const baseX = compact ? 0 : saved?.x ?? (96 + off);
    const baseY = compact ? 0 : saved?.y ?? (72 + Math.floor(off / 2));
    const baseW = compact ? viewport.width : saved?.w ?? DEFAULT_W;
    const baseH = compact ? viewport.height : saved?.h ?? DEFAULT_H;
    const el = document.createElement('div');
    el.className = 'term-window';
    el.classList.toggle('mobile', compact);
    if (compact)
        applyMobileViewportVars(el);
    el.style.left = baseX + 'px';
    el.style.top = baseY + 'px';
    el.style.width = baseW + 'px';
    el.style.height = baseH + 'px';
    el.innerHTML = `
    <div class="term-titlebar">
      <span class="term-title">${escapeHtml(name)} · live terminal</span>
      <span class="term-status" data-role="tstatus">connecting…</span>
      <div class="term-controls">
        <button type="button" class="term-btn" data-act="copy" title="Copy selected terminal text" aria-label="Copy selected terminal text">${icon('copy')}</button>
        <button type="button" class="term-btn" data-act="copyall" title="Copy all scrollback" aria-label="Copy all terminal scrollback">${icon('summary')}</button>
        <button type="button" class="term-btn term-upload" data-act="upload" title="Upload image and insert its saved path" aria-label="Upload image into terminal">${icon('image')}<span class="term-upload-label">Image</span></button>
        <button type="button" class="term-btn" data-act="reset" title="Reset size &amp; position" aria-label="Reset size and position">↺</button>
        <button type="button" class="term-btn" data-act="min" title="Minimize to dock" aria-label="Minimize terminal">−</button>
        <button type="button" class="term-btn" data-act="max" title="Maximize / restore" aria-label="Maximize or restore terminal">□</button>
        <button type="button" class="term-btn term-detach" data-act="close" title="Detach this view and return to the dashboard — the tmux session keeps running" aria-label="Detach terminal view and return to the dashboard (session keeps running)"><span class="term-detach-label">Detach</span></button>
      </div>
    </div>${TERMINAL_KEYBAR_HTML}
    <input class="term-image-input" type="file" accept="image/*" multiple hidden>
    <div class="term-host" data-host></div>
  `;
    const host = el.querySelector('[data-host]');
    const status = el.querySelector('[data-role="tstatus"]');
    const bar = el.querySelector('.term-titlebar');
    const controls = el.querySelector('.term-controls');
    const keybar = el.querySelector('[data-keybar]');
    const imageInput = el.querySelector('.term-image-input');
    document.body.appendChild(el);
    const term = new Terminal({
        fontSize: 13,
        fontFamily: '"Cascadia Mono","JetBrains Mono",Consolas,monospace',
        cursorBlink: true,
        scrollback: 6000,
        theme: { background: '#03070b', foreground: '#c9fff3' },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    const tw = {
        name, el, host, statusEl: status, imageInput, term, fitAddon: fit,
        ws: null, ro: null, fitTimer: 0, lastCols: 0, lastRows: 0,
        x: baseX, y: baseY, w: baseW, h: baseH,
        minimized: false, maximized: false, preMax: null,
        ctrlArmed: false, ctrlTimer: 0,
    };
    // Sticky Ctrl modifier for the mobile key bar: tap Ctrl to arm, then the next
    // typed letter becomes its control code (handled in onData) or the next arrow
    // tap sends Ctrl+arrow. Auto-disarms after a few seconds so it never sticks.
    const ctrlKeyBtn = keybar.querySelector('[data-termkey="ctrl"]');
    const setCtrlArmed = (on) => {
        tw.ctrlArmed = on;
        ctrlKeyBtn?.classList.toggle('armed', on);
        window.clearTimeout(tw.ctrlTimer);
        if (on)
            tw.ctrlTimer = window.setTimeout(() => setCtrlArmed(false), 4000);
    };
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/term?name=${encodeURIComponent(name)}&cols=${term.cols}&rows=${term.rows}`);
    ws.binaryType = 'arraybuffer';
    const enc = new TextEncoder();
    tw.ws = ws;
    ws.onopen = () => { status.textContent = 'connected'; term.focus(); };
    ws.onclose = () => { status.textContent = 'disconnected'; };
    ws.onerror = () => { status.textContent = 'conn error'; };
    ws.onmessage = (ev) => {
        if (typeof ev.data === 'string')
            term.write(ev.data);
        else
            term.write(new Uint8Array(ev.data));
    };
    term.onData((d) => {
        if (ws.readyState !== WebSocket.OPEN)
            return;
        // Armed Ctrl: fold a single typed letter into its control code (a/A → ^A …).
        if (tw.ctrlArmed && d.length === 1) {
            const code = d.toUpperCase().charCodeAt(0);
            setCtrlArmed(false);
            if (code >= 0x40 && code <= 0x5f) {
                ws.send(enc.encode(String.fromCharCode(code & 0x1f)));
                return;
            }
        }
        ws.send(enc.encode(d));
    });
    setupTerminalClipboard(tw);
    setupTerminalLinks(tw);
    el.addEventListener('paste', (event) => handleTerminalPaste(tw, event), { capture: true });
    host.addEventListener('contextmenu', (event) => {
        if (!terminalSelection(tw))
            return;
        event.preventDefault();
        event.stopPropagation();
        copyTerminalSelection(tw).catch((error) => {
            tw.statusEl.textContent = 'copy failed';
            toast(error.message);
        });
    });
    host.addEventListener('dragover', (event) => {
        if (terminalDroppedImages(event).length)
            event.preventDefault();
    });
    host.addEventListener('drop', (event) => handleTerminalDrop(tw, event));
    imageInput.addEventListener('change', () => uploadTerminalImages(tw, imageInput.files));
    const ro = new ResizeObserver(() => doFit(tw));
    ro.observe(host);
    tw.ro = ro;
    // controls
    controls.querySelectorAll('button').forEach((btn) => {
        const act = btn.dataset.act;
        if (act === 'copy' || act === 'copyall') {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
        }
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (act === 'copy')
                copyTerminalSelection(tw).catch((error) => {
                    tw.statusEl.textContent = 'copy failed';
                    toast(error.message);
                });
            else if (act === 'copyall')
                copyTerminalAll(tw).catch((error) => {
                    tw.statusEl.textContent = 'copy failed';
                    toast(error.message);
                });
            else if (act === 'upload')
                openTerminalImagePicker(tw);
            else if (act === 'min')
                minimizeWindow(tw);
            else if (act === 'max')
                toggleMaximize(tw);
            else if (act === 'reset')
                resetWindow(tw);
            else if (act === 'close')
                closeWindow(tw);
        });
    });
    // On-screen keys (mobile): handle on pointerdown + preventDefault so the xterm
    // textarea keeps focus and the soft keyboard never dismisses between taps.
    keybar.querySelectorAll('.term-key').forEach((btn) => {
        btn.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            const key = btn.dataset.termkey || '';
            if (key === 'ctrl') {
                setCtrlArmed(!tw.ctrlArmed);
                tw.term?.focus?.();
                return;
            }
            if (key === 'copy') {
                copyTerminalSelection(tw).catch(() => { });
                tw.term?.focus?.();
                return;
            }
            if (key === 'copyall') {
                copyTerminalAll(tw).catch(() => { });
                tw.term?.focus?.();
                return;
            }
            if (key === 'paste') {
                pasteTerminalClipboard(tw).catch(() => { });
                tw.term?.focus?.();
                return;
            }
            if (key === 'upload') {
                openTerminalImagePicker(tw);
                return;
            }
            const seq = (tw.ctrlArmed && TERMINAL_CTRL_SEQUENCES[key]) || TERMINAL_KEY_SEQUENCES[key];
            if (seq)
                sendTerminalText(tw, seq);
            if (tw.ctrlArmed)
                setCtrlArmed(false);
            tw.term?.focus?.();
        });
    });
    // interactions
    el.addEventListener('mousedown', () => bringToFront(tw));
    bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button'))
        toggleMaximize(tw); });
    makeDraggable(tw, bar);
    const handle = document.createElement('div');
    handle.className = 'term-resize-handle';
    el.appendChild(handle);
    makeResizable(tw, handle);
    termWindows.set(name, tw);
    bringToFront(tw);
    setTimeout(() => doFit(tw), 70);
    return tw;
}
function openTerminal(name) {
    if (!name)
        return;
    if (typeof Terminal === 'undefined') {
        toast('Terminal failed to load');
        return;
    }
    const existing = termWindows.get(name);
    if (existing) {
        if (existing.minimized)
            restoreWindow(existing);
        bringToFront(existing);
        existing.term?.focus?.();
        return;
    }
    createTermWindow(name);
}
function minimizeWindow(tw) {
    tw.minimized = true;
    tw.el.style.display = 'none';
    renderDock();
}
function restoreWindow(tw) {
    tw.minimized = false;
    tw.el.style.display = '';
    applyGeometry(tw);
    bringToFront(tw);
    renderDock();
    setTimeout(() => { doFit(tw); tw.term?.focus?.(); }, 50);
}
function closeWindow(tw) {
    window.clearTimeout(tw.fitTimer);
    if (tw.ro) {
        try {
            tw.ro.disconnect();
        }
        catch { }
    }
    if (tw.ws) {
        try {
            tw.ws.close();
        }
        catch { }
    }
    try {
        tw.term?.dispose?.();
    }
    catch { }
    tw.el.remove();
    termWindows.delete(tw.name);
    renderDock();
}
function toggleMaximize(tw) {
    const el = tw.el;
    if (!tw.maximized) {
        tw.preMax = { x: tw.x, y: tw.y, w: tw.w, h: tw.h };
        tw.maximized = true;
        tw.minimized = false;
        el.style.display = '';
        const m = 18;
        tw.x = m;
        tw.y = m;
        tw.w = Math.max(620, window.innerWidth - m * 2);
        tw.h = Math.max(380, window.innerHeight - m * 2 - 36);
        applyGeometry(tw);
        setTimeout(() => doFit(tw), 80);
    }
    else {
        tw.maximized = false;
        if (tw.preMax) {
            tw.x = tw.preMax.x;
            tw.y = tw.preMax.y;
            tw.w = tw.preMax.w;
            tw.h = tw.preMax.h;
            tw.preMax = null;
        }
        else {
            tw.x = 100;
            tw.y = 80;
            tw.w = DEFAULT_W;
            tw.h = DEFAULT_H;
        }
        applyGeometry(tw);
        setTimeout(() => doFit(tw), 50);
    }
    renderDock();
    bringToFront(tw);
    tw.term?.focus?.();
}
function resetWindow(tw) {
    tw.maximized = false;
    tw.minimized = false;
    tw.preMax = null;
    tw.el.style.display = '';
    try {
        localStorage.removeItem(posKey(tw.name));
    }
    catch { }
    const off = (cascade % 4) * 24;
    tw.x = 110 + off;
    tw.y = 78 + Math.floor(off / 2);
    tw.w = DEFAULT_W;
    tw.h = DEFAULT_H;
    applyGeometry(tw);
    renderDock();
    bringToFront(tw);
    setTimeout(() => { doFit(tw); tw.term?.focus?.(); }, 60);
}
// Keep a no-op closeTerminal for any stray callers in the bundle.
function closeTerminal() {
    // New multi-window model: individual windows manage their own close.
    // If you really need to nuke all, uncomment:
    // termWindows.forEach((tw) => closeWindow(tw));
}
// === Main dashboard shell preview minimize-to-dock support ===
// Lets users minimize the live preview cards (the "shells on the dashboard itself")
// to the same bottom-right dock used by the full interactive terminals.
const minimizedPreviews = new Set();
window.minimizedPreviews = minimizedPreviews;
function shellPreviewCard(name) {
    if (!name)
        return null;
    return document.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
}
function clearPreviewFullscreenState() {
    document.body.classList.toggle('preview-fullscreen-open', Boolean(document.querySelector('.terminal-card.preview-fullscreen')));
}
function clearPreviewSizing(card) {
    card.classList.remove('preview-enlarged', 'preview-fullscreen', 'resizing');
    card.style.minHeight = '';
    card.style.maxWidth = '';
    delete card.dataset.sized;
    const pre = card.querySelector('[data-role="output"]');
    if (pre)
        pre.style.maxHeight = '';
}
function minimizeShellPreview(name) {
    if (!name)
        return;
    minimizedPreviews.add(name);
    const card = shellPreviewCard(name);
    if (card) {
        card.classList.remove('preview-fullscreen');
        card.style.display = 'none';
    }
    clearPreviewFullscreenState();
    renderDock();
}
function restoreShellPreview(name) {
    minimizedPreviews.delete(name);
    const card = shellPreviewCard(name);
    if (card) {
        card.style.display = '';
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    else {
        // Card not in DOM — ask for a refresh so renderShells recreates it
        window.loadShells?.().catch(() => { });
    }
    renderDock();
}
function maximizeShellPreview(name) {
    if (!name)
        return;
    restoreShellPreview(name);
    const card = shellPreviewCard(name);
    if (!card)
        return;
    if (card.classList.contains('preview-fullscreen')) {
        resetShellPreview(name);
        return;
    }
    document.querySelectorAll('.terminal-card.preview-fullscreen').forEach((openCard) => {
        if (openCard !== card)
            openCard.classList.remove('preview-fullscreen');
    });
    card.classList.remove('preview-enlarged');
    card.classList.add('preview-fullscreen');
    card.style.display = '';
    card.style.minHeight = '';
    card.style.maxWidth = '';
    const pre = card.querySelector('[data-role="output"]');
    if (pre)
        pre.style.maxHeight = '';
    selectSession(name);
    clearPreviewFullscreenState();
}
function resetShellPreview(name) {
    if (!name)
        return;
    minimizedPreviews.delete(name);
    const card = shellPreviewCard(name);
    if (card) {
        clearPreviewSizing(card);
        resetShellCardSize(name);
        card.style.display = '';
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    else {
        window.loadShells?.().catch(() => { });
    }
    clearPreviewFullscreenState();
    renderDock();
}
function restoreAllShellPreviews() {
    minimizedPreviews.clear();
    document.querySelectorAll('[data-shell-card]').forEach((card) => {
        card.style.display = '';
        card.classList.remove('preview-fullscreen');
    });
    clearPreviewFullscreenState();
    renderDock();
}
window.restoreAllShellPreviews = restoreAllShellPreviews;
// Expose for the click delegation in events.ts
window.minimizeShellPreview = minimizeShellPreview;
window.restoreShellPreview = restoreShellPreview;
window.maximizeShellPreview = maximizeShellPreview;
window.resetShellPreview = resetShellPreview;
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape')
        return;
    const card = document.querySelector('.terminal-card.preview-fullscreen');
    if (!card)
        return;
    event.preventDefault();
    resetShellPreview(card.dataset.shellCard || '');
});
// One-shot on a phone: drop straight into the most relevant shell so ShellDeck opens
// "in the shellbox" instead of on a long scroll of preview cards. Detaching the terminal
// returns to the compact launcher list, and a reload re-enters the shell.
let mobileAutoOpened = false;
function maybeAutoOpenMobileShell() {
    if (mobileAutoOpened)
        return;
    if (!compactTerminalViewport())
        return;
    if (!shellUnlocked)
        return; // a locked terminal couldn't connect — leave them on the list
    if (termWindows.size)
        return; // user already has a terminal open
    const target = chooseSession(true) || sessions()[0] || null;
    if (!target)
        return;
    mobileAutoOpened = true;
    openTerminal(target.name);
}
window.maybeAutoOpenMobileShell = maybeAutoOpenMobileShell;
window.addEventListener('resize', refreshTerminalViewportMode);
window.visualViewport?.addEventListener('resize', refreshTerminalViewportMode);
window.visualViewport?.addEventListener('scroll', refreshTerminalViewportMode);
