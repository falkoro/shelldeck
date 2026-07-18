function saveHiddenClosedShells(): void {
  localStorage.setItem(HIDDEN_CLOSED_SHELLS_KEY, JSON.stringify(Array.from(hiddenClosedShells)));
}

function coreShellName(name: string): boolean {
  return /^\d+$/.test(name) || name === 'main' || /^slot\d+$/.test(name);
}

function canRemoveClosedShell(session: SessionItem | null | undefined): boolean {
  return Boolean(session && !session.running);
}

function removeClosedShell(name: string): void {
  const session = sessionByName(name);
  if (!canRemoveClosedShell(session)) throw new Error('Only closed sessions can be removed from the dashboard');
  hideClosedShell(name);
  toast('Removed offline session');
}

function removeAllOfflineSessions(): void {
  const offline = sessions().filter((s) => !s.running);
  if (!offline.length) {
    toast('No offline sessions');
    return;
  }
  offline.forEach((s) => hideClosedShell(s.name));
  toast(`Hid ${offline.length} offline session${offline.length === 1 ? '' : 's'}`);
}

function hideClosedShell(name: string): void {
  if (!name) return;
  hiddenClosedShells.add(name);
  saveHiddenClosedShells();
  if (selectedSession === name) {
    const next = chooseSession(false);
    // chooseSession only updates the name — drive live stage + list selection fully.
    if (typeof selectSession === 'function') selectSession(next?.name || '');
  }
  if (typeof invalidateSessionRail === 'function') invalidateSessionRail();
  renderShells({ shells: latestShells });
  renderSelectedSessionActions();
  if (typeof renderSessionRail === 'function') renderSessionRail();
}

function terminateShellInDashboard(name: string): void {
  // Close any docked live terminal for this session so the stage returns to empty.
  const tw = typeof termWindows !== 'undefined' ? termWindows.get(name) : null;
  if (tw && typeof closeWindow === 'function') closeWindow(tw);
  hideClosedShell(name);
  toast('Terminated session');
}

function restoreHiddenClosedShells(): void {
  if (!hiddenClosedShells.size) return;
  hiddenClosedShells.clear();
  saveHiddenClosedShells();
  renderShells({ shells: latestShells });
  renderShellTabs();
  renderSelectedSessionActions();
  toast('Terminated sessions shown');
}

function hiddenClosedShellCount(): number {
  return hiddenClosedShells.size;
}

function unhideShell(name: string): void {
  if (!hiddenClosedShells.delete(name)) return;
  saveHiddenClosedShells();
}

function visibleSessions(modelSessions: SessionItem[]): SessionItem[] {
  let changed = false;
  const visible = modelSessions.filter((session) => {
    if (session.running && hiddenClosedShells.has(session.name)) {
      hiddenClosedShells.delete(session.name);
      changed = true;
      return true;
    }
    return !hiddenClosedShells.has(session.name);
  });
  if (changed) saveHiddenClosedShells();
  return visible;
}

function visibleShellPreviews(shells: ShellPreview[]): ShellPreview[] {
  let changed = false;
  const visible = shells.filter((shell) => {
    if (shell.running && hiddenClosedShells.has(shell.name)) {
      hiddenClosedShells.delete(shell.name);
      changed = true;
      return true;
    }
    return !hiddenClosedShells.has(shell.name);
  });
  if (changed) saveHiddenClosedShells();
  return visible;
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

