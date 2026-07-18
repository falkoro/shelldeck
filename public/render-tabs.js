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
    const createReason = !shellUnlocked
        ? 'Unlock shells before creating tmux sessions'
        : selected.family === 'custom'
            ? 'ShellDeck can only create new tmux sessions from configured shell slots'
            : selected.running
                ? 'Create another tmux session using this shell slot as the template'
                : 'Create this tmux session';
    const createDisabled = selected.family === 'custom' || !shellUnlocked ? 'disabled' : '';
    const removeButton = canRemoveClosedShell(selected)
        ? `<button class="warn remove-closed-action" type="button" data-remove-closed="${escapeHtml(selected.name)}" title="Remove this closed session from the dashboard">${icon('trash')}<span>Remove</span></button>`
        : '';
    const attached = selected.attached > 0 ? `<span class="session-chip">${selected.attached} attached</span>` : '';
    const displayLabel = shellDisplayLabel(selected.name, selected.label);
    const sshButton = selected.sshCommand
        ? `<button type="button" data-copy="${escapeHtml(selected.sshCommand)}" title="Copy SSH command to attach to this tmux session from another machine">${icon('terminal')}<span>SSH</span></button>`
        : '';
    el.hidden = false;
    el.title = `${displayLabel}: ${state.label}${attached ? `, ${selected.attached} attached` : ''}`;
    el.innerHTML = `<div class="session-action-meta"><span class="badge">${escapeHtml(selected.badge)}</span><div><b>${escapeHtml(displayLabel)}</b><small><i class="dot ${state.dotClass}"></i>${escapeHtml(state.label)} · <span data-act-epoch="${selected.activity ?? ''}">${escapeHtml(fmtTime(selected.activity))}</span>${attached}</small></div></div><div class="session-action-buttons" aria-label="Actions for ${escapeHtml(displayLabel)}"><button type="button" ${createDisabled} data-create="${escapeHtml(selected.name)}" title="${escapeHtml(createReason)}">${icon('plus')}<span>New tmux</span></button>${removeButton}<button type="button" data-copy="${escapeHtml(selected.command)}" title="Copy tmux attach command">${icon('help')}<span>Attach</span></button>${sshButton}</div>`;
    // The toolbar width just changed — re-measure the floating-toolbar reservation.
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
    const modelSessions = typeof orderedVisibleSessions === 'function'
        ? orderedVisibleSessions()
        : orderSessionsByPins(sessions(), pinnedSessionNames());
    const hiddenCount = hiddenClosedShellCount();
    const pinSig = pinnedSessionNames().join(',');
    const tabWidthTier = window.innerWidth >= 2400 ? 2 : window.innerWidth >= 1700 ? 1 : 0;
    const signature = `${hiddenCount}|${pinSig}|` + modelSessions.map((session) => {
        const state = sessionRuntime(session);
        return `${tabWidthTier}:${hiddenCount}:${shellbarSummaryWords()}:${session.name}:${session.label}:${session.running ? 1 : 0}:${session.attached}:${session.activity || 0}:${state.label}:${shellbarSummary(session.name)}`;
    }).join('|');
    if (signature === shellTabsSignature) {
        if (typeof renderSessionRail === 'function')
            renderSessionRail();
        return;
    }
    shellTabsSignature = signature;
    const restored = hiddenCount
        ? `<button type="button" class="session-tab restore-hidden-tab" data-restore-hidden-closed title="Show ${hiddenCount} terminated session${hiddenCount === 1 ? '' : 's'} again">${icon('plus')}<span class="session-tab-body"><span class="session-tab-top"><span class="session-tab-label">Show terminated</span></span><span class="session-tab-summary">${hiddenCount} hidden</span></span></button>`
        : '';
    q('#shellTabs').innerHTML = modelSessions.map((session) => {
        const state = sessionRuntime(session);
        const timeShort = fmtTime(session.activity).replace(/\s*ago$/, '').replace('just now', 'now').replace('never', '');
        const workTitle = sessionWorkTitle(session.name);
        const workBrief = workTitle || shellbarSummary(session.name);
        const briefText = workBrief || sessionTabFallback(session, state);
        const labelText = sessionTabLabel(session);
        const titleText = labelText || briefText;
        const summaryText = labelText && workBrief && workBrief !== labelText ? workBrief : '';
        const showSummary = Boolean(summaryText);
        const summaryBlock = showSummary
            ? `<span class="session-tab-summary">${escapeHtml(summaryText)}</span>`
            : '';
        const pinned = isSessionPinned(session.name, pinnedSessionNames());
        return `<button type="button" class="session-tab ${escapeHtml(session.family)} ${state.className}${showSummary ? '' : ' no-summary'}${labelText ? '' : ' no-label'}${pinned ? ' pinned' : ''}" data-select-session="${escapeHtml(session.name)}" data-shell-tab="${escapeHtml(session.name)}" title="${escapeHtml(workTitle || labelText || session.name)}"><span class="badge">${escapeHtml(session.badge)}</span><i class="dot ${state.dotClass}" aria-hidden="true"></i><span class="session-tab-body"><span class="session-tab-top"><span class="session-tab-label">${escapeHtml(titleText)}</span><span class="session-tab-time">${escapeHtml(timeShort)}</span></span>${summaryBlock}</span></button>`;
    }).join('') + restored;
    markSelectedShell();
    if (typeof renderSessionRail === 'function')
        renderSessionRail();
    renderSelectedSessionActions();
    buildLegend();
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
