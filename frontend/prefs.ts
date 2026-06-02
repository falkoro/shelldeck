type ViewMode = 'focus' | 'grid';
type Density = 'compact' | 'comfortable';
type SendMode = 'send' | 'paste';

let viewMode: ViewMode = (localStorage.getItem('sdViewMode2') as ViewMode) || 'grid';
let density: Density = (localStorage.getItem('sdDensity') as Density) || 'compact';
let terminalLines = Number(localStorage.getItem('sdTerminalLines') || '80');
let followOutput = localStorage.getItem('sdFollowOutput') !== '0';
let shellImages: Record<string, UploadedImage[]> = {};
let clearedOutputs: Record<string, string> = {};
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
  const viewToggle = q<HTMLButtonElement>('#viewToggle');
  viewToggle.innerHTML = viewMode === 'focus' ? `${icon('focus')}<span>Focus</span>` : `${icon('grid')}<span>Grid</span>`;
  viewToggle.title = viewMode === 'focus' ? 'View: focus — tap for grid' : 'View: grid — tap for focus';
  const densityToggle = q<HTMLButtonElement>('#densityToggle');
  densityToggle.innerHTML = `${icon('rows')}<span>${density === 'compact' ? 'Compact' : 'Comfort'}</span>`;
  densityToggle.title = density === 'compact' ? 'Density: compact — tap for comfort' : 'Density: comfort — tap for compact';
  const followToggle = q<HTMLButtonElement>('#followToggle');
  followToggle.classList.toggle('active', followOutput);
  followToggle.innerHTML = `${icon('follow')}<span>${followOutput ? 'Follow' : 'Paused'}</span>`;
  followToggle.title = followOutput ? 'Output follow: on' : 'Output follow: paused';
  const lineSel = q<HTMLSelectElement>('#lineCount');
  lineSel.value = String(terminalLines);
  lineSel.title = 'Recent output lines shown in each shell preview';
  if (lineSel.dataset.labeled !== '1') {
    Array.from(lineSel.options).forEach((opt) => { opt.textContent = `${opt.value} lines`; });
    lineSel.dataset.labeled = '1';
  }
  q('#authState').textContent = 'dashboard signed in';
  q('#shells').classList.toggle('focus-mode', viewMode === 'focus');
}

function setViewMode(mode: ViewMode): void {
  viewMode = mode;
  localStorage.setItem('sdViewMode2', mode);
  applyPrefs();
  markSelectedShell();
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

// --- Shell card order persistence ---
// Persist the preferred sort order of shell cards so drag-to-reorder survives refresh.
function shellOrder(): string[] {
  return storageJson<string[]>('sdShellOrder', []);
}

function saveShellOrder(names: string[]): void {
  localStorage.setItem('sdShellOrder', JSON.stringify(names));
}

// Merge known shells into the saved order: keep any previously-seen names in their
// saved position, append newly-seen names at the end, and drop stale ones.
function orderedShellList(shells: ShellPreview[]): ShellPreview[] {
  const saved = shellOrder();
  const nameSet = new Set(shells.map((s) => s.name));
  // Remove names from saved list that are no longer in the shell list
  const validSaved = saved.filter((n) => nameSet.has(n));
  // Add shells that are in the current list but not yet in saved order
  const newNames = shells.map((s) => s.name).filter((n) => !validSaved.includes(n));
  const merged = [...validSaved, ...newNames];
  // Update the saved order
  saveShellOrder(merged);
  // Reorder shells array to match
  const byName: Record<string, ShellPreview> = {};
  shells.forEach((s) => { byName[s.name] = s; });
  return merged.map((n) => byName[n]).filter(Boolean);
}

// --- Shell card size persistence ---
interface CardSize { w: number; h: number }

function shellCardSizes(): Record<string, CardSize> {
  return storageJson<Record<string, CardSize>>('sdShellSizes', {});
}

function saveShellCardSize(name: string, size: CardSize): void {
  const sizes = shellCardSizes();
  sizes[name] = size;
  localStorage.setItem('sdShellSizes', JSON.stringify(sizes));
}

function loadShellCardSize(name: string): CardSize | null {
  const s = shellCardSizes()[name];
  if (s && typeof s.w === 'number' && typeof s.h === 'number') return s;
  return null;
}

function resetShellCardSize(name: string): void {
  const sizes = shellCardSizes();
  delete sizes[name];
  localStorage.setItem('sdShellSizes', JSON.stringify(sizes));
}

// --- Shell card drag-to-reorder threshold ---
const DRAG_REORDER_THRESHOLD = 8;
