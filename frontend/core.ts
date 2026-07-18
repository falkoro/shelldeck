// Split from core-orig.ts L547-763
function selectSession(name: string | undefined): void {
  selectedSession = String(name || '');
  if (selectedSession) localStorage.setItem('sdSelectedSession', selectedSession);
  if (selectedSession && typeof clearSessionUnread === 'function') clearSessionUnread(selectedSession);
  renderShellTabs();
  if (typeof renderSessionRail === 'function') renderSessionRail();
  renderSelectedSessionActions();
  markSelectedShell();
  updateUnlockState();
  // Live-center: attach real tmux only when the session is actually running (avoid WSS 400 on offline).
  if (selectedSession && shellUnlocked && typeof openTerminal === 'function' && targetReady(selectedSession)) {
    openTerminal(selectedSession);
  } else {
    showLiveStageIdle(selectedSession);
  }
}

function showLiveStageIdle(name: string): void {
  // Hide any docked terminal while showing the offline / empty prompt.
  if (typeof termWindows !== 'undefined') {
    termWindows.forEach((tw: TermWindow) => {
      if (tw.el.classList.contains('term-docked')) {
        tw.el.hidden = true;
        tw.minimized = true;
      }
    });
  }
  const empty = document.getElementById('liveStageEmpty');
  if (empty) empty.removeAttribute('hidden');
  const title = document.getElementById('liveStageTitle');
  const hint = document.getElementById('liveStageHint');
  if (!name) {
    if (title) title.textContent = 'Live terminal';
    if (hint) hint.textContent = 'Select a session on the left to attach.';
    return;
  }
  if (title) title.textContent = `${name} · offline`;
  if (hint) hint.textContent = shellUnlocked
    ? 'Session is not running. Use New tmux (toolbar) to start it, then it attaches here.'
    : 'Unlock shells first, then start or select a running session.';
}

function inputFor(name: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`[data-command="${selectorEscape(name)}"]`);
}

function focusComposer(name: string): void {
  const input = inputFor(name);
  if (input && !input.disabled) input.focus({ preventScroll: true });
}

function shellPreviewByName(name: string): ShellPreview | null {
  return latestShells.find((shell) => shell.name === name) || null;
}

function saveShellPreviewCache(shells: ShellPreview[]): void {
  if (!shells.length) return;
  try {
    localStorage.setItem(SHELL_PREVIEW_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), shells }));
  } catch {}
}

function cachedShellPreviews(): ShellPreview[] {
  const cached = storageJson<{ savedAt?: number; shells?: ShellPreview[] }>(SHELL_PREVIEW_CACHE_KEY, {});
  if (!Array.isArray(cached.shells) || !cached.shells.length) return [];
  if (!cached.savedAt || Date.now() - cached.savedAt > SHELL_PREVIEW_CACHE_MAX_AGE_MS) return [];
  return cached.shells.filter((shell) => shell && typeof shell.name === 'string');
}

function setShellsLoading(loading: boolean): void {
  shellsLoading = loading;
  document.body.classList.toggle('shells-refreshing', loading);
  document.querySelectorAll<HTMLElement>('[data-shell-card]').forEach((card) => {
    card.classList.toggle('shell-refreshing', loading);
  });
}

// "Running" = the pane is actively changing. Claude Code / Codex animate a spinner with a
// per-second elapsed timer while a turn runs, so consecutive captures differ; an idle prompt is
// static. This beats scanning for "esc to interrupt", which also matched the visible conversation
// (false running) and missed turns whose captured frame lacked the exact phrase (false waiting).
const shellActivity: Record<string, { out: string; at: number }> = {};

function noteShellActivity(name: string, output: string): void {
  const prev = shellActivity[name];
  if (!prev || prev.out !== output) {
    shellActivity[name] = { out: output, at: Date.now() };
    // Fresh output on a non-selected shell → unread badge on the rail.
    if (name && name !== selectedSession && typeof markSessionUnread === 'function') {
      markSessionUnread(name);
    }
  }
}

function shellWorking(name: string): boolean {
  const a = shellActivity[name];
  return !!a && Date.now() - a.at < 3500;
}

function targetReady(name: string): boolean {
  const shell = shellPreviewByName(name);
  const session = sessionByName(name);
  return Boolean(shellUnlocked && name && (shell?.running || session?.running));
}

function createReady(name: string): boolean {
  const session = sessionByName(name);
  return Boolean(shellUnlocked && session && !session.running && session.family !== 'custom');
}

function setAccessState(unlocked: boolean): void {
  const el = q('#accessState');
  el.className = unlocked ? 'pill access-pill on' : 'pill access-pill';
  el.textContent = unlocked ? 'shells unlocked' : 'shells locked';
}

function setStreamState(text: string, live = false): void {
  const el = q('#streamState');
  el.className = live ? 'pill stream-pill on' : 'pill stream-pill';
  el.textContent = text;
  scheduleShellGridFit();
}

function formatTopbarClock(now = new Date()): string {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function applyBrandIcon(): void {
  const img = document.getElementById('brandIcon') as HTMLImageElement | null;
  if (!img) return;
  img.src = localStorage.getItem(BRAND_ICON_KEY) || DEFAULT_BRAND_ICON;
}

function readBrandIconFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read icon file'));
    reader.readAsDataURL(file);
  });
}

async function changeBrandIcon(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file');
  if (file.size > BRAND_ICON_MAX_BYTES) throw new Error('Icon must be under 512 KB');
  const dataUrl = await readBrandIconFile(file);
  if (!dataUrl) throw new Error('Could not read icon file');
  localStorage.setItem(BRAND_ICON_KEY, dataUrl);
  applyBrandIcon();
}

function resetBrandIcon(): void {
  localStorage.removeItem(BRAND_ICON_KEY);
  applyBrandIcon();
}

function updateTopbarClock(): void {
  const el = document.getElementById('topbarClock');
  if (!el) return;
  const next = formatTopbarClock();
  if (el.textContent !== next) el.textContent = next;
}

function startTopbarClock(): void {
  updateTopbarClock();
  if ((window as any).__sdTopbarClock) return;
  (window as any).__sdTopbarClock = window.setInterval(updateTopbarClock, 1000);
}

function updateSummaryRefreshState(): void {
  const button = document.getElementById('refreshSummaryBtn') as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = !shellUnlocked || summaryLoading;
  button.classList.toggle('active', summaryLoading);
  button.innerHTML = `${icon('summary')}<span>${summaryLoading ? 'Summarising' : 'Summary'}</span>`;
}

function updateUnlockState(): void {
  document.body.classList.toggle('shells-locked', !shellUnlocked);
  q<HTMLElement>('#unlockPanel').style.display = shellUnlocked ? 'none' : '';
  q<HTMLButtonElement>('#refreshShellsTopBtn').disabled = !shellUnlocked;
  updateSummaryRefreshState();
  document.querySelectorAll<HTMLButtonElement>('[data-send-shell]').forEach((button) => {
    button.disabled = !targetReady(button.dataset.sendShell || '');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-paste-shell]').forEach((button) => {
    button.disabled = !targetReady(button.dataset.pasteShell || '');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-add-image]').forEach((button) => {
    button.disabled = !targetReady(button.dataset.addImage || '');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-dictate-shell]').forEach((button) => {
    button.disabled = !targetReady(button.dataset.dictateShell || '');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((button) => {
    button.disabled = !targetReady(button.dataset.shell || '');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach((button) => {
    button.disabled = !targetReady(button.dataset.stop || '');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-create]').forEach((button) => {
    button.disabled = !createReady(button.dataset.create || '');
  });
  document.querySelectorAll<HTMLTextAreaElement>('[data-command]').forEach((input) => {
    input.disabled = !targetReady(input.dataset.command || '');
  });
  setAccessState(shellUnlocked);
}

function updateLastActivityTimes(): void {
  // Live-tick the relative last-activity labels so "3m ago" becomes "4m ago" without full refresh.
  document.querySelectorAll<HTMLElement>('[data-act-epoch]').forEach((el) => {
    const raw = el.getAttribute('data-act-epoch');
    const ep = raw ? parseInt(raw, 10) : 0;
    if (ep > 0) {
      const rel = fmtTime(ep);
      if (el.textContent !== rel) el.textContent = rel;
    }
  });
  renderShellTabs();
  renderSelectedSessionActions();
}

function syncTargetUi(): void {
  chooseSession(false);
  updateUnlockState();
}

async function postJson<T = ApiPayload>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Codex-Action': '1' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & ApiPayload;
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}
