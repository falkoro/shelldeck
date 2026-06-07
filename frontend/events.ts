type ShellDangerAction = 'stop' | 'restart';

let armedShellActionTimer = 0;

function clearArmedShellAction(): void {
  if (armedShellActionTimer) {
    window.clearTimeout(armedShellActionTimer);
    armedShellActionTimer = 0;
  }
  document.querySelectorAll<HTMLButtonElement>('[data-shell-confirm-key]').forEach((button) => {
    const label = button.querySelector('span');
    if (label && button.dataset.originalLabel !== undefined) label.textContent = button.dataset.originalLabel;
    if (button.dataset.originalTitle !== undefined) button.title = button.dataset.originalTitle;
    if (button.dataset.originalAria !== undefined) button.setAttribute('aria-label', button.dataset.originalAria);
    button.classList.remove('confirming');
    button.removeAttribute('aria-pressed');
    delete button.dataset.shellConfirmKey;
    delete button.dataset.originalLabel;
    delete button.dataset.originalTitle;
    delete button.dataset.originalAria;
  });
}

function setShellActionStatus(name: string, message: string): void {
  const card = document.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(name)}"]`);
  const status = card?.querySelector<HTMLElement>('[data-role="status"]');
  if (status) status.textContent = message;
}

function armShellDangerAction(button: HTMLButtonElement, action: ShellDangerAction, name: string): boolean {
  if (!name) return false;
  const key = `${action}:${name}`;
  if (button.dataset.shellConfirmKey === key) {
    clearArmedShellAction();
    return true;
  }
  clearArmedShellAction();
  const label = button.querySelector('span');
  const verb = action === 'stop' ? 'terminate' : 'restart';
  const confirmLabel = action === 'stop' ? 'Confirm terminate' : 'Confirm restart';
  const detail = action === 'stop'
    ? `Terminate "${name}" kills the tmux session, stops everything inside it, and hides it from this dashboard.`
    : `Restart "${name}" kills and recreates the tmux session, keeping this dashboard slot visible.`;
  button.dataset.shellConfirmKey = key;
  button.dataset.originalTitle = button.title || '';
  button.dataset.originalAria = button.getAttribute('aria-label') || '';
  if (label) {
    button.dataset.originalLabel = label.textContent || '';
    label.textContent = confirmLabel;
  }
  button.classList.add('confirming');
  button.setAttribute('aria-pressed', 'true');
  button.setAttribute('aria-label', confirmLabel);
  button.title = `${detail} Click again to confirm.`;
  setShellActionStatus(name, `${detail} Click ${confirmLabel} within 5 seconds.`);
  toast(`Click again to ${verb} ${name}`);
  armedShellActionTimer = window.setTimeout(clearArmedShellAction, 5000);
  return false;
}

document.addEventListener('click', async (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const copyButton = target.closest<HTMLElement>('[data-copy]');
  const createButton = target.closest<HTMLButtonElement>('[data-create]');
  const startButton = target.closest<HTMLButtonElement>('[data-start]');
  const stopButton = target.closest<HTMLButtonElement>('[data-stop]');
  const restartButton = target.closest<HTMLButtonElement>('[data-restart]');
  const keyButton = target.closest<HTMLButtonElement>('[data-key]');
  const sendButton = target.closest<HTMLButtonElement>('[data-send-shell]');
  const pasteButton = target.closest<HTMLButtonElement>('[data-paste-shell]');
  const imageButton = target.closest<HTMLButtonElement>('[data-add-image]');
  const dictateButton = target.closest<HTMLButtonElement>('[data-dictate-shell]');
  const historyButton = target.closest<HTMLButtonElement>('[data-history]');
  const copyOutputButton = target.closest<HTMLButtonElement>('[data-copy-output]');
  const privacyButton = target.closest<HTMLButtonElement>('[data-privacy-shell]');
  const containerPrivacyButton = target.closest<HTMLButtonElement>('[data-container-privacy]');
  const renameShellButton = target.closest<HTMLButtonElement>('[data-rename-shell]');
  const resetShellLabelButton = target.closest<HTMLButtonElement>('[data-reset-shell-label]');
  const renameSensorButton = target.closest<HTMLButtonElement>('[data-rename-sensor]');
  const containerActionButton = target.closest<HTMLButtonElement>('[data-container-action]');
  const editDescButton = target.closest<HTMLElement>('[data-edit-desc]');
  const shellinButton = target.closest<HTMLButtonElement>('[data-shellin]');
  const resumeButton = target.closest<HTMLButtonElement>('[data-resume]');
  const removeImageButton = target.closest<HTMLButtonElement>('[data-remove-image]');
  const removeClosedButton = target.closest<HTMLButtonElement>('[data-remove-closed]');
  const restoreHiddenButton = target.closest<HTMLButtonElement>('[data-restore-hidden-closed]');
  const tabButton = target.closest<HTMLButtonElement>('[data-shell-tab]');
  const selectItem = target.closest<HTMLElement>('[data-select-session]');
  const interactive = target.closest('textarea,input,button,a,pre');
  try {
    if (copyButton) return copyText(copyButton.dataset.copy || '');
    if (sendButton && !sendButton.disabled) return sendInput(sendButton.dataset.sendShell || '', true);
    if (pasteButton && !pasteButton.disabled) return sendInput(pasteButton.dataset.pasteShell || '', false);
    if (dictateButton && !dictateButton.disabled) {
      await toggleDictation(dictateButton.dataset.dictateShell || '');
      return;
    }
    if (historyButton) return cycleHistory(historyButton.dataset.history || '', 1);
    if (copyOutputButton) return copyShellOutput(copyOutputButton.dataset.copyOutput || '');
    if (privacyButton) return toggleShellPrivacy(privacyButton.dataset.privacyShell || '');
    if (containerPrivacyButton) return toggleContainerPrivacy(containerPrivacyButton.dataset.containerPrivacy || '');
    if (renameShellButton) {
      const name = renameShellButton.dataset.renameShell || '';
      if (name && renameShellLabel(name)) {
        renderShells({ shells: latestShells });
        toast('Renamed');
      }
      return;
    }
    if (resetShellLabelButton) {
      const name = resetShellLabelButton.dataset.resetShellLabel || '';
      if (name && resetShellLabel(name)) {
        renderShells({ shells: latestShells });
        toast('Using auto title');
      }
      return;
    }
    if (renameSensorButton) return renameSensorLabel(renameSensorButton.dataset.renameSensor || '');
    if (containerActionButton) {
      const d = containerActionButton.dataset;
      return containerAction(d.chost || '', d.cengine || '', d.cname || '', d.containerAction || '');
    }
    if (editDescButton) return editContainerDescription(editDescButton.dataset.editDesc || '');
    if (shellinButton) {
      openTerminal(shellinButton.dataset.shellin || '');
      return;
    }
    const minimizeShellButton = target.closest<HTMLButtonElement>('[data-minimize-shell]');
    if (minimizeShellButton) {
      minimizeShellPreview(minimizeShellButton.dataset.minimizeShell || '');
      return;
    }
    const maximizePreviewButton = target.closest<HTMLButtonElement>('[data-maximize-preview]');
    if (maximizePreviewButton) {
      maximizeShellPreview(maximizePreviewButton.dataset.maximizePreview || '');
      return;
    }
    if (resumeButton && resumeButton.dataset.resumeCmd) return runCommand(resumeButton.dataset.resume || '', resumeButton.dataset.resumeCmd);
    if (removeImageButton) return removeShellImage(removeImageButton.dataset.shell || '', removeImageButton.dataset.removeImage || '');
    if (removeClosedButton) return removeClosedShell(removeClosedButton.dataset.removeClosed || '');
    if (restoreHiddenButton) return restoreHiddenClosedShells();
    if (tabButton) {
      selectSession(tabButton.dataset.shellTab);
      focusComposer(tabButton.dataset.shellTab || '');
      return;
    }
    if (imageButton && !imageButton.disabled) {
      pendingImageTarget = imageButton.dataset.addImage || selectedSession;
      imageFile.click();
      return;
    }
    if (createButton && !createButton.disabled) {
      const baseName = createButton.dataset.create || '';
      const requestedName = promptNewTmuxSessionName(baseName);
      if (requestedName === null) return;
      const targetName = requestedName || baseName;
      unhideShell(targetName);
      const payload = await sessionAction('/api/create', baseName, { sessionName: requestedName });
      return selectSession(payload.sessionName || targetName);
    }
    if (startButton && !startButton.disabled) {
      unhideShell(startButton.dataset.start || '');
      await sessionAction('/api/start', startButton.dataset.start || '');
      return selectSession(startButton.dataset.start);
    }
    if (stopButton && !stopButton.disabled) {
      const stopped = stopButton.dataset.stop || '';
      if (!armShellDangerAction(stopButton, 'stop', stopped)) return;
      await sessionAction('/api/stop', stopped);
      terminateShellInDashboard(stopped);
      return;
    }
    if (restartButton && !restartButton.disabled) {
      const restarted = restartButton.dataset.restart || '';
      if (!armShellDangerAction(restartButton, 'restart', restarted)) return;
      unhideShell(restarted);
      await sessionAction('/api/restart', restarted);
      return selectSession(restarted);
    }
    if (keyButton && !keyButton.disabled) return sendKey(keyButton.dataset.shell || '', keyButton.dataset.key || '');
    // Select when clicking a session/card — allow the case where the clicked interactive element
    // IS the select target itself (the sidebar session items are <button data-select-session>),
    // but still ignore clicks on inner controls (textarea/pre inside a card).
    if (selectItem && (!interactive || interactive === selectItem)) {
      const sessionName = selectItem.dataset.selectSession || '';
      selectSession(sessionName);
      // On a phone the cards are collapsed to a compact launcher, so a tap opens the
      // full-screen live terminal ("just go") instead of focusing the hidden composer.
      if (sessionName && compactTerminalViewport()) {
        openTerminal(sessionName);
        return;
      }
      focusComposer(sessionName);
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
});

document.addEventListener('focusin', (event: FocusEvent) => {
  const input = event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]') ? event.target : null;
  if (input) selectSession(input.dataset.command);
});

document.addEventListener('input', (event: Event) => {
  if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]')) {
    resetHistoryNavigation(event.target.dataset.command || '');
    updateUnlockState();
  }
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
  const input = event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]') ? event.target : null;
  if (!input) return;
  // Ctrl/Cmd+Enter sends on desktop; on touch/mobile-layout plain Enter sends (Shift+Enter =
  // newline) so phone users don't have to reach the Run button hidden behind the soft keyboard.
  const mobileSend = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || window.matchMedia('(max-width: 760px)').matches;
  if (event.key === 'Enter' && !event.shiftKey && (event.ctrlKey || event.metaKey || mobileSend)) {
    event.preventDefault();
    sendInput(input.dataset.command || '', true).catch((error: Error) => toast(error.message));
  }
  if (event.key === 'ArrowUp' && !input.value) {
    if (cycleHistory(input.dataset.command || '', 1)) event.preventDefault();
  }
  if (event.key === 'ArrowDown') {
    if (cycleHistory(input.dataset.command || '', -1)) event.preventDefault();
  }
});

// Backstop: when focus is on the page body (not an editable field, button, link or
// select), Space scrolls the document. Swallow it and pull focus into the selected
// shell composer so a stray Space never jumps the page down.
document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== ' ' && event.code !== 'Space') return;
  const el = document.activeElement;
  const interactive =
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLButtonElement ||
    el instanceof HTMLAnchorElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable);
  if (interactive) return;
  event.preventDefault();
  focusComposer(selectedSession);
});

document.addEventListener('paste', (event: ClipboardEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-shell-card]')) pasteImageFiles(event);
});

document.addEventListener('dragover', (event: DragEvent) => {
  const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-shell-card]') : null;
  if (!card) return;
  event.preventDefault();
  card.classList.add('dragging');
});

document.addEventListener('dragleave', (event: DragEvent) => {
  const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-shell-card]') : null;
  if (card) card.classList.remove('dragging');
});

document.addEventListener('drop', (event: DragEvent) => {
  const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-shell-card]') : null;
  if (!card) return;
  event.preventDefault();
  card.classList.remove('dragging');
  handleImageFiles(event.dataTransfer?.files, card.dataset.shellCard || '').catch((error: Error) => toast(error.message));
});

q('#refreshBtn').addEventListener('click', () => refresh().catch((error: Error) => toast(error.message)));
document.getElementById('settingsBtn')?.addEventListener('click', () => openSettingsEditor());
document.getElementById('editTickersBtn')?.addEventListener('click', () => openSettingsEditor('tickers'));
document.getElementById('safeShotBtn')?.addEventListener('click', () => createSafeShot().catch((error: Error) => toast(error.message)));
document.getElementById('editLinksBtn')?.addEventListener('click', () => openLinksEditor());
document.getElementById('editRemoteHostsBtn')?.addEventListener('click', () => openRemoteHostsEditor().catch((error: Error) => toast(error.message)));
document.getElementById('refreshSummaryBtn')?.addEventListener('click', () => refreshSummaries().catch((error: Error) => toast(error.message)));
q<HTMLButtonElement>('#refreshShellsTopBtn').title = 'Refresh shells';
q('#refreshShellsTopBtn').addEventListener('click', () => loadShells().catch((error: Error) => toast(error.message)));
q('#viewToggle').addEventListener('click', () => setViewMode(viewMode === 'focus' ? 'grid' : 'focus'));
q('#densityToggle').addEventListener('click', toggleDensity);
q('#followToggle').addEventListener('click', () => { followOutput = !followOutput; localStorage.setItem('sdFollowOutput', followOutput ? '1' : '0'); applyPrefs(); });

// Side-panels toggle in the top bar. The side rail (Machine/Remote/Containers/Links/Unlock) is
// OPTIONAL — this always-visible button is the hint that it can be shown/hidden, and the choice
// persists per browser (sdSidebar). Injected so it needs no HTML rebuild.
const topActions = document.querySelector<HTMLElement>('.top-actions');
if (topActions && !document.getElementById('sidebarToggle')) {
  const sidebarBtn = document.createElement('button');
  sidebarBtn.id = 'sidebarToggle';
  sidebarBtn.type = 'button';
  sidebarBtn.className = 'ghost';
  sidebarBtn.innerHTML = `${icon('sidebar')}<span>Panels</span>`;
  sidebarBtn.addEventListener('click', toggleSidebar);
  topActions.insertAdjacentElement('afterbegin', sidebarBtn);
  applySidebar();
}

// Restore all minimized shell previews button (injected)
const shellTools = document.querySelector<HTMLElement>('.shell-tools');
if (shellTools && !document.querySelector('#restoreAllPreviewsBtn')) {
  const restoreAllBtn = document.createElement('button');
  restoreAllBtn.id = 'restoreAllPreviewsBtn';
  restoreAllBtn.type = 'button';
  restoreAllBtn.title = 'Restore all minimized shell previews from the dock';
  restoreAllBtn.innerHTML = 'Restore all';
  restoreAllBtn.style.display = 'none';
  restoreAllBtn.addEventListener('click', () => {
    const fn = (window as any).restoreAllShellPreviews || (() => {
      const set = (window as any).minimizedPreviews;
      if (set) set.clear();
      document.querySelectorAll<HTMLElement>('[data-shell-card]').forEach(c => c.style.display = '');
      (window as any).renderDock?.();
    });
    fn();
  });
  shellTools.appendChild(restoreAllBtn);
}

// Legend toggle next to the live-time pill — reveals the collapsible "what each button means"
// panel (built lazily by buildLegend, which sits under the shell tabs). On mobile it stays
// collapsed until tapped, so it never crowds the small screen.
if (shellTools && !document.querySelector('#legendToggleBtn')) {
  const legendBtn = document.createElement('button');
  legendBtn.id = 'legendToggleBtn';
  legendBtn.type = 'button';
  legendBtn.title = 'What each button and control does';
  legendBtn.innerHTML = `${icon('help')}<span>Legend</span>`;
  legendBtn.addEventListener('click', () => {
    buildLegend();
    const legend = document.getElementById('legend') as HTMLDetailsElement | null;
    if (!legend) return;
    legend.open = !legend.open;
    legendBtn.classList.toggle('active', legend.open);
    if (legend.open) legend.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  document.getElementById('streamState')?.insertAdjacentElement('afterend', legendBtn);
}

// Rotating keyboard-shortcut tip in the spare space of the shell toolbar.
const SHELL_TIPS = [
  'Tip: r refresh · g grid/focus · c density',
  'Tip: f follow output · [ ] cycle shells',
  'Tip: ? lists all shortcuts',
  'Tip: unlock shells to Restart / Pull containers',
  'Tip: ⚙ Configure hides sidebar panels (e.g. Machine)',
  'Tip: the Panels button (top bar) shows/hides the side rail',
];
if (shellTools && !document.querySelector('#shellTip')) {
  const tip = document.createElement('span');
  tip.id = 'shellTip';
  tip.className = 'shell-tip';
  tip.textContent = SHELL_TIPS[0];
  // Insert just after the Legend button (which sits right after the stream-state pill) so the
  // Legend stays next to the live time and the tip fills the empty space before the buttons.
  const tipAnchor = document.getElementById('legendToggleBtn') || document.getElementById('streamState') || shellTools.children[0];
  tipAnchor?.insertAdjacentElement('afterend', tip);
  let tipIndex = 0;
  setInterval(() => {
    tipIndex = (tipIndex + 1) % SHELL_TIPS.length;
    tip.style.opacity = '0';
    setTimeout(() => { tip.textContent = SHELL_TIPS[tipIndex]; tip.style.opacity = ''; }, 250);
  }, 7000);
}

// Step the selected shell to the previous/next tab.
function cycleShell(direction: number): void {
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('[data-shell-tab]'))
    .map((el) => el.dataset.shellTab || '')
    .filter(Boolean);
  if (!tabs.length) return;
  const current = Math.max(0, tabs.indexOf(selectedSession));
  const next = tabs[(current + direction + tabs.length) % tabs.length];
  if (next) selectSession(next);
}

// Single-key shortcuts, active only when focus isn't in a field, the terminal, or with a modifier.
document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const el = document.activeElement;
  const busy = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    || el instanceof HTMLSelectElement || (el instanceof HTMLElement && (el.isContentEditable || !!el.closest('.term-window')));
  if (busy) return;
  switch (event.key) {
    case 'r': event.preventDefault(); document.getElementById('refreshShellsTopBtn')?.click(); break;
    case 'g': event.preventDefault(); document.getElementById('viewToggle')?.click(); break;
    case 'c': event.preventDefault(); document.getElementById('densityToggle')?.click(); break;
    case 'f': event.preventDefault(); document.getElementById('followToggle')?.click(); break;
    case '[': event.preventDefault(); cycleShell(-1); break;
    case ']': event.preventDefault(); cycleShell(1); break;
    case '?': event.preventDefault(); toast('Shortcuts — r: refresh · g: grid/focus · c: density · f: follow · [ ]: cycle shells'); break;
    default: break;
  }
});

q<HTMLSelectElement>('#lineCount').addEventListener('change', (event: Event) => setTerminalLines(Number((event.target as HTMLSelectElement).value)));
imageFile.addEventListener('change', () => {
  handleImageFiles(imageFile.files || undefined, pendingImageTarget).catch((error: Error) => toast(error.message)).finally(() => {
    imageFile.value = '';
  });
});
q('#unlockForm').addEventListener('submit', (event: Event) => {
  event.preventDefault();
  const input = q<HTMLInputElement>('#unlockPassword');
  unlockShells(input.value).catch((error: Error) => {
    input.focus();
    toast(error.message);
  });
});

// The inline unlock prompt inside the shells area is rendered dynamically, so wire
// it through delegation. It reuses the same unlock flow as the sidebar form.
document.addEventListener('submit', (event: Event) => {
  const form = event.target instanceof Element ? event.target.closest('#inlineUnlockForm') : null;
  if (!form) return;
  event.preventDefault();
  const input = document.getElementById('inlineUnlockPassword') as HTMLInputElement | null;
  const status = document.getElementById('inlineUnlockStatus');
  if (!input) return;
  if (status) { status.className = 'unlock-status'; status.textContent = 'Checking second password...'; }
  unlockShells(input.value).catch((error: Error) => {
    input.focus();
    if (status) { status.className = 'unlock-status error'; status.textContent = error.message; }
    toast(error.message);
  });
});

// --- Drag-to-reorder shell cards ---
// Mousedown on a card header initiates reorder after a drag threshold.
document.addEventListener('mousedown', (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  // Only start reorder if dragging from the card header (not buttons/inputs inside)
  const header = target?.closest<HTMLElement>('.terminal-card > header');
  if (!header) return;
  // Don't initiate drag when clicking buttons, inputs, or the card window controls
  if ((event.target as HTMLElement)?.closest('button,input,textarea,select,[data-minimize-shell],[data-maximize-shell]')) return;
  const card = header.closest<HTMLElement>('[data-shell-card]');
  if (!card) return;
  const name = card.dataset.shellCard || '';
  if (!name) return;
  const grid = card.parentElement;
  if (!grid) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let reorderActive = false;
  let dragEl: HTMLElement | null = null;

  const onMove = (e: MouseEvent) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!reorderActive && Math.abs(dx) + Math.abs(dy) < DRAG_REORDER_THRESHOLD) return;
    if (!reorderActive) {
      reorderActive = true;
      card.classList.add('reorder-dragging');
      dragEl = card.cloneNode(true) as HTMLElement;
      dragEl.classList.add('reorder-clone');
      dragEl.style.position = 'fixed';
      dragEl.style.pointerEvents = 'none';
      dragEl.style.zIndex = '999';
      dragEl.style.width = `${card.offsetWidth}px`;
      dragEl.style.left = '0';
      dragEl.style.top = '0';
      dragEl.style.opacity = '0.85';
      dragEl.style.transform = 'scale(0.97)';
      document.body.appendChild(dragEl);
      card.style.opacity = '0.35';
    }
    // Update clone position
    if (dragEl) {
      dragEl.style.left = `${e.clientX - 40}px`;
      dragEl.style.top = `${e.clientY - 14}px`;
    }
    // Highlight target position
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-shell-card]:not(.reorder-dragging)'));
    cards.forEach((c) => c.classList.remove('reorder-target'));
    const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-shell-card]');
    if (targetEl && targetEl !== card) targetEl.classList.add('reorder-target');
  };

  const onUp = (e: MouseEvent) => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    card.classList.remove('reorder-dragging');
    card.style.opacity = '';
    if (dragEl) dragEl.remove();
    grid.querySelectorAll<HTMLElement>('[data-shell-card]').forEach((c) => c.classList.remove('reorder-target'));

    if (!reorderActive) return;
    // Find the card we dropped on
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-shell-card]');
    if (!dropTarget || dropTarget === card) return;
    const targetName = dropTarget.dataset.shellCard || '';
    if (!targetName) return;

    // Reorder in the saved list
    const order = shellOrder();
    const fromIdx = order.indexOf(name);
    const toIdx = order.indexOf(targetName);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, name);
    saveShellOrder(order);

    // Physically reorder in DOM
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-shell-card]'));
    const fromCard = cards.find((c) => c.dataset.shellCard === name);
    const toCard = cards.find((c) => c.dataset.shellCard === targetName);
    if (fromCard && toCard) {
      if (fromIdx > toIdx) {
        toCard.before(fromCard);
      } else {
        toCard.after(fromCard);
      }
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp, { once: true });
});

// --- Drag-to-resize shell cards ---
document.addEventListener('mousedown', (event: MouseEvent) => {
  const handle = (event.target as HTMLElement)?.closest<HTMLElement>('.card-resize-handle');
  if (!handle) return;
  event.preventDefault();
  event.stopPropagation();
  const card = handle.closest<HTMLElement>('[data-shell-card]');
  if (!card) return;
  const name = card.dataset.shellCard || '';

  const startX = event.clientX;
  const startY = event.clientY;
  const origH = card.offsetHeight;
  const origW = card.offsetWidth;
  card.classList.add('resizing');

  const onMove = (e: MouseEvent) => {
    const newH = Math.max(280, Math.min(1200, origH + (e.clientY - startY)));
    const newW = Math.max(340, Math.min(window.innerWidth - 40, origW + (e.clientX - startX)));
    card.style.minHeight = `${newH}px`;
    if (newW > 340) card.style.maxWidth = `${newW}px`;
    // Update the pre element's max-height to keep it proportional
    const pre = card.querySelector<HTMLElement>('[data-role="output"]');
    if (pre) pre.style.maxHeight = `${Math.max(180, newH - 220)}px`;
    // Track that this card has been resized
    card.dataset.sized = '1';
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    card.classList.remove('resizing');
    if (name) {
      saveShellCardSize(name, { w: card.offsetWidth, h: card.offsetHeight });
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp, { once: true });
});

function markBooted(): void {
  document.body.classList.add('booted');
}

render(initialModel);
// Hold the boot splash up until the first LIVE shell load confirms session state. The injected
// initial model is a point-in-time server snapshot (running = "tmux session exists"), so revealing
// it immediately flashes a stale "running" before the live fetch lands. Gating the reveal on
// loadShells() means we only ever show client-confirmed state. The timeout is a safety net so the
// splash can never stick if the fetch hangs (the page also keeps its own 4s hard fallback).
const bootSplashFallback = setTimeout(markBooted, 4000);
const liftBootSplash = () => { clearTimeout(bootSplashFallback); markBooted(); };
queueMicrotask(() => loadSummary().catch(() => {}));
queueMicrotask(() => loadShells().then(() => {
  startShellStream();
  (window as any).maybeAutoOpenMobileShell?.();
}).catch((error: Error) => toast(error.message)).finally(liftBootSplash));
setInterval(() => refresh({ preserveUnlock: true }).catch(() => {}), 30000);
setInterval(() => loadSummary().catch(() => {}), 60000);

// Live-tick relative last activity labels (the main "add last activity" UX fix for code.falkinator.org)
// Note: defined in core.ts (loaded before events.js in the page).
(window as any).updateLastActivityTimes?.();
setInterval(() => (window as any).updateLastActivityTimes?.(), 30000);

queueMicrotask(() => {
  loadDashboardSettings()
    .catch(() => {})
    .finally(() => {
      loadTickers().catch(() => {});
      loadMetrics().catch(() => {});
      loadContainers().catch(() => {});
      loadRemoteHosts().catch(() => {});
      loadGhRuns().catch(() => {});
      loadLinks().catch(() => {});
    });
});
setInterval(() => loadTickers().catch(() => {}), 60000);
setInterval(() => loadMetrics().catch(() => {}), 5000);
setInterval(() => loadContainers().catch(() => {}), 15000);
setInterval(() => loadRemoteHosts().catch(() => {}), 20000);
setInterval(() => loadGhRuns().catch(() => {}), 60000);

window.addEventListener('resize', () => {
  shellTabsSignature = '';
  applyWorkTitles();
});
