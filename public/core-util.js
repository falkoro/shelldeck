"use strict";
// Split from core-orig.ts L212-274
function fmtTime(epoch) {
    // Relative "last activity" time for the sessions dashboard (code.falkinator.org).
    // Much more useful than absolute timestamps for monitoring long-running agents.
    if (!epoch)
        return 'never';
    const secs = Math.floor(Date.now() / 1000) - epoch;
    if (secs < 45)
        return 'just now';
    if (secs < 90)
        return '1m ago';
    if (secs < 3600)
        return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400)
        return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
}
function toast(text) {
    const el = q('#toast');
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
}
function fallbackCopyText(text) {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', 'true');
    fallback.style.position = 'fixed';
    fallback.style.top = '0';
    fallback.style.left = '-9999px';
    fallback.style.width = '1px';
    fallback.style.height = '1px';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.focus({ preventScroll: true });
    fallback.select();
    fallback.setSelectionRange(0, fallback.value.length);
    let copied = false;
    try {
        copied = document.execCommand('copy');
    }
    finally {
        fallback.remove();
        previousFocus?.focus({ preventScroll: true });
    }
    return copied;
}
async function copyText(text) {
    let clipboardError = '';
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            toast('Copied');
            return;
        }
        catch (error) {
            clipboardError = error instanceof Error ? error.message : String(error);
        }
    }
    if (fallbackCopyText(text)) {
        toast('Copied');
        return;
    }
    const reason = clipboardError ? ` (${clipboardError})` : '';
    throw new Error(`Clipboard copy blocked by the browser${reason}`);
}
