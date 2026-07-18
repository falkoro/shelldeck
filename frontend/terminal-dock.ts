// Terminal window lifecycle + shell-preview minimize/maximize/dock. Part of the terminal global-script module (shares state declared in terminal.ts; load after it).

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

