"use strict";
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
    // If nothing remains docked in the live stage, show the empty prompt again.
    const stage = document.getElementById('liveStage');
    const hasDocked = Array.from(termWindows.values()).some((w) => w.el.classList.contains('term-docked') && !w.el.hidden);
    if (stage && !hasDocked) {
        document.getElementById('liveStageEmpty')?.removeAttribute('hidden');
        document.getElementById('liveStageTools')?.replaceChildren();
        const title = document.getElementById('liveStageTitle');
        const hint = document.getElementById('liveStageHint');
        if (title)
            title.textContent = 'Live terminal';
        if (hint)
            hint.textContent = 'Pick a session to attach';
    }
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
