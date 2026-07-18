"use strict";
function sessionRuntime(session) {
    if (!session.running)
        return { label: 'offline', dotClass: '', className: 'offline' };
    const shell = shellPreviewByName(session.name);
    if (shell && shell.running) {
        return shellWorking(session.name)
            ? { label: 'running', dotClass: 'on', className: 'running' }
            : { label: 'waiting', dotClass: 'wait', className: 'waiting' };
    }
    return { label: session.attached ? 'attached' : 'running', dotClass: 'on', className: 'running' };
}
function renderSessionList() {
    renderShellTabs();
    if (typeof renderSessionRail === 'function')
        renderSessionRail();
    renderSelectedSessionActions();
}
function renderSelectedSessionActions() {
    const selected = selectedSessionModel() || sessions()[0] || null;
    const el = document.getElementById('sessionActions');
    if (!el)
        return;
    const tools = document.querySelector('.shell-tools');
    if (tools && el.parentElement !== tools) {
        el.classList.add('toolbar-session-actions');
        tools.insertAdjacentElement('afterbegin', el);
    }
    if (!selected) {
        el.innerHTML = '';
        el.hidden = true;
        return;
    }
    const state = sessionRuntime(selected);
    const n = escapeHtml(selected.name);
    const createDisabled = selected.family === 'custom' || !shellUnlocked ? 'disabled' : '';
    // Offline: Start (no prompt) + Remove. Running: New tmux / Restart / Terminate + attach helpers.
    let actionButtons = '';
    if (selected.running) {
        actionButtons =
            `<button type="button" ${createDisabled} data-create="${n}" title="Create another tmux session from this slot">${icon('plus')}<span>New tmux</span></button>` +
                `<button class="iconly" type="button" data-restart="${n}" title="Restart this tmux session" aria-label="Restart tmux session">${icon('restart')}<span>Restart</span></button>` +
                `<button class="warn" type="button" data-stop="${n}" title="Terminate this tmux session and hide it" aria-label="Terminate tmux session">${icon('power')}<span>Terminate</span></button>` +
                `<button type="button" data-copy="${escapeHtml(selected.command)}" title="Copy tmux attach command">${icon('help')}<span>Attach</span></button>` +
                (selected.sshCommand
                    ? `<button type="button" data-copy="${escapeHtml(selected.sshCommand)}" title="Copy SSH attach command">${icon('terminal')}<span>SSH</span></button>`
                    : '');
    }
    else {
        const startBtn = selected.family === 'custom'
            ? ''
            : `<button class="primary" type="button" ${createDisabled} data-start="${n}" title="Start this offline session (create tmux now)">${icon('plus')}<span>Start</span></button>`;
        const removeBtn = canRemoveClosedShell(selected)
            ? `<button class="warn remove-closed-action" type="button" data-remove-closed="${n}" title="Hide this offline session from the list">${icon('trash')}<span>Remove</span></button>`
            : '';
        const offlineCount = sessions().filter((s) => !s.running).length;
        const clearAll = offlineCount > 1
            ? `<button class="warn" type="button" data-remove-all-offline title="Hide every offline session from the list">${icon('trash')}<span>Hide all offline</span></button>`
            : '';
        actionButtons = startBtn + removeBtn + clearAll;
    }
    const attached = selected.attached > 0 ? `<span class="session-chip">${selected.attached} attached</span>` : '';
    const displayLabel = shellDisplayLabel(selected.name, selected.label);
    el.hidden = false;
    el.title = `${displayLabel}: ${state.label}${attached ? `, ${selected.attached} attached` : ''}`;
    el.innerHTML = `<div class="session-action-meta"><span class="badge">${escapeHtml(selected.badge)}</span><div><b>${escapeHtml(displayLabel)}</b><small><i class="dot ${state.dotClass}"></i>${escapeHtml(state.label)} · <span data-act-epoch="${selected.activity ?? ''}">${escapeHtml(fmtTime(selected.activity))}</span>${attached}</small></div></div><div class="session-action-buttons" aria-label="Actions for ${escapeHtml(displayLabel)}">${actionButtons}</div>`;
    scheduleShellGridFit();
}
let shellTabsSignature = '';
function invalidateShellTabs() {
    shellTabsSignature = '';
}
function shellbarSummaryWords() {
    // Tabs now fill the bar (flex-wrap), so each tab is narrower than the old wide grid; the
    // brief is clamped to 2 lines per tab. Keep word counts modest so it reads cleanly — the
    // full work title still shows on the shell card and in the tab's title= tooltip.
    if (window.innerWidth <= 760)
        return 4;
    if (window.innerWidth >= 3200)
        return 12;
    if (window.innerWidth >= 2400)
        return 10;
    if (window.innerWidth >= 1700)
        return 8;
    return 6;
}
function shellbarSummary(session) {
    return sessionWorkBrief(session, shellbarSummaryWords());
}
function sessionTabLabel(session) {
    const alias = shellLabelAliases()[session.name]?.trim();
    if (alias)
        return alias;
    return compactShellLabel(session.name, session.label || session.name);
}
function sessionTabFallback(session, state) {
    const label = sessionTabLabel(session);
    const status = `${state.label} · ${fmtTime(session.activity)}`;
    return label ? `${label} · ${status}` : status;
}
function renderShellTabs() {
    // Live-center: conversation sidebar is the session list — top tabs are redundant noise.
    const tabs = document.getElementById('shellTabs');
    if (tabs) {
        tabs.innerHTML = '';
        tabs.hidden = true;
        tabs.setAttribute('aria-hidden', 'true');
    }
    document.getElementById('shellTipBar')?.remove();
    document.getElementById('legend')?.remove();
    markSelectedShell();
    if (typeof renderSessionRail === 'function')
        renderSessionRail();
    renderSelectedSessionActions();
    // "Show terminated" lives on the conversation panel when any are hidden.
    const restore = document.getElementById('restoreHiddenSessions');
    const hiddenCount = hiddenClosedShellCount();
    if (restore) {
        restore.hidden = hiddenCount === 0;
        restore.textContent = hiddenCount
            ? `Show ${hiddenCount} hidden session${hiddenCount === 1 ? '' : 's'}`
            : '';
    }
}
// One-time collapsible legend explaining the composer buttons + status dots, inserted
// under the shell tabs (the icons alone are otherwise easy to mix up).
function buildLegend() {
    if (document.getElementById('legend'))
        return;
    const tabs = document.getElementById('shellTabs');
    if (!tabs)
        return;
    const items = [
        ['send', 'Send', 'Type the text and press Enter in the shell'],
        ['mic', 'Mic', 'Record your voice; click again to stop and transcribe'],
        ['paste', 'Paste', 'Insert the text without pressing Enter'],
        ['image', 'Image', 'Attach an image; inserts its saved path'],
        ['enter', 'Enter', 'Press Enter in the shell'],
        ['stop', 'Ctrl-C', 'Interrupt the running command (does not kill the session)'],
        ['power', 'Terminate session', 'Kill this tmux session and hide it from this dashboard'],
        ['clock', 'History', 'Cycle previous inputs (or up / down in the box)'],
        ['eraser', 'Clear', 'Clear the shell screen'],
        ['copy', 'Copy', 'Copy the pane output'],
        ['eyeoff', 'Privacy', 'Blur this shell text until you show it again'],
        ['terminal', 'Shell in', 'Open a live interactive terminal in this session'],
        ['restart', 'Resume', "Re-run the agent's resume command shown in the pane"],
    ];
    // Toolbar controls in the Shells header (the cryptic ones, e.g. the "80" dropdown).
    const toolbar = [
        ['focus', 'Focus / Grid', 'Focus = one shell. Grid = all shells side-by-side. Drag the ⋮⋮ grip (or card header) onto another shell to reorder.'],
        ['rows', 'Lines · 80 / 200 / 500', 'How many recent output lines each preview shows'],
        ['follow', 'Follow', 'Auto-scroll previews to the newest output'],
        ['summary', 'Summary', 'Refresh the AI work-title for each shell'],
        ['refresh', 'Refresh', 'Reload all shell previews now'],
    ];
    const toRow = ([ic, name, desc]) => `<div class="legend-row">${icon(ic)}<b>${name}</b><span>${escapeHtml(desc)}</span></div>`;
    const rows = items.map(toRow).join('');
    const toolbarRows = toolbar.map(toRow).join('');
    const status = `<div class="legend-row"><span class="dot on"></span><b>running</b><span>output changed recently</span></div><div class="legend-row"><span class="dot wait"></span><b>waiting</b><span>session is alive but idle</span></div>`;
    const details = document.createElement('details');
    details.id = 'legend';
    details.className = 'legend';
    details.innerHTML = `<summary>Button legend — what each control does</summary><div class="legend-section">Shell buttons</div><div class="legend-grid">${rows}</div><div class="legend-section">Toolbar</div><div class="legend-grid">${toolbarRows}</div><div class="legend-section">Status</div><div class="legend-grid">${status}</div>`;
    tabs.insertAdjacentElement('afterend', details);
}
function renderTickers(list, unconfigured = false) {
    const bar = document.getElementById('tickerBar');
    if (!bar)
        return;
    if (unconfigured) {
        bar.hidden = false;
        bar.innerHTML = '<span class="ticker-empty">Live quotes need a Finnhub key — <a class="ticker-link" href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer">get a free one</a>, then set <code>FINNHUB_API_KEY</code></span>';
        return;
    }
    if (!list.length) {
        bar.hidden = false;
        bar.innerHTML = '<span class="ticker-empty">No tickers configured</span>';
        return;
    }
    bar.hidden = false;
    bar.innerHTML = list.map((t) => {
        const up = t.changePct >= 0;
        const price = t.price >= 1000 ? Math.round(t.price).toLocaleString() : t.price.toFixed(2);
        return `<span class="tick ${up ? 'up' : 'down'}"><b>${escapeHtml(t.symbol)}</b> ${price} <i>${up ? '▲' : '▼'}${Math.abs(t.changePct).toFixed(2)}%</i></span>`;
    }).join('');
}
