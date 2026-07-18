// Client state for rail extras: unread, multi-select, quiet mode, color tags.

const SESSION_COLORS_KEY = 'sdSessionColors';
const QUIET_MODE_KEY = 'sdQuietMode';
const SESSION_COLOR_PALETTE = ['cyan', 'green', 'amber', 'red', 'violet', 'slate'] as const;
type SessionColor = (typeof SESSION_COLOR_PALETTE)[number];

let unreadSessions = new Set<string>();
let multiSelectMode = false;
let multiSelected = new Set<string>();
let quietMode = localStorage.getItem(QUIET_MODE_KEY) === '1';

function sessionColors(): Record<string, string> {
  return storageJson<Record<string, string>>(SESSION_COLORS_KEY, {});
}

function setSessionColor(name: string, color: string | null): void {
  const all = sessionColors();
  if (!color || !SESSION_COLOR_PALETTE.includes(color as SessionColor)) {
    delete all[name];
  } else {
    all[name] = color;
  }
  localStorage.setItem(SESSION_COLORS_KEY, JSON.stringify(all));
}

function sessionColor(name: string): string {
  return sessionColors()[name] || '';
}

function cycleSessionColor(name: string): string {
  const current = sessionColor(name);
  const idx = SESSION_COLOR_PALETTE.indexOf(current as SessionColor);
  const next = idx < 0 ? SESSION_COLOR_PALETTE[0] : SESSION_COLOR_PALETTE[(idx + 1) % SESSION_COLOR_PALETTE.length];
  // After last color, clear tag
  if (idx === SESSION_COLOR_PALETTE.length - 1) {
    setSessionColor(name, null);
    return '';
  }
  setSessionColor(name, next);
  return next;
}

function markSessionUnread(name: string): void {
  if (!name || name === selectedSession) return;
  unreadSessions.add(name);
}

function clearSessionUnread(name: string): void {
  unreadSessions.delete(name);
}

function isSessionUnread(name: string): boolean {
  return unreadSessions.has(name);
}

function noteUnreadFromShells(shells: ShellPreview[]): void {
  for (const shell of shells) {
    if (!shell.running) continue;
    // shellWorking is true when output just changed — treat as unread if not focused.
    if (typeof shellWorking === 'function' && shellWorking(shell.name)) {
      markSessionUnread(shell.name);
    }
  }
}

function setMultiSelectMode(on: boolean): void {
  multiSelectMode = on;
  if (!on) multiSelected.clear();
  document.body.classList.toggle('rail-multiselect', on);
  if (typeof invalidateSessionRail === 'function') invalidateSessionRail();
  if (typeof renderSessionRail === 'function') renderSessionRail();
}

function toggleMultiSelectMode(): void {
  setMultiSelectMode(!multiSelectMode);
}

function isMultiSelectMode(): boolean {
  return multiSelectMode;
}

function toggleMultiSelected(name: string): void {
  if (multiSelected.has(name)) multiSelected.delete(name);
  else multiSelected.add(name);
}

function isMultiSelected(name: string): boolean {
  return multiSelected.has(name);
}

function multiSelectedNames(): string[] {
  return Array.from(multiSelected);
}

function clearMultiSelected(): void {
  multiSelected.clear();
}

function applyQuietMode(): void {
  document.body.classList.toggle('quiet-mode', quietMode);
  const btn = document.getElementById('quietModeBtn');
  if (btn) {
    btn.classList.toggle('active', quietMode);
    btn.title = quietMode
      ? 'Quiet mode on — click to show panels and chrome'
      : 'Quiet mode — hide side panels for a clean focus layout';
    btn.setAttribute('aria-pressed', quietMode ? 'true' : 'false');
  }
  if (quietMode) {
    // Hide panels rail; keep session rail.
    document.body.classList.add('sidebar-hidden');
    if (typeof viewMode !== 'undefined' && viewMode !== 'focus' && typeof setViewMode === 'function') {
      /* keep current view — quiet only hides panels */
    }
  } else if (typeof applySidebar === 'function') {
    applySidebar();
  }
}

function setQuietMode(on: boolean): void {
  quietMode = on;
  localStorage.setItem(QUIET_MODE_KEY, on ? '1' : '0');
  applyQuietMode();
}

function toggleQuietMode(): void {
  setQuietMode(!quietMode);
  toast(quietMode ? 'Quiet mode on' : 'Quiet mode off');
}

function isQuietMode(): boolean {
  return quietMode;
}
