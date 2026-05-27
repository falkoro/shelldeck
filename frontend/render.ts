function renderBasicMarkdown(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

function createShellCard(shell: ShellPreview): HTMLElement {
  const article = document.createElement('article');
  article.dataset.shellCard = shell.name;
  article.dataset.selectSession = shell.name;
  article.innerHTML = `<header>
    <div><b data-role="label"></b><span data-role="command"></span></div>
    <div class="terminal-meta"><span class="agent-badge" data-role="agent"></span><span class="dot" data-role="dot"></span><span data-role="cwd"></span></div>
  </header>
  <div class="work-title" data-role="worktitle"></div>
  <div class="shell-composer">
    <textarea spellcheck="false" data-command placeholder="Type for this shell. Enter sends on mobile; Ctrl+Enter on desktop."></textarea>
    <div class="shell-actions">
      <button class="primary" type="button" data-send-shell title="Type the text and press Enter in the shell">${icon('send')}<span>Send</span></button>
      <button type="button" data-paste-shell title="Insert the text without pressing Enter">${icon('paste')}<span>Paste</span></button>
      <button type="button" data-add-image title="Attach an image; inserts its saved path">${icon('image')}<span>Image</span></button>
      <button type="button" data-history title="Cycle previous inputs (or ↑ / ↓ in the box)">${icon('clock')}<span>History</span></button>
      <button type="button" data-key="enter" title="Press Enter in the shell">${icon('enter')}<span>Enter</span></button>
      <button class="warn" type="button" data-key="interrupt" title="Interrupt the running command (Ctrl-C)">${icon('stop')}<span>Ctrl-C</span></button>
      <button type="button" data-key="clear" title="Clear the shell screen">${icon('eraser')}<span>Clear</span></button>
      <button type="button" data-copy-output title="Copy the pane output">${icon('copy')}<span>Copy</span></button>
      <button type="button" data-clear-preview title="Clear this preview locally (not the shell)">${icon('eyeoff')}<span>Clear view</span></button>
      <button type="button" data-shellin title="Open a live interactive terminal in this session">${icon('terminal')}<span>Shell in</span></button>
      <button class="warn resume-btn" type="button" data-resume title="Re-run the agent's resume command shown in the pane">${icon('restart')}<span>Resume</span></button>
    </div>
    <div class="attach-list" data-role="attachments"></div>
    <div class="shell-status" data-role="status">Paste or drop an image into this input to insert its saved path.</div>
  </div>
  <pre data-role="output"></pre>`;
  article.querySelector<HTMLTextAreaElement>('[data-command]')!.dataset.command = shell.name;
  article.querySelector<HTMLButtonElement>('[data-send-shell]')!.dataset.sendShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-paste-shell]')!.dataset.pasteShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-add-image]')!.dataset.addImage = shell.name;
  article.querySelector<HTMLButtonElement>('[data-history]')!.dataset.history = shell.name;
  article.querySelector<HTMLButtonElement>('[data-copy-output]')!.dataset.copyOutput = shell.name;
  article.querySelector<HTMLButtonElement>('[data-clear-preview]')!.dataset.clearPreview = shell.name;
  article.querySelector<HTMLButtonElement>('[data-shellin]')!.dataset.shellin = shell.name;
  article.querySelector<HTMLButtonElement>('[data-resume]')!.dataset.resume = shell.name;
  article.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
    button.dataset.shell = shell.name;
  });
  return article;
}

function updateShellCard(card: HTMLElement, shell: ShellPreview): void {
  card.className = `terminal-card ${shell.running ? 'running' : 'offline'}${shell.name === selectedSession ? ' selected' : ''}`;
  setText(card, '[data-role="label"]', shell.label);
  setText(card, '[data-role="command"]', `${shell.name} / ${shell.command || 'offline'}`);
  setText(card, '[data-role="cwd"]', shell.cwd || '');
  card.querySelector('[data-role="dot"]')!.className = `dot ${shell.running ? 'on' : ''}`;
  noteShellActivity(shell.name, shell.output);
  setShellAgentBadge(card, shell.name);
  setWorkTitle(card, shell.name);
  // Surface a one-click recovery when an agent has exited and printed a resume command
  // (e.g. Codex: "To continue this session, run codex resume <id>").
  const resumeBtn = card.querySelector<HTMLButtonElement>('[data-resume]');
  if (resumeBtn) {
    const m = shell.output.match(/\bcodex resume [A-Za-z0-9-]{8,}/i);
    if (m) {
      resumeBtn.dataset.resumeCmd = m[0];
      resumeBtn.classList.add('show');
    } else {
      delete resumeBtn.dataset.resumeCmd;
      resumeBtn.classList.remove('show');
    }
  }
  let output = shell.output || (shell.running ? 'No output captured yet.' : 'Session is offline.');
  if (clearedOutputs[shell.name] && clearedOutputs[shell.name] === shell.output) output = '';
  if (clearedOutputs[shell.name] && clearedOutputs[shell.name] !== shell.output) delete clearedOutputs[shell.name];
  const pre = card.querySelector<HTMLElement>('[data-role="output"]')!;
  // Only auto-follow when the viewer is already at the bottom, so scrolling up to read
  // older output isn't yanked back down on every 1.2s stream tick.
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48;
  setText(card, '[data-role="output"]', output);
  const input = card.querySelector<HTMLTextAreaElement>('[data-command]')!;
  input.placeholder = shell.running ? `Input for ${shell.label}` : 'Start this session before sending input';
  if (followOutput && atBottom) pre.scrollTop = pre.scrollHeight;
  renderShellImages(shell.name);
}

function setText(parent: HTMLElement, selector: string, text: string): void {
  const element = parent.querySelector(selector);
  if (element && element.textContent !== text) element.textContent = text;
}

function renderShells(payload: { shells?: ShellPreview[] }): void {
  const grid = q('#shells');
  latestShells = payload.shells || [];
  if (!latestShells.length) {
    grid.innerHTML = '<div class="locked-note">No tmux panes were returned yet. Try starting a shell slot.</div>';
    updateUnlockState();
    return;
  }
  grid.querySelectorAll(':scope > .locked-note, :scope > .unlock-cta').forEach((note) => note.remove());
  const seen = new Set<string>();
  latestShells.forEach((shell) => {
    seen.add(shell.name);
    let card = grid.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(shell.name)}"]`);
    if (!card) {
      // Only append freshly created cards. Re-appending an existing card is a DOM
      // move that blurs any focused textarea inside it, which on every 1.2s stream
      // tick yanked the cursor out of the composer (and let Space scroll the page).
      card = createShellCard(shell);
      grid.appendChild(card);
    }
    updateShellCard(card, shell);
  });
  grid.querySelectorAll<HTMLElement>('[data-shell-card]').forEach((card) => {
    if (!seen.has(card.dataset.shellCard || '')) card.remove();
  });
  markSelectedShell();
  renderShellTabs();
  updateUnlockState();
}

function markSelectedShell(): void {
  document.querySelectorAll<HTMLElement>('.terminal-card,.session-item').forEach((item) => {
    item.classList.toggle('selected', item.dataset.selectSession === selectedSession);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-shell-tab]').forEach((item) => {
    item.classList.toggle('selected', item.dataset.shellTab === selectedSession);
  });
  const cards = document.querySelectorAll<HTMLElement>('[data-shell-card]');
  // Focus mode hides every non-selected card; if the selection points at a session
  // with no pane card, fall back to the first card so the panel never goes blank.
  if (cards.length && !document.querySelector('.terminal-card.selected')) {
    cards[0].classList.add('selected');
  }
  q('#shells').classList.toggle('focus-mode', viewMode === 'focus');
}

function renderSessionList(): void {
  const selected = selectedSessionModel() || sessions()[0] || null;
  const detail = selected ? sessionDetail(selected) : '';
  q('#sessions').innerHTML = `<div class="session-rail">${sessions().map((session) => {
    const status = session.running ? (session.attached ? 'attached' : 'running') : 'offline';
    return `<button type="button" class="session-item ${escapeHtml(session.family)}${session.name === selectedSession ? ' selected' : ''}" data-select-session="${escapeHtml(session.name)}"><span class="badge">${escapeHtml(session.badge)}</span><span><b>${escapeHtml(session.label)}</b><small><i class="dot ${session.running ? 'on' : ''}"></i>${escapeHtml(status)}</small></span></button>`;
  }).join('')}</div>${detail}`;
}

function sessionDetail(session: SessionItem): string {
  const startDisabled = session.running || session.family === 'custom' || !shellUnlocked ? 'disabled' : '';
  const restartDisabled = session.family === 'custom' || !shellUnlocked ? 'disabled' : '';
  return `<div class="session-detail"><b>${escapeHtml(session.label)}</b><span>${escapeHtml(session.name)} · ${escapeHtml(fmtTime(session.activity))}</span><code>${escapeHtml(session.command)}</code><div class="card-actions"><button type="button" ${startDisabled} data-start="${escapeHtml(session.name)}">${icon('play')}<span>Start</span></button><button class="warn" type="button" ${restartDisabled} data-restart="${escapeHtml(session.name)}">${icon('restart')}<span>Restart</span></button><button type="button" data-copy="${escapeHtml(session.command)}">${icon('copy')}<span>Copy</span></button></div></div>`;
}

let shellTabsSignature = '';

function renderShellTabs(): void {
  const signature = latestShells.map((shell) => `${shell.name}:${shell.label}:${shell.running ? 1 : 0}`).join('|');
  if (signature === shellTabsSignature) return;
  shellTabsSignature = signature;
  q('#shellTabs').innerHTML = latestShells.map((shell) => `<button type="button" data-shell-tab="${escapeHtml(shell.name)}"><span class="dot ${shell.running ? 'on' : ''}"></span>${escapeHtml(shell.label)}</button>`).join('');
  markSelectedShell();
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
  }
  card.classList.toggle('agent-waiting', status === 'waiting');
}

// Refresh agent badges on all shell cards without a full shell re-render (used on agent poll).
function applyAgentBadges(): void {
  document.querySelectorAll<HTMLElement>('[data-shell-card]').forEach((card) => setShellAgentBadge(card, card.dataset.shellCard || ''));
}

function setWorkTitle(card: HTMLElement, name: string): void {
  const el = card.querySelector<HTMLElement>('[data-role="worktitle"]');
  if (!el) return;
  const title = sessionWorkTitle(name);
  if (title) {
    el.textContent = title;
    el.className = 'work-title show';
  } else if (summaryLoading && !latestSummaryText) {
    // first summary still loading — show a placeholder rather than nothing
    el.textContent = 'Summarising current work…';
    el.className = 'work-title show loading';
  } else {
    el.className = 'work-title';
  }
}

// Refresh per-slot work titles on all cards (used when a fresh summary arrives).
function applyWorkTitles(): void {
  document.querySelectorAll<HTMLElement>('[data-shell-card]').forEach((card) => setWorkTitle(card, card.dataset.shellCard || ''));
}

// One-time collapsible legend explaining the composer buttons + status dots, inserted
// under the shell tabs (the icons alone are otherwise easy to mix up).
function buildLegend(): void {
  if (document.getElementById('legend')) return;
  const tabs = document.getElementById('shellTabs');
  if (!tabs) return;
  const items: Array<[string, string, string]> = [
    ['send', 'Send', 'Type the text and press Enter in the shell'],
    ['paste', 'Paste', 'Insert the text without pressing Enter'],
    ['image', 'Image', 'Attach an image; inserts its saved path'],
    ['clock', 'History', 'Cycle previous inputs (or ↑ / ↓ in the box)'],
    ['enter', 'Enter', 'Press Enter in the shell'],
    ['stop', 'Ctrl-C', 'Interrupt the running command'],
    ['eraser', 'Clear', 'Clear the shell screen'],
    ['copy', 'Copy', 'Copy the pane output'],
    ['eyeoff', 'Clear view', 'Clear this preview locally (not the shell)'],
  ];
  const rows = items.map(([ic, name, desc]) => `<div class="legend-row">${icon(ic)}<b>${name}</b><span>${escapeHtml(desc)}</span></div>`).join('');
  const status = `<div class="legend-row"><span class="dot on"></span><b>running</b><span>agent is working</span></div><div class="legend-row"><span class="dot wait"></span><b>waiting</b><span>agent is waiting for your input</span></div>`;
  const details = document.createElement('details');
  details.id = 'legend';
  details.className = 'legend';
  details.innerHTML = `<summary>Button legend</summary><div class="legend-grid">${rows}${status}</div>`;
  tabs.insertAdjacentElement('afterend', details);
}

interface Ticker { symbol: string; price: number; changePct: number; currency: string }

function renderTickers(list: Ticker[]): void {
  const bar = document.getElementById('tickerBar');
  if (!bar) return;
  if (!list.length) { bar.innerHTML = ''; bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = list.map((t) => {
    const up = t.changePct >= 0;
    const price = t.price >= 1000 ? Math.round(t.price).toLocaleString() : t.price.toFixed(2);
    return `<span class="tick ${up ? 'up' : 'down'}"><b>${escapeHtml(t.symbol)}</b> ${price} <i>${up ? '▲' : '▼'}${Math.abs(t.changePct).toFixed(2)}%</i></span>`;
  }).join('');
}

function renderAgents(): void {
  const list = document.getElementById('agentsList');
  const summary = document.getElementById('agentsSummary');
  if (!list || !summary) return;
  if (!shellUnlocked) {
    list.innerHTML = '<div class="agents-empty">Unlock shells to view agent activity.</div>';
    summary.textContent = 'locked';
    return;
  }
  // Session-bound agents take their state from the live pane (reliable); others from agent-office.
  const agentWaiting = (a: Agent): boolean => (a.session ? !shellWorking(a.session) : a.status === 'waiting');
  const running = latestAgents.filter((a) => !agentWaiting(a)).length;
  const waiting = latestAgents.filter((a) => agentWaiting(a)).length;
  summary.textContent = `${running} running · ${waiting} waiting`;
  if (!latestAgents.length) {
    list.innerHTML = '<div class="agents-empty">No agents detected.</div>';
    return;
  }
  // session-bound first, then waiting before active within each group
  const rank = (a: Agent): number => (a.session ? 0 : 2) + (agentWaiting(a) ? 0 : 1);
  const sorted = latestAgents.slice().sort((a, b) => rank(a) - rank(b));
  const prevScroll = list.scrollTop;
  list.innerHTML = sorted.map((agent) => {
    const waitingState = agentWaiting(agent);
    const tag = waitingState ? 'waiting' : 'active';
    const name = agent.provider.charAt(0).toUpperCase() + agent.provider.slice(1);
    return `<div class="agent-row ${tag}"><span class="dot ${waitingState ? 'wait' : 'on'}"></span><div class="agent-main"><b>${escapeHtml(name)}${agent.session ? ` · ${escapeHtml(agent.session)}` : ''}</b><small>${escapeHtml(agent.activity || tag)}</small></div><span class="agent-tag ${tag}">${waitingState ? 'waiting' : 'running'}</span></div>`;
  }).join('');
  list.scrollTop = prevScroll;
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
  q('#updated').textContent = `updated ${new Date(model.now).toLocaleTimeString()}`;
  chooseSession(false);
  renderSessionList();
  renderShellTabs();
  syncTargetUi();
  applyPrefs();
}

async function refresh(options: RenderOptions = {}): Promise<void> {
  const response = await fetch('/api/sessions', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Refresh failed');
  render(await response.json() as DashboardModel, options);
}
