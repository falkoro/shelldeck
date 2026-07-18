// Left session rail: app-style vertical list with pinned sessions first.

let sessionRailSignature = '';
let sessionRailOpen = false;

function familyRailGlyph(family: string, badge: string): string {
  const key = (family || '').toLowerCase();
  const name = (badge || '').toLowerCase();
  // Known agent badges / families get a small glyph; others keep the text badge.
  if (key === 'agent' || name === 'cx' || name === 'cd') return icon('bot');
  if (name === 'cl' || name === 'cc') return icon('bot');
  if (name === 'gx' || name === 'ge' || name === 'qw' || name === 'oc' || name === 'ai' || name === 'go' || name === 'if') {
    return icon('bot');
  }
  if (key === 'shell') return icon('terminal');
  if (key === 'custom') return icon('terminal');
  return '';
}

function renderSessionRailItem(session: SessionItem): string {
  const state = sessionRuntime(session);
  const pinned = isSessionPinned(session.name, pinnedSessionNames());
  const labelText = sessionTabLabel(session);
  const workBrief = shellbarSummary(session.name);
  const titleText = labelText || workBrief || session.name;
  const summaryText = labelText && workBrief && workBrief !== labelText ? workBrief : '';
  const glyph = familyRailGlyph(session.family, session.badge);
  const badgeInner = glyph || escapeHtml(session.badge);
  const pinTitle = pinned ? 'Unpin session' : 'Pin session';
  const pinLabel = pinned ? 'Unpin' : 'Pin';
  return `<div class="session-rail-item ${escapeHtml(session.family)} ${state.className}${pinned ? ' pinned' : ''}${session.name === selectedSession ? ' selected' : ''}" data-select-session="${escapeHtml(session.name)}" data-session-rail-item="${escapeHtml(session.name)}" role="listitem"><button type="button" class="session-rail-select" data-select-session="${escapeHtml(session.name)}" title="${escapeHtml(titleText)}"><span class="badge session-rail-badge">${badgeInner}</span><i class="dot ${state.dotClass}" aria-hidden="true"></i><span class="session-rail-body"><span class="session-rail-label">${escapeHtml(titleText)}</span>${summaryText ? `<span class="session-rail-summary">${escapeHtml(summaryText)}</span>` : ''}</span></button><button type="button" class="session-rail-pin${pinned ? ' active' : ''}" data-pin-session="${escapeHtml(session.name)}" title="${pinTitle}" aria-label="${pinLabel} ${escapeHtml(titleText)}" aria-pressed="${pinned ? 'true' : 'false'}">${icon('pin')}</button></div>`;
}

function orderedVisibleSessions(): SessionItem[] {
  return orderSessionsByPins(sessions(), pinnedSessionNames());
}

function renderSessionRail(): void {
  const rail = document.getElementById('sessionRail');
  if (!rail) return;
  const modelSessions = orderedVisibleSessions();
  const hiddenCount = hiddenClosedShellCount();
  const signature = `${hiddenCount}|${selectedSession}|${pinnedSessionNames().join(',')}|` + modelSessions.map((session) => {
    const state = sessionRuntime(session);
    return `${session.name}:${session.label}:${session.running ? 1 : 0}:${session.attached}:${session.activity || 0}:${state.label}:${shellbarSummary(session.name)}`;
  }).join('|');
  if (signature === sessionRailSignature) {
    markSessionRailSelected();
    return;
  }
  sessionRailSignature = signature;

  const pinned = modelSessions.filter((session) => isSessionPinned(session.name, pinnedSessionNames()));
  const unpinned = modelSessions.filter((session) => !isSessionPinned(session.name, pinnedSessionNames()));

  const restore = hiddenCount
    ? `<button type="button" class="session-rail-restore" data-restore-hidden-closed title="Show ${hiddenCount} terminated session${hiddenCount === 1 ? '' : 's'} again">${icon('plus')}<span>Show terminated (${hiddenCount})</span></button>`
    : '';

  const pinnedBlock = pinned.length
    ? `<div class="session-rail-group" data-rail-group="pinned"><div class="session-rail-group-label">Pinned</div><div class="session-rail-list" role="list">${pinned.map(renderSessionRailItem).join('')}</div></div>`
    : '';
  const unpinnedLabel = pinned.length ? 'Sessions' : 'Sessions';
  const unpinnedBlock = `<div class="session-rail-group" data-rail-group="sessions"><div class="session-rail-group-label">${unpinnedLabel}</div><div class="session-rail-list" role="list">${unpinned.map(renderSessionRailItem).join('') || '<div class="session-rail-empty muted">No sessions</div>'}</div></div>`;

  rail.innerHTML = pinnedBlock + unpinnedBlock + restore;
  markSessionRailSelected();
  applySessionRailOpen();
}

function markSessionRailSelected(): void {
  document.querySelectorAll<HTMLElement>('[data-session-rail-item]').forEach((item) => {
    item.classList.toggle('selected', item.dataset.sessionRailItem === selectedSession);
  });
}

function applySessionRailOpen(): void {
  document.body.classList.toggle('session-rail-open', sessionRailOpen);
  const openBtn = document.getElementById('sessionRailOpenBtn');
  if (openBtn) {
    openBtn.setAttribute('aria-expanded', sessionRailOpen ? 'true' : 'false');
    openBtn.title = sessionRailOpen ? 'Close sessions list' : 'Open sessions list';
  }
  const closeBtn = document.getElementById('sessionNavClose');
  if (closeBtn) closeBtn.hidden = window.innerWidth > 760;
}

function setSessionRailOpen(open: boolean): void {
  sessionRailOpen = open;
  applySessionRailOpen();
}

function toggleSessionRailOpen(): void {
  setSessionRailOpen(!sessionRailOpen);
}

function invalidateSessionRail(): void {
  sessionRailSignature = '';
}
