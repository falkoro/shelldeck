function renderShells(payload: { shells?: ShellPreview[]; fromCache?: boolean }): void {
  // Live-center layout: keep shell model data for status/summaries, but do not paint preview cards.
  // The main surface is the docked live tmux terminal for the selected session.
  latestShells = payload.shells || [];
  if (latestShells.length && !payload.fromCache) saveShellPreviewCache(latestShells);
  const grid = document.getElementById('shells');
  if (grid) {
    grid.innerHTML = '';
    grid.hidden = true;
    grid.setAttribute('aria-hidden', 'true');
  }
  const visibleShells = visibleShellPreviews(latestShells);
  markSelectedShell();
  renderShellTabs();
  if (typeof noteUnreadFromShells === 'function') noteUnreadFromShells(visibleShells);
  if (typeof renderSessionRail === 'function') renderSessionRail();
  updateUnlockState();
  // Keep the selected session's live terminal open only while it is still running.
  if (selectedSession && shellUnlocked && typeof openTerminal === 'function' && targetReady(selectedSession)) {
    openTerminal(selectedSession);
  } else if (selectedSession && typeof showLiveStageIdle === 'function') {
    showLiveStageIdle(selectedSession);
  }
}

function applyShellCardOrder(grid: HTMLElement, ordered: ShellPreview[]): void {
  // Re-appending a card moves its DOM subtree, which blurs a focused composer textarea inside it
  // (the cursor "jumps away" mid-type on every ~1.2s refresh). Only touch the DOM when the order
  // actually changed (e.g. a drag-reorder) — a no-op when it already matches keeps focus intact.
  const current = Array.from(grid.querySelectorAll<HTMLElement>('[data-shell-card]'))
    .map((card) => card.dataset.shellCard || '');
  const desired = ordered
    .map((shell) => shell.name)
    .filter((name) => current.includes(name));
  if (current.join(' ') === desired.join(' ')) return;
  ordered.forEach((shell) => {
    const card = grid.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(shell.name)}"]`);
    if (card) grid.appendChild(card);
  });
}

function visibleShellCardCount(grid: HTMLElement): number {
  return Array.from(grid.querySelectorAll<HTMLElement>('[data-shell-card]'))
    .filter((card) => getComputedStyle(card).display !== 'none').length;
}

function shellGridColumnCount(visibleCount: number, gridWidth: number): number {
  if (viewMode === 'focus' || visibleCount <= 1) return 1;
  const minColWidth = 300;
  const maxCols = Math.max(1, Math.floor(gridWidth / minColWidth));
  return Math.min(visibleCount, maxCols);
}

let shellGridFitFrame = 0;

function scheduleShellGridFit(): void {
  if (shellGridFitFrame) cancelAnimationFrame(shellGridFitFrame);
  shellGridFitFrame = requestAnimationFrame(() => {
    shellGridFitFrame = 0;
    updateShellGridViewportFit();
  });
}

// On wide screens (≥1500px) the Shells toolbar is absolutely positioned over the tip/tab
// rows. Reserve its real measured width via a CSS var — the old hardcoded min(34vw,520px)
// was often narrower than the toolbar, so buttons overlapped the tab bar and clipped tab text.
function updateShellToolbarReserve(): void {
  const panel = document.getElementById('shellSection');
  if (!panel) return;
  if (window.innerWidth < 1500) {
    panel.style.removeProperty('--shell-toolbar-reserve');
    return;
  }
  const tools = panel.querySelector<HTMLElement>('.panel-header .shell-tools');
  if (!tools) return;
  const width = Math.ceil(Math.max(tools.scrollWidth, tools.getBoundingClientRect().width));
  if (width > 0) panel.style.setProperty('--shell-toolbar-reserve', `${width + 16}px`);
}

function updateShellGridViewportFit(): void {
  updateShellToolbarReserve();
  const grid = document.getElementById('shells');
  if (!grid) return;
  grid.classList.toggle('grid-mode', viewMode === 'grid');
  if (window.innerWidth <= 760) {
    grid.style.removeProperty('--shell-card-min-height');
    grid.style.removeProperty('--shell-grid-viewport-height');
    grid.style.removeProperty('--shell-grid-columns');
    return;
  }
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-shell-card]'))
    .filter((card) => getComputedStyle(card).display !== 'none');
  if (!cards.length) return;
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
  if (tipBar) tipBar.classList.toggle('layout-hint-active', viewMode === 'grid' && visibleCount > 1);
}

window.addEventListener('resize', scheduleShellGridFit);

function markSelectedShell(): void {
  document.querySelectorAll<HTMLElement>('.terminal-card,.session-tab').forEach((item) => {
    const name = item.dataset.selectSession || item.dataset.shellCard || item.dataset.shellTab || '';
    item.classList.toggle('selected', name === selectedSession);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-shell-tab]').forEach((item) => {
    item.classList.toggle('selected', item.dataset.shellTab === selectedSession);
  });
  if (typeof markSessionRailSelected === 'function') markSessionRailSelected();
  const cards = document.querySelectorAll<HTMLElement>('[data-shell-card]');
  // Focus mode hides every non-selected card; if the selection points at a session
  // with no pane card, fall back to the first card so the panel never goes blank.
  if (cards.length && !document.querySelector('.terminal-card.selected')) {
    cards[0].classList.add('selected');
  }
  document.getElementById('shells')?.classList.toggle('focus-mode', viewMode === 'focus');
}

function setShellAgentBadge(card: HTMLElement, name: string): void {
  const shell = latestShells.find((s) => s.name === name);
  const status = shell && shell.running ? (shellWorking(name) ? 'active' : 'waiting') : '';
  const badge = card.querySelector<HTMLElement>('[data-role="agent"]');
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

function setWorkTitle(card: HTMLElement, name: string): void {
  const el = card.querySelector<HTMLElement>('[data-role="worktitle"]');
  if (!el) return;
  const title = shellboxSummary(name);
  if (title) {
    renderWorkTitle(el, title);
  } else if (summaryLoading && !latestSummaryText) {
    // first summary still loading — show a placeholder rather than nothing
    el.textContent = 'Summarising current work…';
    el.className = 'work-title show loading';
    delete el.dataset.renderedTitle;
  } else {
    el.className = 'work-title';
    el.textContent = '';
    delete el.dataset.renderedTitle;
  }
}

function renderWorkTitle(el: HTMLElement, title: string): void {
  const signature = title;
  el.className = 'work-title show';
  el.title = title;
  if (el.dataset.renderedTitle === signature) return;
  el.dataset.renderedTitle = signature;
  el.textContent = title;
}

// Refresh per-slot work titles on all cards (used when a fresh summary arrives).
function applyWorkTitles(): void {
  document.querySelectorAll<HTMLElement>('[data-shell-card]').forEach((card) => {
    const name = card.dataset.shellCard || '';
    const shell = shellPreviewByName(name);
    if (shell) updateShellCardTitle(card, shell);
    setWorkTitle(card, name);
  });
  renderShellTabs();
}

function renderShellImages(name: string): void {
  const card = document.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(name)}"]`);
  const list = card?.querySelector<HTMLElement>('[data-role="attachments"]');
  if (!list) return;
  list.innerHTML = (shellImages[name] || []).map((image) => `<div class="attach-chip"><img src="${escapeHtml(image.url)}" alt=""><code>${escapeHtml(image.path)}</code><button type="button" data-remove-image="${escapeHtml(image.path)}" data-shell="${escapeHtml(name)}">Remove</button></div>`).join('');
}

function render(model: DashboardModel, options: RenderOptions = {}): void {
  currentModel = model;
  shellUnlocked = Boolean(model.unlocked) || Boolean(options.preserveUnlock && shellUnlocked);
  syncDashboardTitle(model.hostname || '');
  chooseSession(false);
  renderShellTabs();
  renderSelectedSessionActions();
  syncTargetUi();
  applyPrefs();
}

async function refresh(options: RenderOptions = {}): Promise<void> {
  const response = await fetch('/api/sessions', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Refresh failed');
  render(await response.json() as DashboardModel, options);
}
