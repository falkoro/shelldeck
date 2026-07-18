// Terminal window lifecycle + shell-preview minimize/maximize/dock. Part of the terminal global-script module (shares state declared in terminal.ts; load after it).

function showLiveStageIdle(name: string): void {
  // Hide docked terminals and show offline / empty CTA with Start + Remove.
  termWindows.forEach((tw) => {
    if (tw.el.classList.contains('term-docked')) {
      tw.el.hidden = true;
      tw.minimized = true;
    }
  });
  const empty = document.getElementById('liveStageEmpty');
  if (empty) empty.removeAttribute('hidden');
  const title = document.getElementById('liveStageTitle');
  const hint = document.getElementById('liveStageHint');
  if (!name) {
    if (title) title.textContent = 'Live terminal';
    if (hint) hint.textContent = 'Select a session on the left to attach.';
    if (empty) {
      empty.innerHTML = 'No session selected. Choose one from Conversation on the left — the live tmux attach opens here.';
    }
    return;
  }
  if (title) title.textContent = `${name} · offline`;
  if (hint) {
    hint.textContent = shellUnlocked
      ? 'Offline — Start it, or Remove it from the list.'
      : 'Unlock shells first, then start or select a running session.';
  }
  if (!empty) return;
  const n = escapeHtml(name);
  if (!shellUnlocked) {
    empty.innerHTML = `<div class="live-stage-cta"><p><b>${n}</b> is offline.</p><p class="muted">Unlock shells first.</p></div>`;
    return;
  }
  empty.innerHTML = `<div class="live-stage-cta">
    <p><b>${n}</b> is not running.</p>
    <p class="muted">Start a tmux session here, or remove this dead slot from the list.</p>
    <div class="live-stage-cta-actions">
      <button type="button" class="primary" data-start="${n}">${icon('plus')}<span>Start</span></button>
      <button type="button" class="warn" data-remove-closed="${n}">${icon('trash')}<span>Remove</span></button>
    </div>
  </div>`;
}

function dockTermWindow(tw: TermWindow): void {
  const stage = document.getElementById('liveStage');
  if (!stage) return;
  document.getElementById('liveStageEmpty')?.setAttribute('hidden', '');
  // Hide other docked terminals; only the focused session is visible in the stage.
  termWindows.forEach((other) => {
    if (other === tw) return;
    if (other.el.classList.contains('term-docked')) {
      other.el.hidden = true;
      other.minimized = true;
    }
  });
  tw.el.classList.add('term-docked');
  tw.el.classList.remove('mobile');
  tw.minimized = false;
  tw.maximized = true;
  tw.el.hidden = false;
  tw.el.style.display = '';
  tw.el.style.left = '0';
  tw.el.style.top = '0';
  tw.el.style.width = '100%';
  tw.el.style.height = '100%';
  // Detach / float chrome is noise in the main stage.
  tw.el.querySelector<HTMLElement>('.term-resize-handle')?.setAttribute('hidden', '');
  const title = document.getElementById('liveStageTitle');
  const hint = document.getElementById('liveStageHint');
  if (title) title.textContent = `${tw.name} · live`;
  if (hint) hint.textContent = 'tmux attach in the center — session keeps running if you switch away';
  if (tw.el.parentElement !== stage) stage.appendChild(tw.el);
  setTimeout(() => {
    doFit(tw);
    tw.term?.focus?.();
  }, 40);
}

function openTerminal(name: string): void {
  if (!name) return;
  if (typeof Terminal === 'undefined') {
    toast('Terminal failed to load');
    return;
  }
  const existing = termWindows.get(name);
  if (existing) {
    if (existing.minimized) restoreWindow(existing);
    bringToFront(existing);
    dockTermWindow(existing);
    existing.term?.focus?.();
    return;
  }
  const tw = createTermWindow(name);
  dockTermWindow(tw);
}

