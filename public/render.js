"use strict";
function renderShells(payload) {
    const grid = q('#shells');
    latestShells = payload.shells || [];
    if (latestShells.length && !payload.fromCache)
        saveShellPreviewCache(latestShells);
    if (!latestShells.length) {
        grid.innerHTML = '<div class="locked-note">No tmux panes were returned yet. Try starting a shell slot.</div>';
        updateUnlockState();
        return;
    }
    grid.querySelectorAll(':scope > .locked-note, :scope > .unlock-cta').forEach((note) => note.remove());
    const seen = new Set();
    // Use ordered list so drag-reorder persists across refreshes.
    const visibleShells = visibleShellPreviews(latestShells);
    const ordered = orderedShellList(visibleShells);
    ordered.forEach((shell, idx) => {
        seen.add(shell.name);
        let card = grid.querySelector(`[data-shell-card="${selectorEscape(shell.name)}"]`);
        if (!card) {
            card = createShellCard(shell);
            grid.appendChild(card);
        }
        // Apply saved size if available
        const savedSize = loadShellCardSize(shell.name);
        if (savedSize) {
            card.style.minHeight = `${savedSize.h}px`;
            card.dataset.sized = '1';
        }
        updateShellCard(card, shell);
    });
    grid.querySelectorAll('[data-shell-card]').forEach((card) => {
        if (!seen.has(card.dataset.shellCard || ''))
            card.remove();
    });
    applyShellCardOrder(grid, ordered);
    if (!document.querySelector('.terminal-card.preview-fullscreen')) {
        document.body.classList.remove('preview-fullscreen-open');
    }
    // Respect minimized previews (they live in the dock instead of the grid)
    const minPreviews = window.minimizedPreviews || new Set();
    visibleShells.forEach((shell) => {
        const card = grid.querySelector(`[data-shell-card="${selectorEscape(shell.name)}"]`);
        if (card)
            card.style.display = minPreviews.has(shell.name) ? 'none' : '';
    });
    markSelectedShell();
    renderShellTabs();
    if (typeof noteUnreadFromShells === 'function')
        noteUnreadFromShells(visibleShells);
    if (typeof renderSessionRail === 'function')
        renderSessionRail();
    updateUnlockState();
    scheduleShellGridFit();
}
function applyShellCardOrder(grid, ordered) {
    // Re-appending a card moves its DOM subtree, which blurs a focused composer textarea inside it
    // (the cursor "jumps away" mid-type on every ~1.2s refresh). Only touch the DOM when the order
    // actually changed (e.g. a drag-reorder) — a no-op when it already matches keeps focus intact.
    const current = Array.from(grid.querySelectorAll('[data-shell-card]'))
        .map((card) => card.dataset.shellCard || '');
    const desired = ordered
        .map((shell) => shell.name)
        .filter((name) => current.includes(name));
    if (current.join(' ') === desired.join(' '))
        return;
    ordered.forEach((shell) => {
        const card = grid.querySelector(`[data-shell-card="${selectorEscape(shell.name)}"]`);
        if (card)
            grid.appendChild(card);
    });
}
function visibleShellCardCount(grid) {
    return Array.from(grid.querySelectorAll('[data-shell-card]'))
        .filter((card) => getComputedStyle(card).display !== 'none').length;
}
function shellGridColumnCount(visibleCount, gridWidth) {
    if (viewMode === 'focus' || visibleCount <= 1)
        return 1;
    const minColWidth = 300;
    const maxCols = Math.max(1, Math.floor(gridWidth / minColWidth));
    return Math.min(visibleCount, maxCols);
}
let shellGridFitFrame = 0;
function scheduleShellGridFit() {
    if (shellGridFitFrame)
        cancelAnimationFrame(shellGridFitFrame);
    shellGridFitFrame = requestAnimationFrame(() => {
        shellGridFitFrame = 0;
        updateShellGridViewportFit();
    });
}
// On wide screens (≥1500px) the Shells toolbar is absolutely positioned over the tip/tab
// rows. Reserve its real measured width via a CSS var — the old hardcoded min(34vw,520px)
// was often narrower than the toolbar, so buttons overlapped the tab bar and clipped tab text.
function updateShellToolbarReserve() {
    const panel = document.getElementById('shellSection');
    if (!panel)
        return;
    if (window.innerWidth < 1500) {
        panel.style.removeProperty('--shell-toolbar-reserve');
        return;
    }
    const tools = panel.querySelector('.panel-header .shell-tools');
    if (!tools)
        return;
    const width = Math.ceil(Math.max(tools.scrollWidth, tools.getBoundingClientRect().width));
    if (width > 0)
        panel.style.setProperty('--shell-toolbar-reserve', `${width + 16}px`);
}
function updateShellGridViewportFit() {
    updateShellToolbarReserve();
    const grid = document.getElementById('shells');
    if (!grid)
        return;
    grid.classList.toggle('grid-mode', viewMode === 'grid');
    if (window.innerWidth <= 760) {
        grid.style.removeProperty('--shell-card-min-height');
        grid.style.removeProperty('--shell-grid-viewport-height');
        grid.style.removeProperty('--shell-grid-columns');
        return;
    }
    const cards = Array.from(grid.querySelectorAll('[data-shell-card]'))
        .filter((card) => getComputedStyle(card).display !== 'none');
    if (!cards.length)
        return;
    const rect = grid.getBoundingClientRect();
    const available = window.innerHeight - rect.top - 4;
    const visibleCount = cards.length;
    const columns = shellGridColumnCount(visibleCount, rect.width);
    const rows = Math.ceil(visibleCount / columns);
    const focusHeight = Math.max(680, Math.min(Math.floor(window.innerHeight * 0.94), Math.floor(available)));
    const sharedHeight = Math.max(420, Math.min(Math.floor(available / rows), Math.floor(window.innerHeight * 0.72)));
    const height = viewMode === 'focus' || columns <= 1 ? focusHeight : sharedHeight;
    grid.style.setProperty('--shell-grid-columns', String(columns));
    grid.style.setProperty('--shell-card-min-height', `${height}px`);
    grid.style.setProperty('--shell-grid-viewport-height', `${height * rows}px`);
    const tipBar = document.getElementById('shellTipBar');
    if (tipBar)
        tipBar.classList.toggle('layout-hint-active', viewMode === 'grid' && visibleCount > 1);
}
window.addEventListener('resize', scheduleShellGridFit);
function markSelectedShell() {
    document.querySelectorAll('.terminal-card,.session-tab').forEach((item) => {
        const name = item.dataset.selectSession || item.dataset.shellCard || item.dataset.shellTab || '';
        item.classList.toggle('selected', name === selectedSession);
    });
    document.querySelectorAll('[data-shell-tab]').forEach((item) => {
        item.classList.toggle('selected', item.dataset.shellTab === selectedSession);
    });
    if (typeof markSessionRailSelected === 'function')
        markSessionRailSelected();
    const cards = document.querySelectorAll('[data-shell-card]');
    // Focus mode hides every non-selected card; if the selection points at a session
    // with no pane card, fall back to the first card so the panel never goes blank.
    if (cards.length && !document.querySelector('.terminal-card.selected')) {
        cards[0].classList.add('selected');
    }
    q('#shells').classList.toggle('focus-mode', viewMode === 'focus');
}
function setShellAgentBadge(card, name) {
    const shell = latestShells.find((s) => s.name === name);
    const status = shell && shell.running ? (shellWorking(name) ? 'active' : 'waiting') : '';
    const badge = card.querySelector('[data-role="agent"]');
    if (badge) {
        // visibility is class-driven (CSP forbids inline styles): .agent-badge is display:none
        // by default and shown only when an .active/.waiting status class is present.
        badge.className = `agent-badge${status ? ` ${status}` : ''}`;
        badge.textContent = status === 'active' ? 'running' : status === 'waiting' ? 'waiting' : '';
        badge.title = status === 'active'
            ? 'Running: output changed recently'
            : status === 'waiting'
                ? 'Waiting: session is alive but idle'
                : '';
        badge.setAttribute('aria-label', badge.title || 'Session status');
    }
    card.classList.toggle('agent-active', status === 'active');
    card.classList.toggle('agent-waiting', status === 'waiting');
}
function setWorkTitle(card, name) {
    const el = card.querySelector('[data-role="worktitle"]');
    if (!el)
        return;
    const title = shellboxSummary(name);
    if (title) {
        renderWorkTitle(el, title);
    }
    else if (summaryLoading && !latestSummaryText) {
        // first summary still loading — show a placeholder rather than nothing
        el.textContent = 'Summarising current work…';
        el.className = 'work-title show loading';
        delete el.dataset.renderedTitle;
    }
    else {
        el.className = 'work-title';
        el.textContent = '';
        delete el.dataset.renderedTitle;
    }
}
function renderWorkTitle(el, title) {
    const signature = title;
    el.className = 'work-title show';
    el.title = title;
    if (el.dataset.renderedTitle === signature)
        return;
    el.dataset.renderedTitle = signature;
    el.textContent = title;
}
// Refresh per-slot work titles on all cards (used when a fresh summary arrives).
function applyWorkTitles() {
    document.querySelectorAll('[data-shell-card]').forEach((card) => {
        const name = card.dataset.shellCard || '';
        const shell = shellPreviewByName(name);
        if (shell)
            updateShellCardTitle(card, shell);
        setWorkTitle(card, name);
    });
    renderShellTabs();
}
function renderShellImages(name) {
    const card = document.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
    const list = card?.querySelector('[data-role="attachments"]');
    if (!list)
        return;
    list.innerHTML = (shellImages[name] || []).map((image) => `<div class="attach-chip"><img src="${escapeHtml(image.url)}" alt=""><code>${escapeHtml(image.path)}</code><button type="button" data-remove-image="${escapeHtml(image.path)}" data-shell="${escapeHtml(name)}">Remove</button></div>`).join('');
}
function render(model, options = {}) {
    currentModel = model;
    shellUnlocked = Boolean(model.unlocked) || Boolean(options.preserveUnlock && shellUnlocked);
    syncDashboardTitle(model.hostname || '');
    chooseSession(false);
    renderShellTabs();
    renderSelectedSessionActions();
    syncTargetUi();
    applyPrefs();
}
async function refresh(options = {}) {
    const response = await fetch('/api/sessions', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        throw new Error('Refresh failed');
    render(await response.json(), options);
}
