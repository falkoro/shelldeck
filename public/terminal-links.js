"use strict";
// Terminal link detection + clipboard setup. Part of the terminal global-script module (shares state declared in terminal.ts; load after it).
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
function detectTerminalLinksCached(tw, bufferLineNumber) {
    const term = tw.term;
    const buffer = term?.buffer?.active;
    const line = buffer?.getLine(bufferLineNumber - 1);
    const lineText = line?.translateToString(true) || '';
    let cache = terminalLinkCache.get(term);
    if (!cache) {
        cache = new Map();
        terminalLinkCache.set(term, cache);
    }
    if (cache.has(lineText))
        return cache.get(lineText);
    const links = detectTerminalLinks(tw, bufferLineNumber);
    cache.set(lineText, links);
    if (cache.size > 400)
        cache.clear();
    return links;
}
function setupTerminalLinks(tw) {
    if (typeof tw.term?.registerLinkProvider !== 'function')
        return;
    tw.term.registerLinkProvider({
        provideLinks: (lineNumber, callback) => {
            callback(detectTerminalLinksCached(tw, lineNumber));
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
