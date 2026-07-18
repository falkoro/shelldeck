type ViewMode = 'focus' | 'grid';
type Density = 'compact' | 'comfortable';
type SendMode = 'send' | 'paste';

let viewMode: ViewMode = (localStorage.getItem('sdViewMode2') as ViewMode) || 'grid';
let density: Density = (localStorage.getItem('sdDensity') as Density) || 'compact';
let terminalLines = Number(localStorage.getItem('sdTerminalLines') || '80');
let followOutput = localStorage.getItem('sdFollowOutput') !== '0';
// Side panels (Machine/Remote/Containers/Links/Unlock) are an OPTIONAL left rail. Default shown on
// this instance; productized tenants can default it hidden. Persisted per browser as sdSidebar.
let sidebarVisible = localStorage.getItem('sdSidebar') !== 'hidden';
let shellImages: Record<string, UploadedImage[]> = {};
let privateShells = new Set<string>(storageJson<string[]>('sdPrivateShells', []));
let hiddenClosedShells = new Set<string>(storageJson<string[]>(HIDDEN_CLOSED_SHELLS_KEY, []));
let historyCursor: Record<string, number> = {};
let historyDrafts: Record<string, string> = {};

function storageJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

function sendModes(): Record<string, SendMode> {
  return storageJson<Record<string, SendMode>>('sdSendModes', {});
}

function sendMode(name: string): SendMode {
  return sendModes()[name] || 'send';
}

function setSendMode(name: string, mode: SendMode): void {
  const modes = sendModes();
  modes[name] = mode;
  localStorage.setItem('sdSendModes', JSON.stringify(modes));
  markSelectedShell();
}

function commandHistory(name: string): string[] {
  return storageJson<Record<string, string[]>>('sdCommandHistory', {})[name] || [];
}

function pushHistory(name: string, text: string): void {
  const all = storageJson<Record<string, string[]>>('sdCommandHistory', {});
  const next = [text, ...(all[name] || []).filter((item) => item !== text)].slice(0, 20);
  all[name] = next;
  historyCursor[name] = -1;
  delete historyDrafts[name];
  localStorage.setItem('sdCommandHistory', JSON.stringify(all));
}

function resetHistoryNavigation(name: string): void {
  historyCursor[name] = -1;
  delete historyDrafts[name];
}

function cycleHistory(name: string, direction: number): boolean {
  const history = commandHistory(name);
  const input = inputFor(name);
  if (!input) return false;
  if (!history.length && direction > 0) return false;
  const current = historyCursor[name] ?? -1;
  if (direction < 0 && current < 0) return false;
  if (direction > 0 && current < 0) historyDrafts[name] = input.value;
  const next = Math.max(-1, Math.min(history.length - 1, current + direction));
  historyCursor[name] = next;
  input.value = next >= 0 ? history[next] : (historyDrafts[name] || '');
  if (next < 0) delete historyDrafts[name];
  updateUnlockState();
  return true;
}

function applyPrefs(): void {
  document.body.classList.toggle('density-compact', density === 'compact');
  document.body.classList.toggle('density-comfortable', density === 'comfortable');
  document.body.classList.toggle('view-grid', viewMode === 'grid');
  document.body.classList.toggle('view-focus', viewMode === 'focus');
  // Live-center layout may omit grid/density/follow controls — keep applyPrefs safe either way.
  const viewToggle = document.getElementById('viewToggle') as HTMLButtonElement | null;
  if (viewToggle) {
    viewToggle.innerHTML = viewMode === 'focus' ? `${icon('focus')}<span>Focus</span>` : `${icon('grid')}<span>Grid</span>`;
    viewToggle.title = viewMode === 'focus'
      ? 'Focus: one shell at a time — click for Grid (side-by-side)'
      : 'Grid: all shells side-by-side — drag ⋮⋮ grips to reorder — click for Focus';
    viewToggle.classList.toggle('active', viewMode === 'grid');
  }
  const densityToggle = document.getElementById('densityToggle') as HTMLButtonElement | null;
  if (densityToggle) {
    densityToggle.innerHTML = `${icon('rows')}<span>${density === 'compact' ? 'Compact' : 'Comfort'}</span>`;
    densityToggle.title = density === 'compact' ? 'Density: compact — tap for comfort' : 'Density: comfort — tap for compact';
  }
  const followToggle = document.getElementById('followToggle') as HTMLButtonElement | null;
  if (followToggle) {
    followToggle.classList.toggle('active', followOutput);
    followToggle.innerHTML = `${icon('follow')}<span>${followOutput ? 'Follow' : 'Paused'}</span>`;
    followToggle.title = followOutput ? 'Output follow: on' : 'Output follow: paused';
  }
  const lineSel = document.getElementById('lineCount') as HTMLSelectElement | null;
  if (lineSel) {
    lineSel.value = String(terminalLines);
    lineSel.title = 'Recent output lines shown in each shell preview';
    if (lineSel.dataset.labeled !== '1') {
      Array.from(lineSel.options).forEach((opt) => { opt.textContent = `${opt.value} lines`; });
      lineSel.dataset.labeled = '1';
    }
  }
  document.getElementById('shells')?.classList.toggle('focus-mode', viewMode === 'focus');
  applySidebar();
}

// Show/hide the optional side rail. The body class drives the layout (see app.css); the top-bar
// Panels button reflects state. Null-safe so it can run before the button is injected.
function applySidebar(): void {
  document.body.classList.toggle('sidebar-hidden', !sidebarVisible);
  const btn = document.getElementById('sidebarToggle');
  if (btn) {
    btn.classList.toggle('active', sidebarVisible);
    btn.title = sidebarVisible ? 'Monitor rail shown — click to hide' : 'Monitor rail hidden — click to show';
  }
  const collapseBtn = document.getElementById('sidebarCollapseBtn');
  if (collapseBtn) {
    collapseBtn.title = 'Collapse sidebar';
    collapseBtn.setAttribute('aria-label', 'Collapse sidebar');
  }
  const expandBtn = document.getElementById('sidebarExpandBtn');
  if (expandBtn) {
    expandBtn.hidden = sidebarVisible;
    expandBtn.title = 'Expand sidebar';
    expandBtn.setAttribute('aria-label', 'Expand sidebar');
  }
}

function toggleSidebar(): void {
  sidebarVisible = !sidebarVisible;
  localStorage.setItem('sdSidebar', sidebarVisible ? 'shown' : 'hidden');
  applySidebar();
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  localStorage.setItem('sdViewMode2', mode);
  applyPrefs();
  markSelectedShell();
  scheduleShellGridFit();
  if (mode === 'grid') {
    toast('Grid: all shells side-by-side. Drag the ⋮⋮ grip onto another shell to reorder.');
  } else {
    toast('Focus: one shell at a time. Press g or click Grid to see all shells.');
  }
}

function toggleDensity(): void {
  density = density === 'compact' ? 'comfortable' : 'compact';
  localStorage.setItem('sdDensity', density);
  applyPrefs();
}

function setTerminalLines(value: number): void {
  terminalLines = [80, 200, 500].includes(value) ? value : 80;
  localStorage.setItem('sdTerminalLines', String(terminalLines));
  restartShellStream();
  loadShells(false).catch((error: Error) => toast(error.message));
  applyPrefs();
}

function shellEndpoint(base: string): string {
  return `${base}?lines=${encodeURIComponent(String(terminalLines))}`;
}

function addShellImage(name: string, image: UploadedImage): void {
  shellImages[name] = [image, ...(shellImages[name] || [])].slice(0, 5);
  renderShellImages(name);
}

function removeShellImage(name: string, path: string): void {
  shellImages[name] = (shellImages[name] || []).filter((image) => image.path !== path);
  renderShellImages(name);
}

function clearShellImages(name: string): void {
  delete shellImages[name];
  renderShellImages(name);
}

function shellPrivate(name: string): boolean {
  return privateShells.has(name);
}

function setShellPrivate(name: string, on: boolean): void {
  if (on) privateShells.add(name);
  else privateShells.delete(name);
  localStorage.setItem('sdPrivateShells', JSON.stringify(Array.from(privateShells)));
  const card = document.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(name)}"]`);
  if (card) applyShellPrivacy(card, name);
}

function applyShellPrivacy(card: HTMLElement, name: string): void {
  const on = shellPrivate(name) || privacyAllOn();
  card.classList.toggle('privacy-blur', on);
  const button = card.querySelector<HTMLButtonElement>('[data-privacy-shell]');
  if (!button) return;
  button.classList.toggle('active', on);
  button.title = on ? 'Show this shell text' : 'Blur this shell text';
  button.setAttribute('aria-label', on ? 'Show shell text' : 'Blur shell text');
}

