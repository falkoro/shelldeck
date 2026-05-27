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
  localStorage.setItem('sdCommandHistory', JSON.stringify(all));
}

function cycleHistory(name: string, direction: number): void {
  const history = commandHistory(name);
  if (!history.length) return;
  const current = historyCursor[name] ?? -1;
  const next = Math.max(-1, Math.min(history.length - 1, current + direction));
  historyCursor[name] = next;
  const input = inputFor(name);
  if (input) input.value = next >= 0 ? history[next] : '';
}

function applyPrefs(): void {
  document.body.classList.toggle('density-compact', density === 'compact');
  document.body.classList.toggle('density-comfortable', density === 'comfortable');
  q<HTMLButtonElement>('#viewToggle').innerHTML = viewMode === 'focus' ? `${icon('focus')}<span>Focus</span>` : `${icon('grid')}<span>Grid</span>`;
  q<HTMLButtonElement>('#densityToggle').innerHTML = `${icon('rows')}<span>${density === 'compact' ? 'Compact' : 'Comfort'}</span>`;
  q<HTMLButtonElement>('#followToggle').classList.toggle('active', followOutput);
  q<HTMLButtonElement>('#followToggle').innerHTML = `${icon('follow')}<span>${followOutput ? 'Follow' : 'Paused'}</span>`;
  q<HTMLSelectElement>('#lineCount').value = String(terminalLines);
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
