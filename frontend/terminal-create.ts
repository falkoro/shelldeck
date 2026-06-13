// Terminal window construction: drag/resize + createTermWindow. Part of the terminal global-script module (shares state declared in terminal.ts; load after it).

function makeDraggable(tw: TermWindow, bar: HTMLElement): void {
  bar.addEventListener('mousedown', (ev: MouseEvent) => {
    if ((ev.target as HTMLElement).closest('button')) return;
    bringToFront(tw);
    const startX = ev.clientX, startY = ev.clientY;
    const origX = tw.x, origY = tw.y;
    const move = (e: MouseEvent) => {
      tw.x = clamp(origX + (e.clientX - startX), 4, window.innerWidth - 220);
      tw.y = clamp(origY + (e.clientY - startY), 4, window.innerHeight - 140);
      tw.el.style.left = tw.x + 'px';
      tw.el.style.top = tw.y + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      savePos(tw);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up, { once: true });
  });
}

function makeResizable(tw: TermWindow, handle: HTMLElement): void {
  handle.addEventListener('mousedown', (ev: MouseEvent) => {
    ev.stopPropagation();
    bringToFront(tw);
    const startX = ev.clientX, startY = ev.clientY;
    const origW = tw.w, origH = tw.h;
    const move = (e: MouseEvent) => {
      tw.w = clamp(origW + (e.clientX - startX), 520, Math.min(1600, window.innerWidth - 40));
      tw.h = clamp(origH + (e.clientY - startY), 320, Math.min(1100, window.innerHeight - 60));
      applyGeometry(tw);
      doFit(tw);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      savePos(tw);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up, { once: true });
  });
}

function createTermWindow(name: string): TermWindow {
  const saved = loadSavedPos(name);
  const off = (cascade++ % 5) * 28;
  const compact = compactTerminalViewport();
  const viewport = viewportSize();
  const baseX = compact ? 0 : saved?.x ?? (96 + off);
  const baseY = compact ? 0 : saved?.y ?? (72 + Math.floor(off / 2));
  const baseW = compact ? viewport.width : saved?.w ?? DEFAULT_W;
  const baseH = compact ? viewport.height : saved?.h ?? DEFAULT_H;

  const el = document.createElement('div');
  el.className = 'term-window';
  el.classList.toggle('mobile', compact);
  if (compact) applyMobileViewportVars(el);
  el.style.left = baseX + 'px';
  el.style.top = baseY + 'px';
  el.style.width = baseW + 'px';
  el.style.height = baseH + 'px';

  el.innerHTML = `
    <div class="term-titlebar">
      <span class="term-title">${escapeHtml(name)} · live terminal</span>
      <span class="term-status" data-role="tstatus">connecting…</span>
      <div class="term-controls">
        <button type="button" class="term-btn" data-act="copy" title="Copy selected terminal text" aria-label="Copy selected terminal text">${icon('copy')}</button>
        <button type="button" class="term-btn" data-act="copyall" title="Copy all scrollback" aria-label="Copy all terminal scrollback">${icon('summary')}</button>
        <button type="button" class="term-btn term-upload" data-act="upload" title="Upload image and insert its saved path" aria-label="Upload image into terminal">${icon('image')}<span class="term-upload-label">Image</span></button>
        <button type="button" class="term-btn" data-act="reset" title="Reset size &amp; position" aria-label="Reset size and position">↺</button>
        <button type="button" class="term-btn" data-act="min" title="Minimize to dock" aria-label="Minimize terminal">−</button>
        <button type="button" class="term-btn" data-act="max" title="Maximize / restore" aria-label="Maximize or restore terminal">□</button>
        <button type="button" class="term-btn term-detach" data-act="close" title="Detach this view and return to the dashboard — the tmux session keeps running" aria-label="Detach terminal view and return to the dashboard (session keeps running)"><span class="term-detach-label">Detach</span></button>
      </div>
    </div>${TERMINAL_KEYBAR_HTML}
    <input class="term-image-input" type="file" accept="image/*" multiple hidden>
    <div class="term-host" data-host></div>
  `;

  const host = el.querySelector<HTMLElement>('[data-host]')!;
  const status = el.querySelector<HTMLElement>('[data-role="tstatus"]')!;
  const bar = el.querySelector<HTMLElement>('.term-titlebar')!;
  const controls = el.querySelector<HTMLElement>('.term-controls')!;
  const keybar = el.querySelector<HTMLElement>('[data-keybar]')!;
  const imageInput = el.querySelector<HTMLInputElement>('.term-image-input')!;

  document.body.appendChild(el);

  const cursorAgent = sessionUsesCursorAgent(name);
  const term = new Terminal({
    fontSize: 13,
    fontFamily: '"Cascadia Mono","JetBrains Mono",Consolas,monospace',
    cursorBlink: !cursorAgent,
    scrollback: cursorAgent ? CURSOR_AGENT_SCROLLBACK : DEFAULT_SCROLLBACK,
    theme: { background: '#03070b', foreground: '#c9fff3' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();

  const tw: TermWindow = {
    name, el, host, statusEl: status, imageInput, term, fitAddon: fit,
    ws: null, ro: null, fitTimer: 0, lastCols: 0, lastRows: 0,
    x: baseX, y: baseY, w: baseW, h: baseH,
    minimized: false, maximized: false, preMax: null,
    ctrlArmed: false, ctrlTimer: 0,
    pendingCopySelection: '',
    writeQueue: [],
    writeFrame: 0,
  };

  // Sticky Ctrl modifier for the mobile key bar: tap Ctrl to arm, then the next
  // typed letter becomes its control code (handled in onData) or the next arrow
  // tap sends Ctrl+arrow. Auto-disarms after a few seconds so it never sticks.
  const ctrlKeyBtn = keybar.querySelector<HTMLButtonElement>('[data-termkey="ctrl"]');
  const setCtrlArmed = (on: boolean): void => {
    tw.ctrlArmed = on;
    ctrlKeyBtn?.classList.toggle('armed', on);
    window.clearTimeout(tw.ctrlTimer);
    if (on) tw.ctrlTimer = window.setTimeout(() => setCtrlArmed(false), 4000);
  };

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/term?name=${encodeURIComponent(name)}&cols=${term.cols}&rows=${term.rows}`);
  ws.binaryType = 'arraybuffer';
  const enc = new TextEncoder();
  tw.ws = ws;

  ws.onopen = () => { status.textContent = 'connected'; term.focus(); };
  ws.onclose = () => { status.textContent = 'disconnected'; };
  ws.onerror = () => { status.textContent = 'conn error'; };
  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data === 'string') queueTerminalOutput(tw, ev.data);
    else queueTerminalOutput(tw, new Uint8Array(ev.data as ArrayBuffer));
  };
  term.onData((d: string) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Armed Ctrl: fold a single typed letter into its control code (a/A → ^A …).
    if (tw.ctrlArmed && d.length === 1) {
      const code = d.toUpperCase().charCodeAt(0);
      setCtrlArmed(false);
      if (code >= 0x40 && code <= 0x5f) { ws.send(enc.encode(String.fromCharCode(code & 0x1f))); return; }
    }
    ws.send(enc.encode(d));
  });

  setupTerminalClipboard(tw);
  if (!cursorAgent) setupTerminalLinks(tw);
  el.addEventListener('paste', (event: ClipboardEvent) => handleTerminalPaste(tw, event), { capture: true });
  host.addEventListener('contextmenu', (event: MouseEvent) => {
    captureTerminalSelection(tw);
    if (!tw.pendingCopySelection?.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    copyTerminalSelection(tw).catch((error: Error) => {
      tw.statusEl.textContent = 'copy failed';
      toast(error.message);
    });
  });
  host.addEventListener('dragover', (event: DragEvent) => {
    if (terminalDroppedImages(event).length) event.preventDefault();
  });
  host.addEventListener('drop', (event: DragEvent) => handleTerminalDrop(tw, event));
  imageInput.addEventListener('change', () => uploadTerminalImages(tw, imageInput.files));

  const ro = new ResizeObserver(() => doFit(tw));
  ro.observe(host);
  tw.ro = ro;

  // controls
  controls.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    const act = btn.dataset.act!;
    if (act === 'copy' || act === 'copyall') {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        captureTerminalSelection(tw);
      });
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (act === 'copy') copyTerminalSelection(tw).catch((error: Error) => {
        tw.statusEl.textContent = 'copy failed';
        toast(error.message);
      });
      else if (act === 'copyall') copyTerminalAll(tw).catch((error: Error) => {
        tw.statusEl.textContent = 'copy failed';
        toast(error.message);
      });
      else if (act === 'upload') openTerminalImagePicker(tw);
      else if (act === 'min') minimizeWindow(tw);
      else if (act === 'max') toggleMaximize(tw);
      else if (act === 'reset') resetWindow(tw);
      else if (act === 'close') closeWindow(tw);
    });
  });

  // On-screen keys (mobile): handle on pointerdown + preventDefault so the xterm
  // textarea keeps focus and the soft keyboard never dismisses between taps.
  keybar.querySelectorAll<HTMLButtonElement>('.term-key').forEach((btn) => {
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const key = btn.dataset.termkey || '';
      if (key === 'ctrl') { setCtrlArmed(!tw.ctrlArmed); tw.term?.focus?.(); return; }
      if (key === 'copy') { copyTerminalSelection(tw).catch(() => {}); tw.term?.focus?.(); return; }
      if (key === 'copyall') { copyTerminalAll(tw).catch(() => {}); tw.term?.focus?.(); return; }
      if (key === 'paste') { pasteTerminalClipboard(tw).catch(() => {}); tw.term?.focus?.(); return; }
      if (key === 'upload') { openTerminalImagePicker(tw); return; }
      const seq = (tw.ctrlArmed && TERMINAL_CTRL_SEQUENCES[key]) || TERMINAL_KEY_SEQUENCES[key];
      if (seq) sendTerminalText(tw, seq);
      if (tw.ctrlArmed) setCtrlArmed(false);
      tw.term?.focus?.();
    });
  });

  // interactions
  el.addEventListener('mousedown', () => bringToFront(tw));
  bar.addEventListener('dblclick', (e) => { if (!(e.target as HTMLElement).closest('button')) toggleMaximize(tw); });

  makeDraggable(tw, bar);
  const handle = document.createElement('div');
  handle.className = 'term-resize-handle';
  el.appendChild(handle);
  makeResizable(tw, handle);

  termWindows.set(name, tw);
  bringToFront(tw);
  setTimeout(() => doFit(tw), 70);

  return tw;
}
