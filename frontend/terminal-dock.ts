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
    if (hint) hint.textContent = 'Pick a session to attach';
    if (empty) {
      empty.innerHTML = '<div class="live-stage-cta"><p class="muted">Pick a session from the left</p></div>';
    }
    document.getElementById('liveStageTools')?.replaceChildren();
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
    <p><b>${n}</b></p>
    <p class="muted">Session offline</p>
    <div class="live-stage-cta-actions">
      <button type="button" class="primary" data-start="${n}">${icon('plus')}<span>Start</span></button>
      <button type="button" class="warn" data-remove-closed="${n}">${icon('trash')}<span>Remove</span></button>
    </div>
  </div>`;
  document.getElementById('liveStageTools')?.replaceChildren();
}

function ensureLiveStageTools(): HTMLElement | null {
  const header = document.querySelector<HTMLElement>('.live-stage-header .shell-tools')
    || document.querySelector<HTMLElement>('.live-stage-header');
  if (!header) return null;
  let tools = document.getElementById('liveStageTools');
  if (!tools) {
    tools = document.createElement('div');
    tools.id = 'liveStageTools';
    tools.className = 'live-stage-tools';
    tools.setAttribute('aria-label', 'Terminal tools');
    header.appendChild(tools);
  }
  return tools;
}

function syncLiveStageTools(tw: TermWindow): void {
  const tools = ensureLiveStageTools();
  if (!tools) return;
  // Lift copy / image / detach into the panel header so the stage has no window chrome.
  const src = tw.el.querySelector<HTMLElement>('.term-controls');
  if (!src) return;
  tools.innerHTML = '';
  ['copy', 'copyall', 'upload', 'close'].forEach((act) => {
    const btn = src.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
    if (!btn) return;
    const clone = btn.cloneNode(true) as HTMLButtonElement;
    if (act === 'close') {
      const label = clone.querySelector('.term-detach-label');
      if (label) label.textContent = 'Detach';
      clone.title = 'Detach view (tmux keeps running)';
      clone.setAttribute('aria-label', 'Detach terminal view');
    }
    clone.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (act === 'close') closeWindow(tw);
      else btn.click();
    });
    tools.appendChild(clone);
  });
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
  tw.el.querySelector<HTMLElement>('.term-resize-handle')?.setAttribute('hidden', '');
  const title = document.getElementById('liveStageTitle');
  const hint = document.getElementById('liveStageHint');
  if (title) title.textContent = tw.name;
  if (hint) {
    const st = tw.statusEl?.textContent?.trim() || 'live';
    hint.textContent = st;
  }
  syncLiveStageTools(tw);
  // Keep status text mirrored into the panel subtitle while connected.
  if (tw.statusEl && !tw.statusEl.dataset.liveHintBound) {
    tw.statusEl.dataset.liveHintBound = '1';
    const mo = new MutationObserver(() => {
      if (!tw.el.classList.contains('term-docked') || tw.el.hidden) return;
      const h = document.getElementById('liveStageHint');
      if (h) h.textContent = tw.statusEl?.textContent?.trim() || 'live';
    });
    mo.observe(tw.statusEl, { childList: true, characterData: true, subtree: true });
  }
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

