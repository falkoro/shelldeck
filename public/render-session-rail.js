"use strict";
// Sidebar conversation panel: live summary of what each shell is doing.
// (Replaces the over-dense left session rail — shells stay the hero, tabs switch.)
let conversationSignature = '';
function formatConversationSummary(text) {
    // Light formatting: keep full text (no truncation), escape HTML, preserve paragraphs.
    const escaped = escapeHtml(text.trim());
    if (!escaped)
        return '';
    return escaped
        .split(/\n{2,}/)
        .map((block) => `<p class="conversation-para">${block.replace(/\n/g, '<br>')}</p>`)
        .join('');
}
function conversationSessionRows() {
    // Honor hide/remove of offline sessions (hiddenClosedShells), same as the old tabs.
    const model = typeof visibleSessions === 'function' ? visibleSessions(sessions()) : sessions();
    if (!model.length) {
        return '<p class="muted conversation-empty">No sessions yet. Start one with New tmux or restore hidden sessions.</p>';
    }
    // Pinned agents first when pins exist; otherwise natural order.
    const ordered = typeof orderSessionsByPins === 'function'
        ? orderSessionsByPins(model, pinnedSessionNames())
        : model;
    const offlineCount = ordered.filter((s) => !s.running).length;
    const bulk = offlineCount > 1
        ? `<div class="conversation-bulk"><button type="button" class="warn conversation-bulk-btn" data-remove-all-offline title="Hide every offline session from this list">${icon('trash')}<span>Hide ${offlineCount} offline</span></button></div>`
        : '';
    const rows = ordered.map((session) => {
        const state = sessionRuntime(session);
        const label = sessionTabLabel(session);
        const work = sessionWorkTitle(session.name) || shellbarSummary(session.name);
        const pinned = isSessionPinned(session.name, pinnedSessionNames());
        const unread = typeof isSessionUnread === 'function' && isSessionUnread(session.name);
        const title = label || session.name;
        const workLine = work && work !== title ? work : '';
        const n = escapeHtml(session.name);
        // Offline rows need Start / Remove on the card — selecting alone felt useless.
        const rowActions = !session.running
            ? `<div class="conversation-row-actions">
          ${session.family === 'custom' || !shellUnlocked ? '' : `<button type="button" class="primary conversation-row-btn" data-start="${n}" title="Start this offline session">${icon('plus')}<span>Start</span></button>`}
          <button type="button" class="warn conversation-row-btn" data-remove-closed="${n}" title="Hide offline session">${icon('trash')}<span>Remove</span></button>
        </div>`
            : '';
        return `<li class="conversation-session ${state.className}${session.name === selectedSession ? ' selected' : ''}${unread ? ' unread' : ''}" data-select-session="${escapeHtml(session.name)}">
      <button type="button" class="conversation-session-btn" data-select-session="${escapeHtml(session.name)}" title="${escapeHtml(title)}">
        <span class="conversation-session-top">
          <span class="badge">${escapeHtml(session.badge)}</span>
          <i class="dot ${state.dotClass}" aria-hidden="true"></i>
          <b class="conversation-session-name">${escapeHtml(title)}</b>
          ${pinned ? '<span class="conversation-pin-mark" title="Pinned">▾</span>' : ''}
          <span class="conversation-session-state">${escapeHtml(state.label)}</span>
        </span>
        ${workLine ? `<span class="conversation-session-work">${escapeHtml(workLine)}</span>` : `<span class="conversation-session-work muted">${session.running ? 'No summary yet' : 'Offline — Start or Remove'}</span>`}
      </button>
      <div class="conversation-session-side">
        ${rowActions}
        <button type="button" class="conversation-pin${pinned ? ' active' : ''}" data-pin-session="${escapeHtml(session.name)}" title="${pinned ? 'Unpin' : 'Pin'}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${escapeHtml(title)}">${icon('pin')}</button>
      </div>
    </li>`;
    }).join('');
    return bulk + `<ul class="conversation-sessions" role="list">${rows}</ul>`;
}
function renderConversationPanel() {
    const body = document.getElementById('conversationBody');
    if (!body)
        return;
    const summary = (latestSummaryText || '').trim();
    const loading = summaryLoading;
    const vis = typeof visibleSessions === 'function' ? visibleSessions(sessions()) : sessions();
    const sig = `${selectedSession}|${loading ? 1 : 0}|${shellUnlocked ? 1 : 0}|${hiddenClosedShellCount()}|${pinnedSessionNames().join(',')}|${summary}|` + vis.map((s) => {
        const st = sessionRuntime(s);
        return `${s.name}:${st.label}:${sessionWorkTitle(s.name)}`;
    }).join('|');
    if (sig === conversationSignature)
        return;
    conversationSignature = sig;
    const restore = hiddenClosedShellCount()
        ? `<button type="button" class="conversation-restore" id="restoreHiddenSessions" data-restore-hidden-closed>Show ${hiddenClosedShellCount()} hidden session${hiddenClosedShellCount() === 1 ? '' : 's'}</button>`
        : '<button type="button" class="conversation-restore" id="restoreHiddenSessions" data-restore-hidden-closed hidden></button>';
    if (!shellUnlocked) {
        body.innerHTML = '<p class="muted conversation-empty">Unlock shells to load a live summary of what each session is doing.</p>' + restore + conversationSessionRows();
        return;
    }
    const head = loading && !summary
        ? '<p class="muted conversation-empty conversation-loading">Summarising current work…</p>'
        : summary
            ? `<div class="conversation-summary">${formatConversationSummary(summary)}</div>`
            : '<p class="muted conversation-empty">No conversation summary yet. Click Refresh, or wait for the next auto pass.</p>';
    body.innerHTML = head + restore + conversationSessionRows();
}
function orderedVisibleSessions() {
    return orderSessionsByPins(sessions(), pinnedSessionNames());
}
// Keep the old name as a thin alias so existing call sites still work.
function renderSessionRail() {
    if (typeof runAutoPinForSessions === 'function') {
        runAutoPinForSessions(currentModel.sessions || []);
    }
    renderConversationPanel();
}
function invalidateSessionRail() {
    conversationSignature = '';
}
function markSessionRailSelected() {
    document.querySelectorAll('.conversation-session').forEach((item) => {
        const name = item.querySelector('[data-select-session]')?.dataset.selectSession || '';
        item.classList.toggle('selected', name === selectedSession);
    });
}
// No-op stubs for removed mobile drawer / rail open APIs (safe if something still calls them).
function setSessionRailOpen(_open) { }
function toggleSessionRailOpen() { }
function applySessionRailOpen() { }
function maybeOpenMobileRailOnBoot() { }
