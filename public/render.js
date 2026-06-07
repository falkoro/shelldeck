"use strict";
function renderBasicMarkdown(value) {
    return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}
function createShellCard(shell) {
    const article = document.createElement('article');
    article.dataset.shellCard = shell.name;
    article.dataset.selectSession = shell.name;
    article.innerHTML = `<header>
    <div class="card-title"><div class="card-title-row"><b data-role="label"></b><span class="shell-name-pill"><span data-role="rawname"></span><i class="name-spinner" aria-hidden="true"></i></span><button type="button" class="card-label-edit" data-rename-shell title="Rename this card" aria-label="Rename this card">${icon('edit')}</button><button type="button" class="card-label-reset" data-reset-shell-label title="Reset to auto-generated name" aria-label="Reset to auto-generated name">${icon('refresh')}</button></div><span data-role="command"></span></div>
    <button type="button" class="card-create-btn" data-create title="Create this tmux session">${icon('plus')}<span>New tmux</span></button>
    <div class="terminal-meta"><span class="agent-badge" data-role="agent"></span><span class="dot" data-role="dot"></span><span data-role="cwd"></span></div>
    <div class="card-window-controls">
      <button type="button" class="card-win-btn win-min" data-minimize-shell title="Minimize this preview to dock" aria-label="Minimize preview to dock">−</button>
      <button type="button" class="card-win-btn win-full" data-maximize-preview title="Fullscreen this preview" aria-label="Fullscreen preview">⛶</button>
      <button type="button" class="card-win-btn win-close" data-stop title="Kill this tmux session" aria-label="Kill tmux session">×</button>
    </div>
  </header>
  <div class="work-title" data-role="worktitle"></div>
  <div class="shell-composer">
    <textarea spellcheck="false" data-command placeholder="Type for this shell. Enter sends on mobile; Ctrl+Enter on desktop."></textarea>
    <div class="shell-actions">
      <button class="primary" type="button" data-send-shell title="Type the text and press Enter in the shell">${icon('send')}<span>Send</span></button>
      <button class="mic-btn" type="button" data-dictate-shell title="Record your voice; click again to stop and transcribe into this input" aria-label="Mic dictation">${icon('mic')}<span class="mic-label">Mic</span></button>
      <button class="iconly" type="button" data-paste-shell title="Paste — insert the text without pressing Enter" aria-label="Paste (no Enter)">${icon('paste')}</button>
      <button class="iconly" type="button" data-add-image title="Attach an image; inserts its saved path" aria-label="Attach image">${icon('image')}</button>
      <button class="iconly" type="button" data-key="enter" title="Press Enter in the shell" aria-label="Press Enter">${icon('enter')}</button>
      <button class="warn compact-action" type="button" data-key="interrupt" title="Interrupt the running command (Ctrl-C)" aria-label="Interrupt command (Ctrl-C)">${icon('stop')}<span>Ctrl-C</span></button>
      <button class="iconly" type="button" data-history title="Cycle previous inputs (or ↑ / ↓ in the box)" aria-label="Input history">${icon('clock')}</button>
      <button class="iconly" type="button" data-key="clear" title="Clear the shell screen" aria-label="Clear screen">${icon('eraser')}</button>
      <button class="iconly" type="button" data-copy-output title="Copy the pane output" aria-label="Copy output">${icon('copy')}</button>
      <button class="iconly" type="button" data-shellin title="Open a live interactive terminal in this session" aria-label="Shell in">${icon('terminal')}</button>
      <button class="iconly privacy-btn" type="button" data-privacy-shell title="Blur this shell text" aria-label="Blur shell text">${icon('eyeoff')}</button>
      <button class="iconly" type="button" data-restart title="Restart this tmux session (recreate it)" aria-label="Restart tmux session">${icon('restart')}</button>
      <button class="warn iconly" type="button" data-stop title="Kill this tmux session (destructive)" aria-label="Kill tmux session">${icon('power')}</button>
      <button class="warn resume-btn iconly" type="button" data-resume title="Re-run the agent's resume command shown in the pane" aria-label="Resume agent">${icon('restart')}</button>
    </div>
    <div class="attach-list" data-role="attachments"></div>
    <div class="shell-status" data-role="status">Paste or drop an image into this input to insert its saved path.</div>
  </div>
  <pre data-role="output"></pre>`;
    article.querySelector('[data-command]').dataset.command = shell.name;
    article.querySelector('[data-send-shell]').dataset.sendShell = shell.name;
    article.querySelector('[data-paste-shell]').dataset.pasteShell = shell.name;
    article.querySelector('[data-add-image]').dataset.addImage = shell.name;
    article.querySelector('[data-create]').dataset.create = shell.name;
    article.querySelector('[data-dictate-shell]').dataset.dictateShell = shell.name;
    article.querySelector('[data-history]').dataset.history = shell.name;
    article.querySelector('[data-copy-output]').dataset.copyOutput = shell.name;
    article.querySelector('[data-privacy-shell]').dataset.privacyShell = shell.name;
    article.querySelector('[data-rename-shell]').dataset.renameShell = shell.name;
    article.querySelector('[data-reset-shell-label]').dataset.resetShellLabel = shell.name;
    article.querySelector('[data-minimize-shell]').dataset.minimizeShell = shell.name;
    article.querySelector('[data-maximize-preview]').dataset.maximizePreview = shell.name;
    article.querySelector('[data-shellin]').dataset.shellin = shell.name;
    article.querySelector('[data-resume]').dataset.resume = shell.name;
    article.querySelectorAll('[data-stop]').forEach((button) => { button.dataset.stop = shell.name; });
    article.querySelector('[data-restart]').dataset.restart = shell.name;
    article.querySelectorAll('[data-key]').forEach((button) => {
        button.dataset.shell = shell.name;
    });
    // Card resize handle (bottom-right corner)
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'card-resize-handle';
    resizeHandle.title = 'Drag to resize this preview card';
    article.appendChild(resizeHandle);
    return article;
}
function updateShellCard(card, shell) {
    const keepFullscreen = card.classList.contains('preview-fullscreen');
    const keepEnlarged = card.classList.contains('preview-enlarged');
    const keepResizing = card.classList.contains('resizing');
    card.className = `terminal-card ${shell.running ? 'running' : 'offline'}${shell.name === selectedSession ? ' selected' : ''}`;
    card.classList.toggle('preview-fullscreen', keepFullscreen);
    card.classList.toggle('preview-enlarged', keepEnlarged);
    card.classList.toggle('resizing', keepResizing);
    card.classList.toggle('shell-refreshing', shellsLoading);
    applyShellPrivacy(card, shell.name);
    const displayLabel = updateShellCardTitle(card, shell);
    setText(card, '[data-role="command"]', shell.command || 'offline');
    setText(card, '[data-role="cwd"]', shell.cwd || '');
    card.querySelector('[data-role="dot"]').className = `dot ${shell.running ? 'on' : ''}`;
    noteShellActivity(shell.name, shell.output);
    setShellAgentBadge(card, shell.name);
    setWorkTitle(card, shell.name);
    // Surface a one-click recovery when an agent has exited and printed a resume command
    // (e.g. Codex: "To continue this session, run codex resume <id>").
    const resumeBtn = card.querySelector('[data-resume]');
    if (resumeBtn) {
        const m = shell.output.match(/\bcodex resume [A-Za-z0-9-]{8,}/i);
        if (m) {
            resumeBtn.dataset.resumeCmd = m[0];
            resumeBtn.classList.add('show');
        }
        else {
            delete resumeBtn.dataset.resumeCmd;
            resumeBtn.classList.remove('show');
        }
    }
    const output = shell.output || (shell.running ? 'No output captured yet.' : 'Session is offline.');
    const pre = card.querySelector('[data-role="output"]');
    // Only auto-follow when the viewer is already at the bottom, so scrolling up to read
    // older output isn't yanked back down on every 1.2s stream tick.
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48;
    setText(card, '[data-role="output"]', output);
    const input = card.querySelector('[data-command]');
    input.placeholder = shell.running ? `Input for ${displayLabel}` : 'Create this session before sending input';
    if (followOutput && atBottom)
        pre.scrollTop = pre.scrollHeight;
    renderShellImages(shell.name);
}
function updateShellCardTitle(card, shell) {
    const displayLabel = shellDisplayLabel(shell.name, shell.label);
    const rawName = shellRawNameBadge(shell.name, displayLabel);
    const label = card.querySelector('[data-role="label"]');
    renderCardTitleLabel(label, displayLabel, shellboxSummary(shell.name) || displayLabel);
    setText(card, '[data-role="rawname"]', rawName);
    card.querySelector('.shell-name-pill')?.classList.toggle('empty', !rawName);
    card.querySelector('[data-reset-shell-label]')?.classList.toggle('show', shellHasCustomLabel(shell.name));
    return displayLabel;
}
function renderCardTitleLabel(label, displayLabel, title) {
    if (!label)
        return;
    const moving = window.innerWidth <= 760 && displayLabel.length > 34;
    const signature = `${moving ? '1' : '0'}:${displayLabel}`;
    label.classList.toggle('moving', moving);
    label.title = title;
    if (label.dataset.renderedLabel === signature)
        return;
    label.dataset.renderedLabel = signature;
    if (moving) {
        label.innerHTML = `<span class="marquee-track"><span>${escapeHtml(displayLabel)}</span><span aria-hidden="true">${escapeHtml(displayLabel)}</span></span>`;
    }
    else {
        label.textContent = displayLabel;
    }
}
function applyAutoFollowUpDraft(card, shell, input) {
    const draft = extractAutoFollowUpDraft(shell.output || '');
    if (!draft || autoFollowUpSentDrafts[shell.name] === draft)
        return;
    const current = input.value.trim();
    const previous = autoFollowUpDrafts[shell.name] || '';
    if (current && current !== previous)
        return;
    if (input.value !== draft)
        input.value = draft;
    autoFollowUpDrafts[shell.name] = draft;
    const status = card.querySelector('[data-role="status"]');
    if (status)
        status.textContent = 'Follow-up draft from agent.';
    updateUnlockState();
}
function setText(parent, selector, text) {
    const element = parent.querySelector(selector);
    if (element && element.textContent !== text)
        element.textContent = text;
}
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
    const ordered = orderedShellList(latestShells);
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
    if (!document.querySelector('.terminal-card.preview-fullscreen')) {
        document.body.classList.remove('preview-fullscreen-open');
    }
    // Respect minimized previews (they live in the dock instead of the grid)
    const minPreviews = window.minimizedPreviews || new Set();
    latestShells.forEach((shell) => {
        const card = grid.querySelector(`[data-shell-card="${selectorEscape(shell.name)}"]`);
        if (card)
            card.style.display = minPreviews.has(shell.name) ? 'none' : '';
    });
    markSelectedShell();
    renderShellTabs();
    updateUnlockState();
}
function markSelectedShell() {
    document.querySelectorAll('.terminal-card,.session-tab').forEach((item) => {
        item.classList.toggle('selected', item.dataset.selectSession === selectedSession);
    });
    document.querySelectorAll('[data-shell-tab]').forEach((item) => {
        item.classList.toggle('selected', item.dataset.shellTab === selectedSession);
    });
    const cards = document.querySelectorAll('[data-shell-card]');
    // Focus mode hides every non-selected card; if the selection points at a session
    // with no pane card, fall back to the first card so the panel never goes blank.
    if (cards.length && !document.querySelector('.terminal-card.selected')) {
        cards[0].classList.add('selected');
    }
    q('#shells').classList.toggle('focus-mode', viewMode === 'focus');
}
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
    renderSelectedSessionActions();
}
function renderSelectedSessionActions() {
    const selected = selectedSessionModel() || sessions()[0] || null;
    const el = document.getElementById('sessionActions');
    if (!el)
        return;
    if (!selected) {
        el.innerHTML = '';
        el.hidden = true;
        return;
    }
    const state = sessionRuntime(selected);
    const createReason = !shellUnlocked
        ? 'Unlock shells before creating tmux sessions'
        : selected.running
            ? 'This tmux session is already running'
            : selected.family === 'custom'
                ? 'ShellDeck can only create configured tmux sessions'
                : 'Create this tmux session';
    const createDisabled = selected.running || selected.family === 'custom' || !shellUnlocked ? 'disabled' : '';
    const createLabel = selected.running ? 'Running' : 'New tmux';
    const restartDisabled = selected.family === 'custom' || !shellUnlocked ? 'disabled' : '';
    const stopDisabled = !selected.running || !shellUnlocked ? 'disabled' : '';
    const attached = selected.attached > 0 ? `<span class="session-chip">${selected.attached} attached</span>` : '';
    const displayLabel = shellDisplayLabel(selected.name, selected.label);
    const sshButton = selected.sshCommand
        ? `<button type="button" data-copy="${escapeHtml(selected.sshCommand)}" title="Copy SSH command to attach to this tmux session from another machine">${icon('terminal')}<span>SSH</span></button>`
        : '';
    el.hidden = false;
    el.innerHTML = `<div class="session-action-meta"><span class="badge">${escapeHtml(selected.badge)}</span><div><b>${escapeHtml(displayLabel)}</b><small><i class="dot ${state.dotClass}"></i>${escapeHtml(state.label)} · <span data-act-epoch="${selected.activity ?? ''}">${escapeHtml(fmtTime(selected.activity))}</span>${attached}</small></div></div><div class="session-action-buttons"><button type="button" ${createDisabled} data-create="${escapeHtml(selected.name)}" title="${escapeHtml(createReason)}">${icon('plus')}<span>${createLabel}</span></button><button class="warn" type="button" ${stopDisabled} data-stop="${escapeHtml(selected.name)}" title="Kill this tmux session">${icon('stop')}<span>Stop</span></button><button class="warn" type="button" ${restartDisabled} data-restart="${escapeHtml(selected.name)}">${icon('restart')}<span>Restart</span></button><button type="button" data-copy="${escapeHtml(selected.command)}" title="Copy tmux attach command">${icon('help')}<span>Attach</span></button>${sshButton}</div>`;
}
let shellTabsSignature = '';
function shellbarSummaryMoving(text) {
    return window.innerWidth <= 760 && text.length > 18;
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
function sessionTabFallback(session, state) {
    const label = compactShellLabel(session.name, session.label || session.name);
    const status = `${state.label} · ${fmtTime(session.activity)}`;
    return label ? `${label} · ${status}` : status;
}
function renderShellTabs() {
    const modelSessions = sessions();
    const tabWidthTier = window.innerWidth >= 2400 ? 2 : window.innerWidth >= 1700 ? 1 : 0;
    const signature = modelSessions.map((session) => {
        const state = sessionRuntime(session);
        return `${tabWidthTier}:${shellbarSummaryWords()}:${session.name}:${session.label}:${session.running ? 1 : 0}:${session.attached}:${session.activity || 0}:${state.label}:${shellbarSummary(session.name)}`;
    }).join('|');
    if (signature === shellTabsSignature)
        return;
    shellTabsSignature = signature;
    q('#shellTabs').innerHTML = modelSessions.map((session) => {
        const state = sessionRuntime(session);
        // Compact one-line tab: badge · status-dot · label · work-title (truncated, marquee when
        // selected) · relative time. Full title stays reachable via the tooltip + the card below.
        const timeShort = fmtTime(session.activity).replace(/\s*ago$/, '').replace('just now', 'now').replace('never', '');
        const workTitle = sessionWorkTitle(session.name);
        const workBrief = shellbarSummary(session.name);
        const briefText = workBrief || sessionTabFallback(session, state);
        const moving = shellbarSummaryMoving(workBrief) ? ' moving' : '';
        const labelText = session.label || session.name;
        return `<button type="button" class="session-tab ${escapeHtml(session.family)} ${state.className}${workBrief ? '' : ' no-summary'}" data-select-session="${escapeHtml(session.name)}" data-shell-tab="${escapeHtml(session.name)}" title="${escapeHtml(workTitle || session.label || session.name)}"><span class="badge">${escapeHtml(session.badge)}</span><i class="dot ${state.dotClass}" aria-hidden="true"></i><span class="session-tab-line"><span class="session-tab-label">${escapeHtml(labelText)}</span><span class="session-tab-sep" aria-hidden="true">·</span><span class="session-tab-summary${moving}"><span class="marquee-track"><span>${escapeHtml(briefText)}</span><span aria-hidden="true">${escapeHtml(briefText)}</span></span></span></span><span class="session-tab-time">${escapeHtml(timeShort)}</span></button>`;
    }).join('');
    markSelectedShell();
    renderSelectedSessionActions();
    buildLegend();
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
    }
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
    const moving = window.innerWidth <= 760 && title.length > 36;
    const signature = `${moving ? '1' : '0'}:${title}`;
    el.className = `work-title show${moving ? ' moving' : ''}`;
    el.title = title;
    if (el.dataset.renderedTitle === signature)
        return;
    el.dataset.renderedTitle = signature;
    if (moving) {
        el.innerHTML = `<span class="marquee-track"><span>${escapeHtml(title)}</span><span aria-hidden="true">${escapeHtml(title)}</span></span>`;
    }
    else {
        el.textContent = title;
    }
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
        ['power', 'Stop session', 'Kill this tmux session — destructive'],
        ['clock', 'History', 'Cycle previous inputs (or up / down in the box)'],
        ['eraser', 'Clear', 'Clear the shell screen'],
        ['copy', 'Copy', 'Copy the pane output'],
        ['eyeoff', 'Privacy', 'Blur this shell text until you show it again'],
        ['terminal', 'Shell in', 'Open a live interactive terminal in this session'],
        ['restart', 'Resume', "Re-run the agent's resume command shown in the pane"],
    ];
    // Toolbar controls in the Shells header (the cryptic ones, e.g. the "80" dropdown).
    const toolbar = [
        ['focus', 'Focus / Grid', 'Show one shell, or all panes side-by-side'],
        ['rows', 'Lines · 80 / 200 / 500', 'How many recent output lines each preview shows'],
        ['follow', 'Follow', 'Auto-scroll previews to the newest output'],
        ['summary', 'Summary', 'Refresh the AI work-title for each shell'],
        ['refresh', 'Refresh', 'Reload all shell previews now'],
    ];
    const toRow = ([ic, name, desc]) => `<div class="legend-row">${icon(ic)}<b>${name}</b><span>${escapeHtml(desc)}</span></div>`;
    const rows = items.map(toRow).join('');
    const toolbarRows = toolbar.map(toRow).join('');
    const status = `<div class="legend-row"><span class="dot on"></span><b>running</b><span>agent is working</span></div><div class="legend-row"><span class="dot wait"></span><b>waiting</b><span>agent is waiting for your input</span></div>`;
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
    q('#updated').textContent = `updated ${new Date(model.now).toLocaleTimeString([], { hour12: false })}`;
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
