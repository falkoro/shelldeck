// Left session rail: app-style list with pins, family groups, unread, multi-select.

let sessionRailSignature = '';
let sessionRailOpen = false;
let mobileRailBooted = false;

function familyRailGlyph(family: string, badge: string): string {
  const key = (family || '').toLowerCase();
  const name = (badge || '').toLowerCase();
  if (key === 'agent' || name === 'cx' || name === 'cd') return icon('bot');
  if (name === 'cl' || name === 'cc') return icon('bot');
  if (name === 'gx' || name === 'ge' || name === 'qw' || name === 'oc' || name === 'ai' || name === 'go' || name === 'if') {
    return icon('bot');
  }
  if (key === 'shell' || key === 'custom') return icon('terminal');
  return '';
}

function activityMeta(session: SessionItem): { text: string; className: string } {
  const state = sessionRuntime(session);
  if (!session.running) return { text: 'offline', className: 'offline' };
  if (state.className === 'running' && state.label === 'running') {
    return { text: 'busy', className: 'busy' };
  }
  if (state.className === 'waiting') return { text: 'idle', className: 'idle' };
  const timeShort = fmtTime(session.activity).replace(/\s*ago$/, '').replace('just now', 'now').replace('never', '—');
  return { text: timeShort || state.label, className: state.className };
}

function renderSessionRailItem(session: SessionItem, opts?: { draggable?: boolean }): string {
  const state = sessionRuntime(session);
  const pinned = isSessionPinned(session.name, pinnedSessionNames());
  const labelText = sessionTabLabel(session);
  const workBrief = shellbarSummary(session.name);
  const titleText = labelText || workBrief || session.name;
  const summaryText = labelText && workBrief && workBrief !== labelText ? workBrief : '';
  const glyph = familyRailGlyph(session.family, session.badge);
  const color = typeof sessionColor === 'function' ? sessionColor(session.name) : '';
  const badgeInner = glyph || escapeHtml(session.badge);
  const pinTitle = pinned ? 'Unpin session' : 'Pin session';
  const activity = activityMeta(session);
  const unread = typeof isSessionUnread === 'function' && isSessionUnread(session.name);
  const multi = typeof isMultiSelectMode === 'function' && isMultiSelectMode();
  const checked = multi && typeof isMultiSelected === 'function' && isMultiSelected(session.name);
  const drag = opts?.draggable
    ? ` draggable="true" data-pin-drag="${escapeHtml(session.name)}"`
    : '';
  const multiBox = multi
    ? `<label class="session-rail-check"><input type="checkbox" data-multi-select="${escapeHtml(session.name)}" ${checked ? 'checked' : ''} aria-label="Select ${escapeHtml(titleText)}"></label>`
    : '';
  const unreadDot = unread ? '<span class="session-rail-unread" title="New output" aria-label="New output"></span>' : '';
  const colorClass = color ? ` color-${escapeHtml(color)}` : '';
  return `<div class="session-rail-item ${escapeHtml(session.family)} ${state.className}${pinned ? ' pinned' : ''}${session.name === selectedSession ? ' selected' : ''}${unread ? ' unread' : ''}${checked ? ' multi-on' : ''}${colorClass}" data-select-session="${escapeHtml(session.name)}" data-session-rail-item="${escapeHtml(session.name)}" role="listitem"${drag}>${multiBox}<button type="button" class="session-rail-select" data-select-session="${escapeHtml(session.name)}" title="${escapeHtml(titleText)}"><span class="badge session-rail-badge${colorClass}">${badgeInner}</span><i class="dot ${state.dotClass}" aria-hidden="true"></i><span class="session-rail-body"><span class="session-rail-label-row"><span class="session-rail-label">${escapeHtml(titleText)}</span>${unreadDot}<span class="session-rail-activity ${activity.className}">${escapeHtml(activity.text)}</span></span>${summaryText ? `<span class="session-rail-summary">${escapeHtml(summaryText)}</span>` : ''}</span></button><button type="button" class="session-rail-color" data-color-session="${escapeHtml(session.name)}" title="Cycle color tag" aria-label="Color tag for ${escapeHtml(titleText)}"><span class="session-rail-color-swatch"></span></button><button type="button" class="session-rail-pin${pinned ? ' active' : ''}" data-pin-session="${escapeHtml(session.name)}" title="${pinTitle}" aria-label="${pinned ? 'Unpin' : 'Pin'} ${escapeHtml(titleText)}" aria-pressed="${pinned ? 'true' : 'false'}">${icon('pin')}</button></div>`;
}

function orderedVisibleSessions(): SessionItem[] {
  return orderSessionsByPins(sessions(), pinnedSessionNames());
}

function railToolbarHtml(): string {
  const multi = typeof isMultiSelectMode === 'function' && isMultiSelectMode();
  const count = multi && typeof multiSelectedNames === 'function' ? multiSelectedNames().length : 0;
  const bulk = multi && count
    ? `<div class="session-rail-bulk"><button type="button" data-bulk-pin title="Pin selected">Pin</button><button type="button" data-bulk-unpin title="Unpin selected">Unpin</button><button type="button" class="warn" data-bulk-hide title="Hide closed selected">Hide</button><span class="muted">${count} selected</span></div>`
    : '';
  return `<div class="session-rail-toolbar">
    <button type="button" class="ghost session-rail-tool${multi ? ' active' : ''}" data-toggle-multiselect title="Multi-select sessions" aria-pressed="${multi ? 'true' : 'false'}">${icon('grid')}<span>Select</span></button>
    <button type="button" class="ghost session-rail-tool" data-open-palette title="Jump to session (⌘K or /)">${icon('search')}<span>Jump</span></button>
  </div>${bulk}`;
}

function renderSessionRail(): void {
  const rail = document.getElementById('sessionRail');
  if (!rail) return;

  // Auto-pin agents on first appearance.
  if (typeof runAutoPinForSessions === 'function') {
    runAutoPinForSessions(currentModel.sessions || []);
  }

  const pins = pinnedSessionNames();
  const groups = typeof partitionRailGroups === 'function'
    ? partitionRailGroups(sessions(), pins)
    : {
      pinned: sessions().filter((s) => pins.includes(s.name)),
      agents: [] as SessionItem[],
      shells: sessions().filter((s) => !pins.includes(s.name)),
      custom: [] as SessionItem[],
    };

  const modelSessions = orderedVisibleSessions();
  const hiddenCount = hiddenClosedShellCount();
  const multi = typeof isMultiSelectMode === 'function' && isMultiSelectMode();
  const multiSig = multi && typeof multiSelectedNames === 'function' ? multiSelectedNames().join(',') : '';
  const unreadSig = modelSessions.map((s) => (typeof isSessionUnread === 'function' && isSessionUnread(s.name) ? '1' : '0')).join('');
  const colorSig = modelSessions.map((s) => (typeof sessionColor === 'function' ? sessionColor(s.name) : '')).join(',');
  const signature = `${hiddenCount}|${selectedSession}|${pins.join(',')}|${multi}|${multiSig}|${unreadSig}|${colorSig}|` + modelSessions.map((session) => {
    const state = sessionRuntime(session);
    return `${session.name}:${session.label}:${session.running ? 1 : 0}:${session.attached}:${session.activity || 0}:${state.label}:${shellbarSummary(session.name)}`;
  }).join('|');
  if (signature === sessionRailSignature) {
    markSessionRailSelected();
    return;
  }
  sessionRailSignature = signature;

  const groupBlock = (key: string, label: string, items: SessionItem[], draggable: boolean): string => {
    if (!items.length) return '';
    return `<div class="session-rail-group" data-rail-group="${key}"><div class="session-rail-group-label">${label}</div><div class="session-rail-list" role="list">${items.map((s) => renderSessionRailItem(s, { draggable })).join('')}</div></div>`;
  };

  const restore = hiddenCount
    ? `<button type="button" class="session-rail-restore" data-restore-hidden-closed title="Show ${hiddenCount} terminated session${hiddenCount === 1 ? '' : 's'} again">${icon('plus')}<span>Show terminated (${hiddenCount})</span></button>`
    : '';

  const body = [
    groupBlock('pinned', 'Pinned', groups.pinned, true),
    groupBlock('agents', 'Agents', groups.agents, false),
    groupBlock('shells', 'Shells', groups.shells, false),
    groupBlock('custom', 'Custom', groups.custom, false),
  ].join('') || '<div class="session-rail-empty muted">No sessions</div>';

  rail.innerHTML = railToolbarHtml() + body + restore;
  markSessionRailSelected();
  applySessionRailOpen();
  bindPinDrag(rail);
  maybeOpenMobileRailOnBoot();
}

function bindPinDrag(rail: HTMLElement): void {
  let dragName = '';
  rail.querySelectorAll<HTMLElement>('[data-pin-drag]').forEach((el) => {
    el.addEventListener('dragstart', (event) => {
      dragName = el.dataset.pinDrag || '';
      el.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', dragName);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragName = '';
    });
    el.addEventListener('dragover', (event) => {
      event.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('drag-over');
      const target = el.dataset.pinDrag || '';
      const source = dragName || event.dataTransfer?.getData('text/plain') || '';
      if (!source || !target || source === target) return;
      const pins = pinnedSessionNames();
      const toIndex = pins.indexOf(target);
      if (toIndex < 0) return;
      reorderSessionPin(source, toIndex);
      invalidateSessionRail();
      if (typeof invalidateShellTabs === 'function') invalidateShellTabs();
      renderShellTabs();
      renderSessionRail();
    });
  });
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

function maybeOpenMobileRailOnBoot(): void {
  if (mobileRailBooted) return;
  mobileRailBooted = true;
  if (window.innerWidth > 760) return;
  // Land on the session list so phone users pick an app first.
  setSessionRailOpen(true);
}
