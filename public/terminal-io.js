"use strict";
// Terminal I/O: fit, clipboard images, paste/drop, selection copy. Part of the terminal global-script module (shares state declared in terminal.ts; load after it).
function doFit(tw) {
    if (!tw.fitAddon || !tw.term)
        return;
    window.clearTimeout(tw.fitTimer);
    tw.fitTimer = window.setTimeout(() => {
        try {
            tw.fitAddon.fit();
            const cols = tw.term.cols, rows = tw.term.rows;
            // Never send a too-small fit. A hidden/minimised/zero-width terminal makes the fit addon
            // propose ~1 column; sending that resizes the shared tmux window (window-size "latest")
            // down to a single column, redrawing the agent TUI vertically and breaking every preview
            // capture of the session. The backend clamps too, but skip it at the source.
            if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 20 || rows < 6)
                return;
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
function captureTerminalSelection(tw) {
    tw.pendingCopySelection = terminalSelection(tw);
}
// Read scrollback directly from the xterm buffer. selectAll()+getSelection() often
// returns empty once focus leaves the terminal (e.g. clicking the Copy toolbar button).
function terminalBufferText(term) {
    const buffer = term?.buffer?.active;
    if (!buffer?.length)
        return '';
    const parts = [];
    let y = 0;
    while (y < buffer.length) {
        let first = y;
        while (first > 0 && buffer.getLine(first)?.isWrapped)
            first -= 1;
        let last = y;
        while (buffer.getLine(last + 1)?.isWrapped)
            last += 1;
        let text = '';
        for (let row = first; row <= last; row += 1) {
            const line = buffer.getLine(row);
            if (!line)
                break;
            text += line.translateToString(row === last);
        }
        parts.push(text);
        y = last + 1;
    }
    return parts.join('\n').replace(/\n+$/, '');
}
async function copyTerminalSelection(tw) {
    const pending = tw.pendingCopySelection?.trim();
    if (pending) {
        tw.pendingCopySelection = '';
        return copyTerminalText(tw, pending);
    }
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
    if (!term) {
        tw.statusEl.textContent = 'nothing to copy';
        return;
    }
    tw.pendingCopySelection = '';
    const buffered = terminalBufferText(term);
    if (buffered.trim()) {
        return copyTerminalText(tw, buffered, ' (all)');
    }
    if (term.selectAll) {
        term.selectAll();
        const selected = term.getSelection?.() || '';
        term.clearSelection?.();
        if (selected.trim()) {
            return copyTerminalText(tw, selected, ' (all)');
        }
    }
    tw.statusEl.textContent = 'nothing to copy';
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
