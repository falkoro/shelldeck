// Sidebar conversation panel: live summary of what each shell is doing.
// (Replaces the over-dense left session rail — shells stay the hero, tabs switch.)

let conversationSignature = '';

function formatConversationSummary(text: string): string {
  // Light formatting: keep full text (no truncation), escape HTML, preserve paragraphs.
  const escaped = escapeHtml(text.trim());
  if (!escaped) return '';
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p class="conversation-para">${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function conversationSessionRows(): string {
  const model = sessions();
  if (!model.length) {
    return '<p class="muted conversation-empty">No sessions yet.</p>';
  }
  // Pinned agents first when pins exist; otherwise natural order.
  const ordered = typeof orderSessionsByPins === 'function'
    ? orderSessionsByPins(model, pinnedSessionNames())
    : model;
  return `<ul class="conversation-sessions" role="list">${ordered.map((session) => {
    const state = sessionRuntime(session);
    const label = sessionTabLabel(session);
    const work = sessionWorkTitle(session.name) || shellbarSummary(session.name);
    const pinned = isSessionPinned(session.name, pinnedSessionNames());
    const unread = typeof isSessionUnread === 'function' && isSessionUnread(session.name);
    const title = label || session.name;
    const workLine = work && work !== title ? work : '';
    return `<li class="conversation-session ${state.className}${session.name === selectedSession ? ' selected' : ''}${unread ? ' unread' : ''}" data-select-session="${escapeHtml(session.name)}">
      <button type="button" class="conversation-session-btn" data-select-session="${escapeHtml(session.name)}" title="${escapeHtml(title)}">
        <span class="conversation-session-top">
          <span class="badge">${escapeHtml(session.badge)}</span>
          <i class="dot ${state.dotClass}" aria-hidden="true"></i>
          <b class="conversation-session-name">${escapeHtml(title)}</b>
          ${pinned ? '<span class="conversation-pin-mark" title="Pinned">▾</span>' : ''}
          <span class="conversation-session-state">${escapeHtml(state.label)}</span>
        </span>
        ${workLine ? `<span class="conversation-session-work">${escapeHtml(workLine)}</span>` : '<span class="conversation-session-work muted">No summary yet</span>'}
      </button>
      <button type="button" class="conversation-pin${pinned ? ' active' : ''}" data-pin-session="${escapeHtml(session.name)}" title="${pinned ? 'Unpin' : 'Pin'}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${escapeHtml(title)}">${icon('pin')}</button>
    </li>`;
  }).join('')}</ul>`;
}

function renderConversationPanel(): void {
  const body = document.getElementById('conversationBody');
  if (!body) return;
  const summary = (latestSummaryText || '').trim();
  const loading = summaryLoading;
  const sig = `${selectedSession}|${loading ? 1 : 0}|${shellUnlocked ? 1 : 0}|${pinnedSessionNames().join(',')}|${summary}|` + sessions().map((s) => {
    const st = sessionRuntime(s);
    return `${s.name}:${st.label}:${sessionWorkTitle(s.name)}`;
  }).join('|');
  if (sig === conversationSignature) return;
  conversationSignature = sig;

  if (!shellUnlocked) {
    body.innerHTML = '<p class="muted conversation-empty">Unlock shells to load a live summary of what each session is doing.</p>' + conversationSessionRows();
    return;
  }

  const head = loading && !summary
    ? '<p class="muted conversation-empty conversation-loading">Summarising current work…</p>'
    : summary
      ? `<div class="conversation-summary">${formatConversationSummary(summary)}</div>`
      : '<p class="muted conversation-empty">No conversation summary yet. Click Refresh, or wait for the next auto pass.</p>';

  body.innerHTML = head + conversationSessionRows();
}

function orderedVisibleSessions(): SessionItem[] {
  return orderSessionsByPins(sessions(), pinnedSessionNames());
}

// Keep the old name as a thin alias so existing call sites still work.
function renderSessionRail(): void {
  if (typeof runAutoPinForSessions === 'function') {
    runAutoPinForSessions(currentModel.sessions || []);
  }
  renderConversationPanel();
}

function invalidateSessionRail(): void {
  conversationSignature = '';
}

function markSessionRailSelected(): void {
  document.querySelectorAll<HTMLElement>('.conversation-session').forEach((item) => {
    const name = item.querySelector<HTMLElement>('[data-select-session]')?.dataset.selectSession || '';
    item.classList.toggle('selected', name === selectedSession);
  });
}

// No-op stubs for removed mobile drawer / rail open APIs (safe if something still calls them).
function setSessionRailOpen(_open: boolean): void { /* removed */ }
function toggleSessionRailOpen(): void { /* removed */ }
function applySessionRailOpen(): void { /* removed */ }
function maybeOpenMobileRailOnBoot(): void { /* removed */ }
