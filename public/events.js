"use strict";
// events split L512-None
document.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest('.card-reorder-handle');
    const header = target?.closest('.terminal-card > header');
    if (!handle && !header)
        return;
    // Don't initiate drag when clicking buttons, inputs, or the card window controls
    if (!handle && event.target?.closest('button,input,textarea,select,[data-minimize-shell],[data-maximize-shell]'))
        return;
    const card = (handle || header)?.closest('[data-shell-card]');
    if (!card)
        return;
    const name = card.dataset.shellCard || '';
    if (!name)
        return;
    const grid = card.parentElement;
    if (!grid)
        return;
    const startX = event.clientX;
    const startY = event.clientY;
    let reorderActive = false;
    let dragEl = null;
    const onMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!reorderActive && Math.abs(dx) + Math.abs(dy) < DRAG_REORDER_THRESHOLD)
            return;
        if (!reorderActive) {
            reorderActive = true;
            card.classList.add('reorder-dragging');
            dragEl = card.cloneNode(true);
            dragEl.classList.add('reorder-clone');
            dragEl.style.position = 'fixed';
            dragEl.style.pointerEvents = 'none';
            dragEl.style.zIndex = '999';
            dragEl.style.width = `${card.offsetWidth}px`;
            dragEl.style.left = '0';
            dragEl.style.top = '0';
            dragEl.style.opacity = '0.85';
            dragEl.style.transform = 'scale(0.97)';
            document.body.appendChild(dragEl);
            card.style.opacity = '0.35';
        }
        // Update clone position
        if (dragEl) {
            dragEl.style.left = `${e.clientX - 40}px`;
            dragEl.style.top = `${e.clientY - 14}px`;
        }
        // Highlight target position
        const cards = Array.from(grid.querySelectorAll('[data-shell-card]:not(.reorder-dragging)'));
        cards.forEach((c) => c.classList.remove('reorder-target'));
        const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-shell-card]');
        if (targetEl && targetEl !== card)
            targetEl.classList.add('reorder-target');
    };
    const onUp = (e) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('reorder-dragging');
        card.style.opacity = '';
        if (dragEl)
            dragEl.remove();
        grid.querySelectorAll('[data-shell-card]').forEach((c) => c.classList.remove('reorder-target'));
        if (!reorderActive)
            return;
        // Find the card we dropped on
        const dropTarget = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-shell-card]');
        if (!dropTarget || dropTarget === card)
            return;
        const targetName = dropTarget.dataset.shellCard || '';
        if (!targetName)
            return;
        // Reorder in the saved list
        const order = shellOrder();
        const fromIdx = order.indexOf(name);
        const toIdx = order.indexOf(targetName);
        if (fromIdx < 0 || toIdx < 0)
            return;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, name);
        saveShellOrder(order);
        // Physically reorder in DOM
        const fromCard = grid.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
        const toCard = grid.querySelector(`[data-shell-card="${selectorEscape(targetName)}"]`);
        if (fromCard && toCard) {
            if (fromIdx > toIdx)
                toCard.before(fromCard);
            else
                toCard.after(fromCard);
        }
        scheduleShellGridFit();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
});
// --- Drag-to-resize shell cards ---
document.addEventListener('mousedown', (event) => {
    const handle = event.target?.closest('.card-resize-handle');
    if (!handle)
        return;
    event.preventDefault();
    event.stopPropagation();
    const card = handle.closest('[data-shell-card]');
    if (!card)
        return;
    const name = card.dataset.shellCard || '';
    const startX = event.clientX;
    const startY = event.clientY;
    const origH = card.offsetHeight;
    const origW = card.offsetWidth;
    card.classList.add('resizing');
    const onMove = (e) => {
        const newH = Math.max(280, Math.min(1200, origH + (e.clientY - startY)));
        const newW = Math.max(340, Math.min(window.innerWidth - 40, origW + (e.clientX - startX)));
        card.style.minHeight = `${newH}px`;
        if (newW > 340)
            card.style.maxWidth = `${newW}px`;
        // Update the pre element's max-height to keep it proportional
        const pre = card.querySelector('[data-role="output"]');
        if (pre)
            pre.style.maxHeight = `${Math.max(180, newH - 220)}px`;
        // Track that this card has been resized
        card.dataset.sized = '1';
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('resizing');
        if (name) {
            saveShellCardSize(name, { w: card.offsetWidth, h: card.offsetHeight });
        }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
});
function markBooted() {
    document.body.classList.add('booted');
}
render(initialModel);
applyBrandIcon();
startTopbarClock();
// Hold the boot splash up until the first LIVE shell load confirms session state. The injected
// initial model is a point-in-time server snapshot (running = "tmux session exists"), so revealing
// it immediately flashes a stale "running" before the live fetch lands. Gating the reveal on
// loadShells() means we only ever show client-confirmed state. The timeout is a safety net so the
// splash can never stick if the fetch hangs (the page also keeps its own 4s hard fallback).
const bootSplashFallback = setTimeout(markBooted, 4000);
const liftBootSplash = () => { clearTimeout(bootSplashFallback); markBooted(); };
queueMicrotask(() => loadSummary().catch(() => { }));
queueMicrotask(() => loadShells().then(() => {
    startShellStream();
    window.maybeAutoOpenMobileShell?.();
}).catch((error) => toast(error.message)).finally(liftBootSplash));
setInterval(() => refresh({ preserveUnlock: true }).catch(() => { }), 30000);
setInterval(() => loadSummary().catch(() => { }), 60000);
// Live-tick relative last activity labels (the main "add last activity" UX fix for code.falkinator.org)
// Note: defined in core.ts (loaded before events.js in the page).
window.updateLastActivityTimes?.();
setInterval(() => window.updateLastActivityTimes?.(), 30000);
queueMicrotask(() => {
    loadDashboardSettings()
        .catch(() => { })
        .finally(() => {
        loadTickers().catch(() => { });
        loadMetrics().catch(() => { });
        loadContainers().catch(() => { });
        loadRemoteHosts().catch(() => { });
        loadGhRuns().catch(() => { });
        loadLinks().catch(() => { });
    });
});
setInterval(() => loadTickers().catch(() => { }), 60000);
setInterval(() => loadMetrics().catch(() => { }), 5000);
setInterval(() => loadContainers().catch(() => { }), 15000);
setInterval(() => loadRemoteHosts().catch(() => { }), 20000);
setInterval(() => loadGhRuns().catch(() => { }), 60000);
window.addEventListener('resize', () => {
    shellTabsSignature = '';
    applyWorkTitles();
});
