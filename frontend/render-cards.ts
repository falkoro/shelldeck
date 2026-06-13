function renderBasicMarkdown(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

const SHELL_OUTPUT_URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const SHELL_OUTPUT_TRAILING_PUNCT_RE = /[),.;:!?]+$/;

function renderLinkedShellOutput(value: string): string {
  let html = '';
  let lastIndex = 0;
  value.replace(SHELL_OUTPUT_URL_RE, (match: string, offset: number) => {
    let url = match;
    let trailing = '';
    const trailingMatch = url.match(SHELL_OUTPUT_TRAILING_PUNCT_RE);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      url = url.slice(0, -trailing.length);
    }
    if (!url) return match;
    html += escapeHtml(value.slice(lastIndex, offset));
    html += `<a class="shell-log-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    html += escapeHtml(trailing);
    lastIndex = offset + match.length;
    return match;
  });
  html += escapeHtml(value.slice(lastIndex));
  return html;
}

function createShellCard(shell: ShellPreview): HTMLElement {
  const article = document.createElement('article');
  article.dataset.shellCard = shell.name;
  article.dataset.selectSession = shell.name;
  article.innerHTML = `<header>
    <div class="card-title"><div class="card-title-row"><span class="card-reorder-handle" title="Drag onto another shell to reorder side-by-side" aria-label="Drag to reorder shells">${icon('grip')}</span><b data-role="label"></b><span class="shell-name-pill"><span data-role="rawname"></span><i class="name-spinner" aria-hidden="true"></i></span><button type="button" class="card-label-edit" data-rename-shell title="Rename this card" aria-label="Rename this card">${icon('edit')}</button><button type="button" class="card-label-reset" data-reset-shell-label title="Reset to auto-generated name" aria-label="Reset to auto-generated name">${icon('refresh')}</button></div><span data-role="command"></span><div class="work-title" data-role="worktitle"></div></div>
    <div class="card-offline-actions">
      <button type="button" class="card-create-btn" data-create title="Create this tmux session" aria-label="Create this tmux session">${icon('plus')}<span>New tmux</span></button>
      <button type="button" class="card-remove-btn" data-remove-closed title="Remove this closed session from the dashboard" aria-label="Remove closed session from dashboard">${icon('trash')}<span>Remove</span></button>
    </div>
    <div class="terminal-meta"><span class="agent-badge" data-role="agent"></span><span class="dot" data-role="dot"></span><span data-role="cwd"></span></div>
    <div class="card-window-controls">
      <button type="button" class="card-win-btn win-min" data-minimize-shell title="Minimize this preview to dock" aria-label="Minimize preview to dock">−</button>
      <button type="button" class="card-win-btn win-full" data-maximize-preview title="Fullscreen this preview" aria-label="Fullscreen preview">⛶</button>
      <button type="button" class="card-win-btn win-close" data-stop title="Kill this tmux session" aria-label="Kill tmux session">×</button>
    </div>
  </header>
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
      <button class="warn iconly" type="button" data-stop title="Terminate this tmux session and hide it from the dashboard" aria-label="Terminate tmux session">${icon('power')}</button>
      <button class="warn resume-btn iconly" type="button" data-resume title="Re-run the agent's resume command shown in the pane" aria-label="Resume agent">${icon('restart')}</button>
    </div>
    <div class="attach-list" data-role="attachments"></div>
    <div class="shell-status" data-role="status">Paste or drop an image into this input to insert its saved path.</div>
  </div>
  <pre data-role="output"></pre>`;
  article.querySelector<HTMLTextAreaElement>('[data-command]')!.dataset.command = shell.name;
  article.querySelector<HTMLButtonElement>('[data-send-shell]')!.dataset.sendShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-paste-shell]')!.dataset.pasteShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-add-image]')!.dataset.addImage = shell.name;
  article.querySelector<HTMLButtonElement>('[data-create]')!.dataset.create = shell.name;
  article.querySelector<HTMLButtonElement>('[data-dictate-shell]')!.dataset.dictateShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-history]')!.dataset.history = shell.name;
  article.querySelector<HTMLButtonElement>('[data-copy-output]')!.dataset.copyOutput = shell.name;
  article.querySelector<HTMLButtonElement>('[data-privacy-shell]')!.dataset.privacyShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-remove-closed]')!.dataset.removeClosed = shell.name;
  article.querySelector<HTMLButtonElement>('[data-rename-shell]')!.dataset.renameShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-reset-shell-label]')!.dataset.resetShellLabel = shell.name;
  article.querySelector<HTMLButtonElement>('[data-minimize-shell]')!.dataset.minimizeShell = shell.name;
  article.querySelector<HTMLButtonElement>('[data-maximize-preview]')!.dataset.maximizePreview = shell.name;
  article.querySelector<HTMLButtonElement>('[data-shellin]')!.dataset.shellin = shell.name;
  article.querySelector<HTMLButtonElement>('[data-resume]')!.dataset.resume = shell.name;
  article.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach((button) => { button.dataset.stop = shell.name; });
  article.querySelector<HTMLButtonElement>('[data-restart]')!.dataset.restart = shell.name;
  article.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
    button.dataset.shell = shell.name;
  });
  // Card resize handle (bottom-right corner)
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'card-resize-handle';
  resizeHandle.title = 'Drag to resize this preview card';
  article.appendChild(resizeHandle);
  return article;
}

function updateShellCard(card: HTMLElement, shell: ShellPreview): void {
  const keepFullscreen = card.classList.contains('preview-fullscreen');
  const keepEnlarged = card.classList.contains('preview-enlarged');
  const keepResizing = card.classList.contains('resizing');
  card.className = `terminal-card ${shell.running ? 'running' : 'offline'}${shell.name === selectedSession ? ' selected' : ''}`;
  card.classList.toggle('preview-fullscreen', keepFullscreen);
  card.classList.toggle('preview-enlarged', keepEnlarged);
  card.classList.toggle('resizing', keepResizing);
  card.classList.toggle('shell-refreshing', shellsLoading);
  card.classList.toggle('removable-closed', canRemoveClosedShell(sessionByName(shell.name)));
  applyShellPrivacy(card, shell.name);
  const displayLabel = updateShellCardTitle(card, shell);
  setText(card, '[data-role="command"]', shell.command || 'offline');
  setText(card, '[data-role="cwd"]', shell.cwd || '');
  card.querySelector('[data-role="dot"]')!.className = `dot ${shell.running ? 'on' : ''}`;
  noteShellActivity(shell.name, shell.output);
  setShellAgentBadge(card, shell.name);
  setWorkTitle(card, shell.name);
  // Surface a one-click recovery when an agent has exited and printed a resume command
  // (e.g. Codex: "To continue this session, run codex resume <id>").
  const resumeBtn = card.querySelector<HTMLButtonElement>('[data-resume]');
  if (resumeBtn) {
    const m = shell.output.match(/\b(?:codex|agent) resume [A-Za-z0-9-]{8,}/i);
    if (m) {
      resumeBtn.dataset.resumeCmd = m[0];
      resumeBtn.classList.add('show');
    } else {
      delete resumeBtn.dataset.resumeCmd;
      resumeBtn.classList.remove('show');
    }
  }
  const output = shell.output || (shell.running ? 'No output captured yet.' : 'Session is offline.');
  const pre = card.querySelector<HTMLElement>('[data-role="output"]')!;
  // Only auto-follow when the viewer is already at the bottom, so scrolling up to read
  // older output isn't yanked back down on every 1.2s stream tick.
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 48;
  if (pre.dataset.rawOutput !== output) {
    pre.dataset.rawOutput = output;
    pre.innerHTML = renderLinkedShellOutput(output);
  }
  const input = card.querySelector<HTMLTextAreaElement>('[data-command]')!;
  input.placeholder = shell.running ? `Input for ${displayLabel}` : 'Create this session before sending input';
  if (followOutput && atBottom) pre.scrollTop = pre.scrollHeight;
  renderShellImages(shell.name);
}

function updateShellCardTitle(card: HTMLElement, shell: ShellPreview): string {
  const displayLabel = shellDisplayLabel(shell.name, shell.label);
  const rawName = shellRawNameBadge(shell.name, displayLabel);
  const label = card.querySelector<HTMLElement>('[data-role="label"]');
  const summary = shellboxSummary(shell.name);
  renderCardTitleLabel(label, displayLabel, summary || displayLabel || shell.label || shell.name);
  card.querySelector<HTMLElement>('.card-title')?.classList.toggle('solo-summary', !displayLabel);
  setText(card, '[data-role="rawname"]', rawName);
  card.querySelector<HTMLElement>('.shell-name-pill')?.classList.toggle('empty', !rawName);
  card.querySelector<HTMLButtonElement>('[data-reset-shell-label]')?.classList.toggle('show', shellHasCustomLabel(shell.name));
  return displayLabel || summary || shell.label || shell.name;
}

function renderCardTitleLabel(label: HTMLElement | null, displayLabel: string, title: string): void {
  if (!label) return;
  if (!displayLabel) {
    label.hidden = true;
    label.classList.remove('moving');
    label.textContent = '';
    delete label.dataset.renderedLabel;
    return;
  }
  label.hidden = false;
  const moving = window.innerWidth <= 760 && displayLabel.length > 34;
  const signature = `${moving ? '1' : '0'}:${displayLabel}`;
  label.classList.toggle('moving', moving);
  label.title = title;
  if (label.dataset.renderedLabel === signature) return;
  label.dataset.renderedLabel = signature;
  if (moving) {
    label.innerHTML = `<span class="marquee-track"><span>${escapeHtml(displayLabel)}</span><span aria-hidden="true">${escapeHtml(displayLabel)}</span></span>`;
  } else {
    label.textContent = displayLabel;
  }
}

function applyAutoFollowUpDraft(card: HTMLElement, shell: ShellPreview, input: HTMLTextAreaElement): void {
  const draft = extractAutoFollowUpDraft(shell.output || '');
  if (!draft || autoFollowUpSentDrafts[shell.name] === draft) return;
  const current = input.value.trim();
  const previous = autoFollowUpDrafts[shell.name] || '';
  if (current && current !== previous) return;
  if (input.value !== draft) input.value = draft;
  autoFollowUpDrafts[shell.name] = draft;
  const status = card.querySelector<HTMLElement>('[data-role="status"]');
  if (status) status.textContent = 'Follow-up draft from agent.';
  updateUnlockState();
}

function setText(parent: HTMLElement, selector: string, text: string): void {
  const element = parent.querySelector(selector);
  if (element && element.textContent !== text) element.textContent = text;
}
