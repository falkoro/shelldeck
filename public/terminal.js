"use strict";
let activeTerm = null;
function closeTerminal() {
    if (activeTerm) {
        activeTerm.dispose();
        activeTerm = null;
    }
}
function openTerminal(name) {
    if (!name)
        return;
    if (typeof Terminal === 'undefined') {
        toast('Terminal failed to load');
        return;
    }
    closeTerminal();
    const overlay = document.createElement('div');
    overlay.className = 'term-modal';
    overlay.innerHTML = `<div class="term-box"><div class="term-bar"><b>${escapeHtml(name)} · live terminal</b><span class="term-status" data-role="tstatus">connecting…</span><button type="button" class="term-close">${icon('eyeoff')}<span>Close</span></button></div><div class="term-host" data-role="thost"></div></div>`;
    document.body.appendChild(overlay);
    const host = overlay.querySelector('[data-role="thost"]');
    const status = overlay.querySelector('[data-role="tstatus"]');
    const term = new Terminal({
        fontSize: 13,
        fontFamily: '"Cascadia Mono","JetBrains Mono",Consolas,monospace',
        cursorBlink: true,
        scrollback: 5000,
        theme: { background: '#03070b', foreground: '#c9fff3' },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/term?name=${encodeURIComponent(name)}&cols=${term.cols}&rows=${term.rows}`);
    ws.binaryType = 'arraybuffer';
    const enc = new TextEncoder();
    ws.onopen = () => { status.textContent = 'connected'; term.focus(); };
    ws.onclose = () => { status.textContent = 'disconnected'; };
    ws.onerror = () => { status.textContent = 'connection error'; };
    ws.onmessage = (event) => {
        if (typeof event.data === 'string')
            term.write(event.data);
        else
            term.write(new Uint8Array(event.data));
    };
    term.onData((data) => { if (ws.readyState === WebSocket.OPEN)
        ws.send(enc.encode(data)); });
    // Debounce fits and only push a resize when the size truly changed, so the tmux window (and any
    // other attached client) isn't reflowed on every pixel nudge.
    let lastCols = 0;
    let lastRows = 0;
    let fitTimer = 0;
    const doFit = () => {
        window.clearTimeout(fitTimer);
        fitTimer = window.setTimeout(() => {
            try {
                fit.fit();
                if (ws.readyState === WebSocket.OPEN && (term.cols !== lastCols || term.rows !== lastRows)) {
                    lastCols = term.cols;
                    lastRows = term.rows;
                    ws.send(JSON.stringify({ cols: term.cols, rows: term.rows }));
                }
            }
            catch { /* ignore transient fit errors */ }
        }, 150);
    };
    const ro = new ResizeObserver(() => doFit());
    ro.observe(host);
    overlay.querySelector('.term-close').addEventListener('click', () => closeTerminal());
    // click on the dark backdrop (not inside the box) closes; ESC is left for the terminal (agents use it)
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay)
        closeTerminal(); });
    activeTerm = {
        dispose: () => {
            window.clearTimeout(fitTimer);
            ro.disconnect();
            try {
                ws.close();
            }
            catch { /* already closed */ }
            try {
                term.dispose();
            }
            catch { /* noop */ }
            overlay.remove();
        },
    };
    setTimeout(doFit, 60);
}
