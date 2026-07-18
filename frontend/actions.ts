let shellStream: EventSource | null = null;
const AGENT_IMAGE_TARGET_BYTES = 640 * 1024;
const AGENT_IMAGE_MAX_EDGES = [1400, 1200, 1024, 900, 768, 640];
const AGENT_IMAGE_QUALITIES = [0.86, 0.78, 0.70, 0.62, 0.54];
const SUPPORTED_UPLOAD_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface QuickLink {
  label: string;
  url: string;
}

let quickLinks: QuickLink[] = [];

function applyDashboardSettings(settings: DashboardSettings): void {
  const panels = { ...dashboardSettings.panels, ...(settings.panels || {}) };
  dashboardSettings = { ...settings, panels };
  const metricsPanel = document.getElementById('metricsPanel');
  const metricTemps = document.getElementById('metricTemps');
  const containersPanel = document.getElementById('containersPanel');
  const remotePanel = document.getElementById('remotePanel');
  const ciRunsPanel = document.getElementById('ciRunsPanel');
  const linksPanel = document.getElementById('linksPanel');
  const tickerStrip = document.getElementById('tickerStrip');
  const tickerBar = document.getElementById('tickerBar');
  if (metricsPanel) metricsPanel.hidden = !panels.machine;
  if (metricTemps) metricTemps.hidden = !panels.machine || !panels.machineSensors;
  if (containersPanel) containersPanel.hidden = !panels.containers;
  if (remotePanel) remotePanel.hidden = !panels.remoteHosts;
  if (ciRunsPanel) ciRunsPanel.hidden = !panels.ciRuns;
  if (linksPanel) linksPanel.hidden = !panels.links;
  if (tickerStrip) tickerStrip.hidden = !panels.tickers;
  if (tickerBar) {
    tickerBar.hidden = false;
    if (!panels.tickers) tickerBar.innerHTML = '<span class="ticker-empty">Tickers hidden</span>';
  }
  document.body.classList.toggle('expand-lists', !!panels.expandLists);
}

async function loadDashboardSettings(): Promise<void> {
  const response = await fetch('/api/ui-config', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  applyDashboardSettings(await response.json() as DashboardSettings);
}

function focusSettingsEditor(focus?: 'tickers'): void {
  const editor = document.getElementById('settingsEditor');
  if (!editor) return;
  const tickers = editor.querySelector<HTMLInputElement>('#tickerInput');
  if (focus === 'tickers' && tickers) {
    tickers.focus();
    return;
  }
  editor.querySelector<HTMLInputElement>('input[name="machine"]')?.focus();
}

function openSettingsEditor(focus?: 'tickers'): void {
  if (document.getElementById('settingsEditor')) {
    focusSettingsEditor(focus);
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'links-editor-modal settings-editor-modal';
  overlay.id = 'settingsEditor';
  const panels = dashboardSettings.panels;
  overlay.innerHTML = `<form class="links-editor-box settings-editor-box"><div class="links-editor-head"><div><h2>Configure</h2><p class="muted">Sidebar widgets and stock tickers are saved in dashboard-config.json.</p></div><button type="button" class="ghost" data-close-settings>Cancel</button></div><div class="settings-grid"><label><input type="checkbox" name="machine" ${panels.machine ? 'checked' : ''}> Machine</label><label class="settings-subsetting"><input type="checkbox" name="machineSensors" ${panels.machineSensors ? 'checked' : ''}> Thermal sensors</label><label><input type="checkbox" name="remoteHosts" ${panels.remoteHosts ? 'checked' : ''}> Remote hosts</label><label><input type="checkbox" name="containers" ${panels.containers ? 'checked' : ''}> Local containers</label><label><input type="checkbox" name="ciRuns" ${panels.ciRuns ? 'checked' : ''}> CI runs</label><label><input type="checkbox" name="links" ${panels.links ? 'checked' : ''}> Links</label><label><input type="checkbox" name="tickers" ${panels.tickers ? 'checked' : ''}> Ticker bar</label><label><input type="checkbox" name="expandLists" ${panels.expandLists ? 'checked' : ''}> Expand lists (no scrollbars)</label></div><label>Tickers</label><div class="ticker-editor"><div class="ticker-chips" id="tickerChips"></div><div class="ticker-add"><input id="tickerInput" type="text" spellcheck="false" autocapitalize="characters" placeholder="Add symbol — e.g. NVDA, TSLA, BTC-USD"><button type="button" id="addTickerBtn"><span class="ticker-add-plus">+</span> Add</button></div><p class="muted ticker-hint">Enter to add · Finnhub symbols · US stocks + crypto (BTC-USD) · max 16</p></div><div class="links-editor-actions"><button type="submit" class="primary">${icon('settings')}<span>Save config</span></button></div></form>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector<HTMLFormElement>('form')!;
  const chipsEl = overlay.querySelector<HTMLElement>('#tickerChips')!;
  const input = overlay.querySelector<HTMLInputElement>('#tickerInput')!;
  const editTickers = (dashboardSettings.tickers || []).slice();
  const renderChips = (): void => {
    chipsEl.innerHTML = editTickers.length
      ? editTickers.map((sym, i) => `<span class="ticker-chip">${escapeHtml(sym)}<button type="button" data-remove-ticker="${i}" title="Remove ${escapeHtml(sym)}" aria-label="Remove ${escapeHtml(sym)}">×</button></span>`).join('')
      : '<span class="muted ticker-empty-chip">No tickers yet — add one below</span>';
  };
  const addTicker = (): void => {
    const sym = input.value.trim().toUpperCase().replace(/[^A-Z0-9.\-_=^]/g, '').slice(0, 24);
    input.value = '';
    if (!sym) return;
    if (editTickers.includes(sym)) { toast(`${sym} already added`); return; }
    if (editTickers.length >= 16) { toast('Max 16 tickers'); return; }
    editTickers.push(sym);
    renderChips();
    input.focus();
  };
  renderChips();
  chipsEl.addEventListener('click', (event: MouseEvent) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove-ticker]');
    if (!btn) return;
    editTickers.splice(Number(btn.dataset.removeTicker), 1);
    renderChips();
  });
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTicker(); }
  });
  overlay.querySelector('#addTickerBtn')?.addEventListener('click', addTicker);
  const close = (): void => overlay.remove();
  overlay.querySelector('[data-close-settings]')?.addEventListener('click', close);
  overlay.addEventListener('mousedown', (event: MouseEvent) => { if (event.target === overlay) close(); });
  form.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    const data = new FormData(form);
    saveDashboardSettings({
      tickers: editTickers,
      panels: {
        machine: data.has('machine'),
        machineSensors: data.has('machineSensors'),
        remoteHosts: data.has('remoteHosts'),
        containers: data.has('containers'),
        ciRuns: data.has('ciRuns'),
        links: data.has('links'),
        tickers: data.has('tickers'),
        expandLists: data.has('expandLists'),
      },
    }).then(close).catch((error: Error) => toast(error.message));
  });
  requestAnimationFrame(() => focusSettingsEditor(focus));
}

async function saveDashboardSettings(settings: DashboardSettings): Promise<void> {
  const saved = await postJson<DashboardSettings>('/api/ui-config', settings);
  applyDashboardSettings(saved);
  await Promise.allSettled([loadTickers(), loadMetrics(), loadContainers(), loadRemoteHosts(), loadGhRuns(), loadLinks()]);
  toast('Config saved');
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSafeShot(): HTMLCanvasElement {
  const shells = latestShells.length ? latestShells : sessions().map((session) => ({
    name: session.name,
    label: session.label,
    running: session.running,
    cwd: '',
    command: '',
    output: '',
  }));
  const modelSessions = sessions();
  const width = Math.min(2200, Math.max(1600, Math.round(window.innerWidth || 1600)));
  const pad = 40;
  const gap = 18;
  const topH = 98;
  const tickerH = 54;
  const contentTop = pad + topH + tickerH + gap * 2;
  const sidebarW = width >= 1900 ? 370 : 330;
  const mainX = pad + sidebarW + gap;
  const mainW = width - mainX - pad;
  const tabCols = Math.max(2, Math.min(width >= 1900 ? 4 : 3, Math.floor(mainW / 330)));
  const tabRows = Math.max(1, Math.ceil(Math.max(1, modelSessions.length) / tabCols));
  const tabW = Math.floor((mainW - 28 - (tabCols - 1) * 10) / tabCols);
  const cardCols = mainW >= 1080 ? 2 : 1;
  const cardW = Math.floor((mainW - 28 - (cardCols - 1) * 14) / cardCols);
  const cardH = 206;
  const cardRows = Math.max(1, Math.ceil(shells.length / cardCols));
  const shellPanelH = 72 + tabRows * 44 + 56 + cardRows * (cardH + 14) + 28;
  const sidebarH = 860;
  const height = Math.max(980, contentTop + Math.max(shellPanelH, sidebarH) + pad);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create safe screenshot');

  const text = (value: string, x: number, y: number, maxWidth?: number): void => {
    ctx.fillText(value, x, y, maxWidth);
  };
  const panel = (x: number, y: number, w: number, h: number, title: string, subtitle = ''): void => {
    ctx.fillStyle = '#0b121a';
    roundedRect(ctx, x, y, w, h, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '700 18px Segoe UI, sans-serif';
    text(title, x + 16, y + 28, w - 32);
    if (subtitle) {
      ctx.fillStyle = '#91a7b7';
      ctx.font = '13px Segoe UI, sans-serif';
      text(subtitle, x + 16, y + 48, w - 32);
    }
  };
  const pill = (x: number, y: number, label: string, color = '#cfeaff', w = 118): void => {
    ctx.fillStyle = '#071017';
    roundedRect(ctx, x, y, w, 32, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.25)';
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '700 13px Segoe UI, sans-serif';
    text(label, x + 14, y + 21, w - 24);
  };
  const line = (x: number, y: number, w: number, color = 'rgba(145,167,183,.24)'): void => {
    ctx.fillStyle = color;
    roundedRect(ctx, x, y, w, 7, 4);
    ctx.fill();
  };
  const button = (x: number, y: number, label: string, w = 92): void => {
    ctx.fillStyle = '#0c1720';
    roundedRect(ctx, x, y, w, 30, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.25)';
    ctx.stroke();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '700 12px Segoe UI, sans-serif';
    text(label, x + 12, y + 20, w - 18);
  };

  ctx.fillStyle = '#070b10';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#0b121a';
  roundedRect(ctx, pad, pad, width - pad * 2, topH, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(139,246,255,.16)';
  ctx.stroke();
  ctx.fillStyle = '#8bf6ff';
  roundedRect(ctx, pad + 22, pad + 22, 54, 54, 10);
  ctx.fill();
  ctx.fillStyle = '#061014';
  ctx.font = '900 17px Segoe UI, sans-serif';
  text('SD', pad + 38, pad + 57);
  ctx.fillStyle = '#edf7ff';
  ctx.font = '800 28px Segoe UI, sans-serif';
  text('ShellDeck', pad + 92, pad + 42);
  ctx.fillStyle = '#91a7b7';
  ctx.font = '14px Segoe UI, sans-serif';
  text('Safe dashboard snapshot. Hostnames, paths, commands, shell names, and output are hidden.', pad + 92, pad + 66, 760);

  const running = shells.filter((shell) => shell.running).length;
  const waiting = shells.filter((shell) => shell.running && !shellWorking(shell.name)).length;
  const active = shells.filter((shell) => shell.running && shellWorking(shell.name)).length;
  const stats = [`${shells.length} shells`, `${active} active`, `${waiting} waiting`, `${Math.max(0, shells.length - running)} offline`];
  stats.forEach((value, idx) => {
    pill(width - pad - 520 + idx * 128, pad + 33, value, idx === 1 ? '#72f7c8' : idx === 2 ? '#ffc857' : '#cfeaff', 116);
  });

  ctx.fillStyle = '#0b121a';
  roundedRect(ctx, pad, pad + topH + gap, width - pad * 2, tickerH, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(139,246,255,.16)';
  ctx.stroke();
  ctx.fillStyle = '#91a7b7';
  ctx.font = '700 13px Segoe UI, sans-serif';
  text(dashboardSettings.tickers.length ? `${dashboardSettings.tickers.length} tickers configured` : 'Ticker bar empty', pad + 16, pad + topH + gap + 32, 260);
  for (let i = 0; i < Math.min(6, Math.max(3, dashboardSettings.tickers.length || 3)); i += 1) {
    const x = pad + 250 + i * 112;
    pill(x, pad + topH + gap + 11, `TICK ${i + 1}`, i % 2 ? '#ff9fb4' : '#72f7c8', 92);
  }
  button(width - pad - 130, pad + topH + gap + 12, 'Configure', 112);

  let sideY = contentTop;
  panel(pad, sideY, sidebarW, 176, 'Machine', 'Host details hidden');
  line(pad + 18, sideY + 76, sidebarW - 52, 'rgba(114,247,200,.45)');
  line(pad + 18, sideY + 116, Math.round((sidebarW - 52) * 0.68), 'rgba(139,246,255,.28)');
  ctx.fillStyle = '#91a7b7';
  ctx.font = '12px Segoe UI, sans-serif';
  text('CPU / RAM / load', pad + 18, sideY + 96);
  text('Thermal sensors summarized', pad + 18, sideY + 136);
  sideY += 190;
  panel(pad, sideY, sidebarW, 136, 'Remote Hosts', 'Server ping and containers');
  for (let i = 0; i < 2; i += 1) {
    const y = sideY + 64 + i * 32;
    ctx.fillStyle = '#050a0f';
    roundedRect(ctx, pad + 16, y, sidebarW - 32, 24, 6);
    ctx.fill();
    line(pad + 28, y + 9, sidebarW - 132, i === 0 ? 'rgba(114,247,200,.32)' : 'rgba(139,246,255,.18)');
  }
  sideY += 150;
  panel(pad, sideY, sidebarW, 166, 'Local Containers', 'Docker and Podman');
  for (let i = 0; i < 3; i += 1) {
    const y = sideY + 64 + i * 30;
    ctx.fillStyle = '#050a0f';
    roundedRect(ctx, pad + 16, y, sidebarW - 32, 22, 6);
    ctx.fill();
    line(pad + 28, y + 8, sidebarW - 112, 'rgba(139,246,255,.18)');
  }
  sideY += 180;
  panel(pad, sideY, sidebarW, 132, 'Links', 'Quick jumps');
  for (let i = 0; i < 4; i += 1) button(pad + 16 + (i % 2) * ((sidebarW - 42) / 2), sideY + 64 + Math.floor(i / 2) * 38, 'Link', (sidebarW - 50) / 2);
  sideY += 146;
  panel(pad, sideY, sidebarW, 126, 'Shell Unlock', 'Input controls hidden');
  ctx.fillStyle = '#03070b';
  roundedRect(ctx, pad + 16, sideY + 68, sidebarW - 112, 34, 7);
  ctx.fill();
  button(pad + sidebarW - 84, sideY + 70, 'Unlock', 68);

  panel(mainX, contentTop, mainW, shellPanelH, 'Shells', 'All panes side-by-side. Text and output redacted.');
  const toolsX = mainX + mainW - 514;
  ['Grid', '80', 'Follow', 'Compact', 'Refresh'].forEach((label, idx) => button(toolsX + idx * 100, contentTop + 18, label, 88));

  modelSessions.forEach((session, idx) => {
    const state = sessionRuntime(session);
    const col = idx % tabCols;
    const row = Math.floor(idx / tabCols);
    const x = mainX + 14 + col * (tabW + 10);
    const y = contentTop + 76 + row * 44;
    ctx.fillStyle = session.name === selectedSession ? '#10202b' : '#0d151f';
    roundedRect(ctx, x, y, tabW, 34, 7);
    ctx.fill();
    ctx.strokeStyle = session.name === selectedSession ? 'rgba(139,246,255,.7)' : 'rgba(255,255,255,.09)';
    ctx.stroke();
    ctx.fillStyle = '#071017';
    roundedRect(ctx, x + 10, y + 6, 34, 22, 5);
    ctx.fill();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '900 12px Cascadia Mono, monospace';
    text(String(session.badge || idx + 1).slice(0, 2).toUpperCase(), x + 20, y + 21, 22);
    ctx.fillStyle = state.dotClass === 'on' ? '#72f7c8' : state.dotClass === 'wait' ? '#ffc857' : '#ff6a7a';
    ctx.beginPath();
    ctx.arc(x + 58, y + 17, 4, 0, Math.PI * 2);
    ctx.fill();
    line(x + 70, y + 13, tabW - 96, 'rgba(207,234,255,.28)');
  });

  const actionY = contentTop + 86 + tabRows * 44;
  ctx.fillStyle = '#071017';
  roundedRect(ctx, mainX + 14, actionY, mainW - 28, 42, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(139,246,255,.16)';
  ctx.stroke();
  line(mainX + 30, actionY + 17, 230, 'rgba(207,234,255,.24)');
  button(mainX + mainW - 274, actionY + 6, 'Create', 78);
  button(mainX + mainW - 188, actionY + 6, 'Restart', 86);
  button(mainX + mainW - 94, actionY + 6, 'Attach', 76);

  const cardsTop = actionY + 56;
  shells.forEach((shell, idx) => {
    const col = idx % cardCols;
    const row = Math.floor(idx / cardCols);
    const x = mainX + 14 + col * (cardW + 14);
    const y = cardsTop + row * (cardH + 14);
    const activeShell = shell.running && shellWorking(shell.name);
    const waitingShell = shell.running && !activeShell;
    ctx.fillStyle = '#050a0f';
    roundedRect(ctx, x, y, cardW, cardH, 10);
    ctx.fill();
    ctx.strokeStyle = activeShell ? 'rgba(114,247,200,.5)' : waitingShell ? 'rgba(255,200,87,.45)' : 'rgba(139,246,255,.22)';
    ctx.stroke();
    ctx.fillStyle = '#071017';
    roundedRect(ctx, x + 1, y + 1, cardW - 2, 44, 10);
    ctx.fill();
    ctx.fillStyle = '#edf7ff';
    ctx.font = '800 17px Segoe UI, sans-serif';
    text(`Shell ${idx + 1}`, x + 18, y + 28);
    ctx.fillStyle = activeShell ? '#72f7c8' : waitingShell ? '#ffc857' : '#ff6a7a';
    ctx.beginPath();
    ctx.arc(x + cardW - 28, y + 23, 6, 0, Math.PI * 2);
    ctx.fill();
    line(x + 18, y + 62, cardW - 60, 'rgba(139,246,255,.2)');
    ctx.fillStyle = '#03070b';
    roundedRect(ctx, x + 18, y + 78, cardW - 36, 42, 7);
    ctx.fill();
    line(x + 32, y + 96, cardW - 92, 'rgba(145,167,183,.22)');
    for (let i = 0; i < 5; i += 1) {
      button(x + 18 + i * 76, y + 130, ['Send', 'Paste', 'Image', 'Mic', 'Enter'][i], 68);
    }
    ctx.fillStyle = '#03070b';
    roundedRect(ctx, x + 18, y + 166, cardW - 36, 24, 7);
    ctx.fill();
    for (let i = 0; i < 3; i += 1) {
      line(x + 32 + i * 118, y + 175, Math.min(88, cardW - 72 - i * 118), 'rgba(145,167,183,.18)');
    }
  });

  ctx.fillStyle = '#91a7b7';
  ctx.font = '13px Segoe UI, sans-serif';
  text(`Generated ${new Date().toLocaleString()} by ShellDeck safe shot`, pad, height - 24, width - pad * 2);
  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export safe screenshot'));
    }, 'image/png');
  });
}

async function writeImageToClipboard(blob: Blob): Promise<boolean> {
  const ClipboardItemCtor = (window as any).ClipboardItem;
  if (!navigator.clipboard || !ClipboardItemCtor) return false;
  await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
  return true;
}

async function createSafeShot(): Promise<void> {
  const button = document.getElementById('safeShotBtn') as HTMLButtonElement | null;
  if (button) button.disabled = true;
  try {
    const canvas = drawSafeShot();
    const blob = await canvasToPngBlob(canvas);
    const copied = await writeImageToClipboard(blob).catch(() => false);
    await postJson('/api/share-shot', { dataUrl: canvas.toDataURL('image/png') });
    toast(copied ? 'Safe shot copied and saved in share/' : 'Safe shot saved in share/');
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadTickers(): Promise<void> {
  if (!document.getElementById('tickerBar') || !dashboardSettings.panels.tickers) return;
  const response = await fetch('/api/tickers', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const payload = await response.json() as { tickers?: Ticker[]; unconfigured?: boolean };
  renderTickers(payload.tickers || [], payload.unconfigured ?? false);
}

function renderLinks(links: QuickLink[]): void {
  quickLinks = links;
  const grid = document.getElementById('linksGrid');
  if (!grid) return;
  if (!links.length) {
    grid.innerHTML = '<div class="muted links-empty">No links configured</div>';
    return;
  }
  grid.innerHTML = links
    .map((link) => `<a class="link-item" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${escapeHtml(link.label)}</span></a>`)
    .join('');
}

async function loadLinks(): Promise<void> {
  if (!document.getElementById('linksPanel') || !dashboardSettings.panels.links) return;
  const response = await fetch('/api/links', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const payload = await response.json() as { links?: QuickLink[] };
  renderLinks(payload.links || []);
}

function linkEditorText(): string {
  return quickLinks.map((link) => `${link.label}|${link.url}`).join('\n');
}

function parseLinkEditorText(text: string): QuickLink[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, ...urlParts] = line.split('|');
      return { label: (label || '').trim(), url: urlParts.join('|').trim() };
    })
    .filter((link) => link.label && link.url);
}

function openLinksEditor(): void {
  if (document.getElementById('linksEditor')) return;
  const overlay = document.createElement('div');
  overlay.className = 'links-editor-modal';
  overlay.id = 'linksEditor';
  overlay.innerHTML = `<form class="links-editor-box"><div class="links-editor-head"><div><h2>Links</h2><p class="muted">One per line: Label|https://example.com</p></div><button type="button" class="ghost" data-close-links>Cancel</button></div><textarea id="linksEditorText" spellcheck="false"></textarea><div class="links-editor-actions"><button type="submit" class="primary">Save links</button></div></form>`;
  document.body.appendChild(overlay);
  const textarea = overlay.querySelector<HTMLTextAreaElement>('#linksEditorText')!;
  textarea.value = linkEditorText();
  textarea.focus();
  const close = (): void => overlay.remove();
  overlay.querySelector('[data-close-links]')?.addEventListener('click', close);
  overlay.addEventListener('mousedown', (event: MouseEvent) => { if (event.target === overlay) close(); });
  overlay.querySelector('form')?.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    saveLinks(parseLinkEditorText(textarea.value)).then(close).catch((error: Error) => toast(error.message));
  });
}

async function saveLinks(links: QuickLink[]): Promise<void> {
  const payload = await postJson('/api/links', { links }) as { links?: QuickLink[] };
  renderLinks(payload.links || []);
  toast('Links saved');
}

// Self-service remote-host widgets (Homarr-style): add/edit/remove SSH hosts from the UI,
// persisted to remote-hosts.json server-side — no env edit or restart needed.
interface RemoteHostEntry { id: string; label: string; target: string }
let remoteHostConfig: RemoteHostEntry[] = [];

async function loadRemoteHostConfig(): Promise<void> {
  const response = await fetch('/api/remote-hosts/config', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const payload = await response.json() as { hosts?: RemoteHostEntry[] };
  remoteHostConfig = payload.hosts || [];
}

function remoteHostEditorText(): string {
  return remoteHostConfig.map((host) => `${host.id}|${host.label}|${host.target}`).join('\n');
}

function parseRemoteHostEditorText(text: string): RemoteHostEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, label, ...rest] = line.split('|');
      return { id: (id || '').trim(), label: (label || '').trim(), target: rest.join('|').trim() };
    })
    .filter((host) => host.id && host.label && host.target);
}

async function openRemoteHostsEditor(): Promise<void> {
  if (document.getElementById('remoteHostsEditor')) return;
  await loadRemoteHostConfig();
  const overlay = document.createElement('div');
  overlay.className = 'links-editor-modal';
  overlay.id = 'remoteHostsEditor';
  overlay.innerHTML = `<form class="links-editor-box"><div class="links-editor-head"><div><h2>Remote hosts</h2><p class="muted">One per line: id|Label|user@host — checked over SSH (ping + docker/podman ps)</p></div><button type="button" class="ghost" data-close-remote>Cancel</button></div><textarea id="remoteHostsEditorText" spellcheck="false" placeholder="logan|Logan GL502VS|logan-gl502vs"></textarea><div class="links-editor-actions"><button type="submit" class="primary">Save hosts</button></div></form>`;
  document.body.appendChild(overlay);
  const textarea = overlay.querySelector<HTMLTextAreaElement>('#remoteHostsEditorText')!;
  textarea.value = remoteHostEditorText();
  textarea.focus();
  const close = (): void => overlay.remove();
  overlay.querySelector('[data-close-remote]')?.addEventListener('click', close);
  overlay.addEventListener('mousedown', (event: MouseEvent) => { if (event.target === overlay) close(); });
  overlay.querySelector('form')?.addEventListener('submit', (event: Event) => {
    event.preventDefault();
    saveRemoteHosts(parseRemoteHostEditorText(textarea.value)).then(close).catch((error: Error) => toast(error.message));
  });
}

async function saveRemoteHosts(hosts: RemoteHostEntry[]): Promise<void> {
  const payload = await postJson('/api/remote-hosts/config', { hosts }) as { hosts?: RemoteHostEntry[] };
  remoteHostConfig = payload.hosts || [];
  await loadRemoteHosts();
  toast('Remote hosts saved');
}

(window as any).openRemoteHostsEditor = openRemoteHostsEditor;

async function sessionAction(endpoint: string, name: string, extra: Record<string, unknown> = {}): Promise<ApiPayload> {
  if (!shellUnlocked) throw new Error('Unlock shells first');
  const payload = await postJson(endpoint, { name, ...extra });
  toast(payload.message || 'Done');
  await refresh({ preserveUnlock: true });
  await loadShells(false);
  if (endpoint === '/api/restart') restartShellStream();
  return payload;
}

async function sendInput(name: string, submit: boolean): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  const input = inputFor(name);
  const text = input?.value || '';
  if (!text.trim()) throw new Error('Input is empty');
  if (activeDictation?.name === name) stopDictation();
  const payload = await postJson('/api/input', { name, text, submit });
  pushHistory(name, text);
  markAutoFollowUpSent(name, text);
  toast(payload.message || 'Sent');
  if (input) input.value = '';
  clearShellImages(name);
  setShellStatus(name, 'Sent. Attachments cleared.');
  updateUnlockState();
}

// Mic dictation records audio in the browser and transcribes it server-side (whisper.cpp via
// /api/transcribe). The browser-native Web Speech API is intentionally NOT used: it has no working
// recognition backend on Linux (Edge's is broken since v134; distro Chromium ships no speech key).
// First Mic click starts recording; the second click stops and transcribes into the shell input.
type ActiveDictation = {
  name: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  stopMonitor?: () => void;
};

let activeDictation: ActiveDictation | null = null;

function browserMicHelp(): string {
  if (/Edg\//.test(navigator.userAgent)) {
    return 'In Edge, open the lock icon, set Microphone to Allow for this site, then reload ShellDeck.';
  }
  return 'Allow Microphone for this site in the browser address bar, then try Mic again.';
}

// Map a getUserMedia/MediaRecorder DOMException (or our own thrown Error) to a plain-language hint.
function micErrorMessage(error: any): string {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  if (name === 'NotAllowedError' || /not.?allowed|permission|denied/i.test(message)) {
    return `Microphone is blocked. ${browserMicHelp()}`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /no .*(microphone|device|audio)/i.test(message)) {
    return 'No microphone was found. Check your input device, then try Mic again.';
  }
  if (name === 'NotReadableError') {
    return 'The microphone is in use by another app. Close it, then try Mic again.';
  }
  if (name === 'SecurityError' || /secure|https/i.test(message)) {
    return 'Microphone dictation needs HTTPS or localhost. Open ShellDeck over HTTPS or 127.0.0.1.';
  }
  return message || 'Dictation failed. Check microphone permissions for this site and try again.';
}

function reportDictationError(name: string, error: any): void {
  const message = micErrorMessage(error);
  setShellStatus(name, message);
  toast(message);
}

function appendDictationText(base: string, transcript: string): string {
  const clean = transcript.trim().replace(/\s+/g, ' ');
  if (!clean) return base;
  return `${base}${base && !/\s$/.test(base) ? ' ' : ''}${clean}`;
}

function setDictationState(name: string, listening: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('[data-dictate-shell]').forEach((button) => {
    const active = listening && button.dataset.dictateShell === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', active ? 'Stop recording and transcribe' : 'Mic dictation');
    button.title = active
      ? 'Stop recording and transcribe into this input'
      : 'Record your voice; click again to stop and transcribe into this input';
    const label = button.querySelector<HTMLElement>('.mic-label');
    if (label) label.textContent = active ? 'Stop' : 'Mic';
  });
}

function mediaDictationSupported(): boolean {
  const media = (navigator as any).mediaDevices;
  return !!(media && typeof media.getUserMedia === 'function' && typeof (window as any).MediaRecorder !== 'undefined');
}

function pickRecorderMime(): string | undefined {
  const MR = (window as any).MediaRecorder;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (MR?.isTypeSupported) {
    for (const type of candidates) {
      if (MR.isTypeSupported(type)) return type;
    }
  }
  return undefined;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read the recording'));
    reader.readAsDataURL(blob);
  });
}

// Discard any in-progress recording WITHOUT transcribing (used when switching shells or sending).
function stopDictation(): void {
  const current = activeDictation;
  activeDictation = null;
  if (!current) return;
  current.stopMonitor?.();
  setDictationState(current.name, false);
  try {
    if (current.recorder.state !== 'inactive') current.recorder.stop();
  } catch {}
  current.stream.getTracks().forEach((track) => track.stop());
}

// Stop the recorder and resolve with the combined audio Blob once the final chunk has landed.
function finalizeRecording(recorder: MediaRecorder, chunks: Blob[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    const done = (): void => {
      if (!chunks.length) { resolve(null); return; }
      resolve(new Blob(chunks, { type: chunks[0].type || recorder.mimeType || 'audio/webm' }));
    };
    recorder.addEventListener('stop', done, { once: true });
    if (recorder.state !== 'inactive') recorder.stop();
    else done();
  });
}

async function transcribeAndInsert(name: string, recorder: MediaRecorder, stream: MediaStream, chunks: Blob[]): Promise<void> {
  setShellStatus(name, 'Transcribing…');
  let blob: Blob | null = null;
  try {
    blob = await finalizeRecording(recorder, chunks);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (!blob || !blob.size) {
    setShellStatus(name, 'No audio captured. Try Mic again.');
    return;
  }
  try {
    const dataUrl = await blobToDataUrl(blob);
    const payload = await postJson('/api/transcribe', { dataUrl }) as { text?: string };
    const text = String(payload.text || '').trim();
    if (!text) {
      setShellStatus(name, 'No speech detected. Speak closer to the mic and try again.');
      return;
    }
    const input = inputFor(name);
    if (input) {
      input.value = appendDictationText(input.value, text);
      input.focus();
      updateUnlockState();
    }
    setShellStatus(name, 'Dictation added to the input.');
  } catch (error) {
    reportDictationError(name, error);
  }
}

// Stop the active recording and transcribe it — shared by the manual second click and auto-stop.
async function finishActiveDictation(): Promise<void> {
  const current = activeDictation;
  if (!current) return;
  activeDictation = null;
  current.stopMonitor?.();
  setDictationState(current.name, false);
  await transcribeAndInsert(current.name, current.recorder, current.stream, current.chunks);
}

// Watch the mic level and auto-finish once the speaker goes quiet, so dictation is a single click:
// click → speak → pause → text drops in. Returns a teardown fn. Degrades gracefully — the manual
// Mic-to-stop click always works, and on browsers without Web Audio this is a no-op.
function monitorSilence(stream: MediaStream, onDone: () => void): () => void {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return () => {};
  let ctx: AudioContext;
  try { ctx = new AC(); } catch { return () => {}; }
  ctx.resume?.();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  const SPEECH_RMS = 0.02;     // RMS above this counts as speech
  const SILENCE_MS = 1200;     // auto-stop after this much quiet, once speech was heard
  const NO_SPEECH_MS = 8000;   // give up if nothing is ever said
  const MAX_MS = 30000;        // hard safety cap on a single take
  const startedAt = Date.now();
  let lastLoud = startedAt;
  let heardSpeech = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval>;
  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try { source.disconnect(); } catch {}
    try { ctx.close(); } catch {}
  };
  timer = setInterval(() => {
    if (stopped) return;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length);
    const now = Date.now();
    if (rms > SPEECH_RMS) { lastLoud = now; if (now - startedAt > 200) heardSpeech = true; }
    const elapsed = now - startedAt;
    if ((heardSpeech && now - lastLoud > SILENCE_MS) || elapsed > MAX_MS || (!heardSpeech && elapsed > NO_SPEECH_MS)) {
      cleanup();
      onDone();
    }
  }, 120);
  return cleanup;
}

async function toggleDictation(name: string): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  // Second click on the recording shell: stop and transcribe what was captured.
  if (activeDictation?.name === name) {
    await finishActiveDictation();
    return;
  }
  stopDictation();
  if (!mediaDictationSupported()) {
    throw new Error('This browser cannot record audio for dictation. Update your browser and try again.');
  }
  if (!window.isSecureContext) {
    throw new Error('Microphone dictation needs HTTPS or localhost. Open ShellDeck over HTTPS or 127.0.0.1.');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    throw new Error(micErrorMessage(error));
  }
  const mime = pickRecorderMime();
  let recorder: MediaRecorder;
  try {
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(micErrorMessage(error));
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent): void => {
    if (event.data && event.data.size) chunks.push(event.data);
  };
  recorder.onerror = (event: any): void => {
    if (activeDictation?.recorder !== recorder) return;
    reportDictationError(name, event?.error || new Error('Recording failed'));
    stopDictation();
  };
  activeDictation = { name, recorder, stream, chunks };
  recorder.start();
  setDictationState(name, true);
  setShellStatus(name, "Recording — pause when you're done, or click Mic to stop.");
  // Auto-finish on a natural pause so it's one click; the manual stop click still works.
  activeDictation.stopMonitor = monitorSilence(stream, () => { void finishActiveDictation(); });
}

async function submitShellInput(name: string): Promise<void> {
  await sendInput(name, sendMode(name) === 'send');
}

// Send an explicit command line (not the textarea) to a shell, e.g. a recovery `codex resume <id>`.
async function runCommand(name: string, text: string): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  const payload = await postJson('/api/input', { name, text, submit: true });
  toast(payload.message || 'Sent');
}

async function sendKey(name: string, key: string): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  const payload = await postJson('/api/key', { name, key });
  toast(payload.message || 'Key sent');
}

function appendInput(value: string | undefined, name = selectedSession): void {
  const text = String(value || '');
  if (!text || !name) return;
  const input = inputFor(name);
  if (!input) return;
  input.value += (input.value && !input.value.endsWith('\n') ? '\n' : '') + text;
  input.focus();
  updateUnlockState();
}

function shellNameFromElement(element: Element | null): string {
  return element?.closest<HTMLElement>('[data-shell-card]')?.dataset.shellCard || selectedSession;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function imageNameWithExtension(name: string, extension: string): string {
  const raw = name || 'pasted-image';
  const base = raw.replace(/\.[a-z0-9]+$/i, '') || 'pasted-image';
  return `${base}.${extension}`;
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not optimize image'));
    }, type, quality);
  });
}

function renderImageCanvas(image: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not optimize image');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function optimizeImageForAgents(file: File): Promise<File> {
  if (file.size <= AGENT_IMAGE_TARGET_BYTES) return file;
  const image = await loadImageElement(file);
  let best: Blob | null = null;
  for (const maxEdge of AGENT_IMAGE_MAX_EDGES) {
    const canvas = renderImageCanvas(image, maxEdge);
    for (const quality of AGENT_IMAGE_QUALITIES) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= AGENT_IMAGE_TARGET_BYTES) {
        return new File([blob], imageNameWithExtension(file.name, 'jpg'), {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
      }
    }
  }
  if (best && best.size < file.size) {
    return new File([best], imageNameWithExtension(file.name, 'jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  }
  return file;
}

async function uploadImageForShell(
  file: File,
  name: string,
  setStatus: (text: string) => void = (text) => setShellStatus(name, text),
): Promise<ImageUploadResult> {
  if (!shellUnlocked) throw new Error('Unlock shells first');
  if (!name) throw new Error('Choose a shell first');
  if (!String(file.type || '').startsWith('image/')) throw new Error('That file is not an image');
  if (!SUPPORTED_UPLOAD_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
    throw new Error('Supported image types are PNG, JPEG, WebP, and GIF');
  }
  setStatus(file.size > AGENT_IMAGE_TARGET_BYTES ? 'Optimizing image...' : 'Saving image...');
  const uploadFile = await optimizeImageForAgents(file);
  const optimized = uploadFile !== file;
  setStatus(`Saving image (${formatBytes(uploadFile.size)})...`);
  const payload = await postJson('/api/upload-image', {
    name: uploadFile.name || 'pasted-image',
    type: uploadFile.type,
    dataUrl: await fileToDataUrl(uploadFile),
  });
  if (!payload.image) throw new Error('Image upload did not return an image');
  addShellImage(name, payload.image);
  renderShellImages(name);
  return { image: payload.image, optimized, originalBytes: file.size };
}

async function uploadImageFile(file: File, name: string): Promise<void> {
  const result = await uploadImageForShell(file, name);
  const { image, optimized, originalBytes } = result;
  appendInput(image.path, name);
  const sizeNote = optimized ? `optimized ${formatBytes(originalBytes)} -> ${formatBytes(image.bytes)}` : formatBytes(image.bytes);
  setShellStatus(name, `Inserted ${image.path} (${sizeNote})`);
  toast(optimized ? 'Optimized image path inserted' : 'Image path inserted');
}

async function handleImageFiles(files: FileList | File[] | undefined, name: string): Promise<void> {
  const images = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/'));
  for (const image of images) await uploadImageFile(image, name);
}

function pasteImageFiles(event: ClipboardEvent, name?: string): void {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (!files.length) return;
  event.preventDefault();
  handleImageFiles(files, name || shellNameFromElement(event.target instanceof Element ? event.target : null)).catch((error: Error) => {
    toast(error.message);
  });
}

function setShellStatus(name: string, text: string): void {
  const card = document.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(name)}"]`);
  const status = card?.querySelector<HTMLElement>('[data-role="status"]');
  if (status) status.textContent = text;
}

// The Hermes/Grok summary is no longer shown as one block — it feeds the per-slot titles
// (sessionWorkTitle) so each shell shows its own line. We only keep the raw text + repaint titles.
async function loadSummary(force = false): Promise<void> {
  if (!shellUnlocked) {
    latestSummaryText = '';
    summaryLoading = false;
    updateSummaryRefreshState();
    applyWorkTitles();
    return;
  }
  if (force) {
    latestSummaryText = '';
    clearShellAutoTitleCache();
  }
  summaryLoading = true;
  updateSummaryRefreshState();
  applyWorkTitles();
  try {
    const response = await fetch('/api/summary', { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json() as ApiPayload;
    if (!response.ok) throw new Error(payload.error || 'Summary failed');
    const provider = String(payload.provider || '');
    const summary = payload.summary || '';
    // Keep the last model-backed summary during transient fallback blips, but still accept local
    // summaries when no better text exists yet so default installs can populate shell titles.
    if (summary && (force || !provider.startsWith('local') || !latestSummaryText.trim())) latestSummaryText = summary;
  } finally {
    summaryLoading = false;
    updateSummaryRefreshState();
    applyWorkTitles();
    if (typeof invalidateSessionRail === 'function') invalidateSessionRail();
    if (typeof renderSessionRail === 'function') renderSessionRail();
  }
}

async function refreshSummaries(): Promise<void> {
  if (!shellUnlocked) throw new Error('Unlock shells before refreshing summaries');
  await loadSummary(true);
  toast('Summaries refreshed');
}

async function unlockShells(password: string): Promise<void> {
  const status = q('#unlockStatus');
  status.className = 'unlock-status';
  status.textContent = 'Checking second password...';
  const payload = await postJson('/api/unlock', { password });
  shellUnlocked = true;
  status.className = 'unlock-status ok';
  status.textContent = 'Unlocked. Attaching live terminal...';
  q<HTMLInputElement>('#unlockPassword').value = '';
  if (payload.model) render({ ...payload.model, unlocked: true });
  if (Array.isArray(payload.shells)) renderShells({ shells: payload.shells });
  startShellStream();
  if (selectedSession && typeof openTerminal === 'function') openTerminal(selectedSession);
  document.getElementById('shellSection')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast(payload.message || 'Unlocked');
  await Promise.allSettled([refresh({ preserveUnlock: true }), loadSummary()]);
}

async function loadShells(showLoading = true): Promise<void> {
  const grid = document.getElementById('shells') || q('#shells');
  if (!shellUnlocked) {
    const empty = document.getElementById('liveStageEmpty');
    if (empty) {
      empty.removeAttribute('hidden');
      empty.innerHTML = `<div class="unlock-cta">
      <div class="unlock-cta-lock">${icon('lock')}</div>
      <h3>Terminal locked</h3>
      <p class="muted">Enter the second password in the left Unlock panel (or below) to attach live tmux.</p>
      <form class="unlock-form" id="inlineUnlockForm">
        <input id="inlineUnlockPassword" name="password" type="password" autocomplete="one-time-code" placeholder="second password">
        <button class="primary" type="submit">${icon('unlock')}<span>Unlock</span></button>
      </form>
      <div class="unlock-status" id="inlineUnlockStatus"></div>
    </div>`;
    }
    (document.getElementById('inlineUnlockPassword') as HTMLInputElement | null)?.focus();
    setStreamState('stream locked');
    return;
  }
  if (showLoading) {
    const cached = cachedShellPreviews();
    if (cached.length) {
      setShellsLoading(true);
      renderShells({ shells: cached, fromCache: true });
      setStreamState('refreshing shells');
    }
  }
  setShellsLoading(true);
  try {
    const response = await fetch(shellEndpoint('/api/shells'), { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json() as ApiPayload;
    if (!response.ok) {
      if (response.status === 403) shellUnlocked = false;
      updateUnlockState();
      grid.innerHTML = `<div class="locked-note">${escapeHtml(payload.error || 'Shell preview failed')}. Enter the second password and try again.</div>`;
      throw new Error(payload.error || 'Shell preview failed');
    }
    renderShells({ shells: payload.shells });
  } finally {
    setShellsLoading(false);
  }
}

function startShellStream(): void {
  if (!shellUnlocked || shellStream) return;
  if (!('EventSource' in window)) {
    setStreamState('stream unavailable');
    return;
  }
  shellStream = new EventSource(shellEndpoint('/api/shells/stream'));
  shellStream.addEventListener('shells', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as ApiPayload;
    setShellsLoading(false);
    renderShells({ shells: payload.shells });
    setStreamState('live', true);
  });
  shellStream.onerror = () => setStreamState('stream reconnecting');
}

function restartShellStream(): void {
  if (shellStream) {
    shellStream.close();
    shellStream = null;
  }
  startShellStream();
}

function copyShellOutput(name: string): Promise<void> {
  const sel = window.getSelection?.();
  const selText = sel?.toString() || '';
  const card = document.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
  if (selText.trim() && card && sel?.anchorNode && card.contains(sel.anchorNode)) {
    return copyText(selText);
  }
  const pre = card?.querySelector<HTMLElement>('[data-role="output"]');
  const text = pre?.dataset.rawOutput || shellPreviewByName(name)?.output || '';
  if (!text.trim()) throw new Error('No output to copy');
  return copyText(text);
}

function toggleShellPrivacy(name: string): void {
  if (!name) return;
  if (privacyAllOn()) setPrivacyAll(false);
  const next = !shellPrivate(name);
  setShellPrivate(name, next);
  toast(next ? 'Shell text blurred' : 'Shell text visible');
}
