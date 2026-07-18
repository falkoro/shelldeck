interface SessionItem {
  name: string;
  label: string;
  family: string;
  alias: string;
  badge: string;
  command: string;
  sshCommand?: string;
  running: boolean;
  windows: number;
  attached: number;
  created: number | null;
  activity: number | null;
}

interface DashboardModel {
  hostname: string;
  user: string;
  now: string;
  sessions: SessionItem[];
  unlocked?: boolean;
}

interface ShellPreview {
  name: string;
  label: string;
  running: boolean;
  cwd: string;
  command: string;
  output: string;
  updatedAt?: string;
}

interface PanelSettings {
  machine: boolean;
  machineSensors: boolean;
  containers: boolean;
  remoteHosts: boolean;
  ciRuns: boolean;
  links: boolean;
  tickers: boolean;
  expandLists: boolean;
}

interface DashboardSettings {
  tickers: string[];
  panels: PanelSettings;
}

interface ShellAutoTitleEntry {
  title: string;
  cachedAt: number;
  created: number | null;
}

interface ApiPayload {
  ok?: boolean;
  error?: string;
  message?: string;
  sessionName?: string;
  model?: DashboardModel;
  shells?: ShellPreview[];
  summary?: string;
  provider?: string;
  generatedAt?: string;
  image?: UploadedImage;
  shot?: { path: string; bytes: number };
}

interface UploadedImage {
  name: string;
  path: string;
  bytes: number;
  type: string;
  url: string;
}

interface ImageUploadResult {
  image: UploadedImage;
  optimized: boolean;
  originalBytes: number;
}

interface RenderOptions {
  preserveUnlock?: boolean;
}

const initialModel = JSON.parse(document.getElementById('initial-model')?.textContent || '{}') as DashboardModel;
let currentModel: DashboardModel = initialModel;
let latestShells: ShellPreview[] = [];
let latestSummaryText = '';
let summaryLoading = false;
let shellsLoading = false;
let dashboardSettings: DashboardSettings = {
  tickers: [],
  panels: { machine: true, machineSensors: true, containers: true, remoteHosts: true, ciRuns: false, links: true, tickers: true, expandLists: false },
};
const SHELL_LABEL_ALIASES_KEY = 'sdShellLabelAliases';
const HOST_ALIAS_KEY = 'sdHostAlias';
const BRAND_ICON_KEY = 'sdBrandIcon';
const DEFAULT_BRAND_ICON = '/assets/shelldeck-logo.svg';
const BRAND_ICON_MAX_BYTES = 512 * 1024;
const SHELL_AUTO_TITLES_KEY = 'sdShellAutoTitles';
const SHELL_PREVIEW_CACHE_KEY = 'sdShellPreviewCache';
const HIDDEN_CLOSED_SHELLS_KEY = 'sdHiddenClosedShells';
const SHELL_PREVIEW_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SHELL_AUTO_TITLE_TTL_MS = 2 * 60 * 60 * 1000;
const SHELLBOX_TITLE_WORDS = 3;
const AUTO_FOLLOW_UP_MAX_CHARS = 280;
const autoFollowUpDrafts: Record<string, string> = {};
const autoFollowUpSentDrafts: Record<string, string> = {};

// Pull the one-liner for a given session out of the Current Work summary (lines like
// "- main: ...", "main (claude): ...", "**slot1** — ..."), to use as a per-slot title.
function sessionWorkTitle(session: string): string {
  const cached = shellAutoTitles();
  for (const raw of latestSummaryText.split('\n')) {
    const head = raw.trim().replace(/^[\-*•\s]+/, '').replace(/\*\*/g, '');
    // Escape regex metacharacters: tmux/session names can contain them (e.g. with
    // DASHBOARD_SHOW_UNKNOWN_SESSIONS), and an unescaped name throws a SyntaxError that
    // would abort renderShellTabs/applyWorkTitles on every refresh tick.
    const safe = session.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`^${safe}\\b`, 'i').test(head)) continue;
    const after = head.slice(session.length);
    const sep = after.match(/[:–—]|\s-\s/);
    const text = sep && sep.index !== undefined ? after.slice(sep.index + sep[0].length) : after;
    const title = text.replace(/^[\s:\-–—)]+/, '').trim();
    if (title) {
      cacheShellAutoTitle(session, title, cached);
      return title;
    }
  }
  return cached[session] || '';
}

function sessionWorkBrief(session: string, words = 10): string {
  const title = sessionWorkTitle(session);
  if (!title) return '';
  return title.split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}
let shellUnlocked = Boolean(initialModel.unlocked);
let selectedSession = localStorage.getItem('sdSelectedSession') || '';
let pendingImageTarget = '';

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const imageFile = q<HTMLInputElement>('#imageFile');

function selectorEscape(value: string): string {
  return CSS.escape(value);
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ICONS: Record<string, string> = {
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  summary: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  restart: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  paste: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  enter: '<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  stop: '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  grip: '<circle cx="9" cy="6" r="1.25"/><circle cx="15" cy="6" r="1.25"/><circle cx="9" cy="12" r="1.25"/><circle cx="15" cy="12" r="1.25"/><circle cx="9" cy="18" r="1.25"/><circle cx="15" cy="18" r="1.25"/>',
  rows: '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/>',
  follow: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>',
  camera: '<path d="M14.5 4 13 2H7L5.5 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-6.5Z"/><circle cx="12" cy="12" r="3.5"/><path d="M20 8h.01"/>',
  settings: '<path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.36.45.7.6 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-.5 1Z"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>',
  chevronLeft: '<polyline points="15 18 9 12 15 6"/>',
  chevronRight: '<polyline points="9 18 15 12 9 6"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  bot: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M8 20v2"/><path d="M16 20v2"/>',
  sessions: '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/>',
};

function icon(name: string): string {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function fmtTime(epoch: number | null | undefined): string {
  // Relative "last activity" time for the sessions dashboard (code.falkinator.org).
  // Much more useful than absolute timestamps for monitoring long-running agents.
  if (!epoch) return 'never';
  const secs = Math.floor(Date.now() / 1000) - epoch;
  if (secs < 45) return 'just now';
  if (secs < 90) return '1m ago';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function toast(text: string): void {
  const el = q('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

function fallbackCopyText(text: string): boolean {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const fallback = document.createElement('textarea');
  fallback.value = text;
  fallback.setAttribute('readonly', 'true');
  fallback.style.position = 'fixed';
  fallback.style.top = '0';
  fallback.style.left = '-9999px';
  fallback.style.width = '1px';
  fallback.style.height = '1px';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.focus({ preventScroll: true });
  fallback.select();
  fallback.setSelectionRange(0, fallback.value.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    fallback.remove();
    previousFocus?.focus({ preventScroll: true });
  }
  return copied;
}

async function copyText(text: string): Promise<void> {
  let clipboardError = '';
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
      return;
    } catch (error) {
      clipboardError = error instanceof Error ? error.message : String(error);
    }
  }
  if (fallbackCopyText(text)) {
    toast('Copied');
    return;
  }
  const reason = clipboardError ? ` (${clipboardError})` : '';
  throw new Error(`Clipboard copy blocked by the browser${reason}`);
}

function sessions(): SessionItem[] {
  return visibleSessions(currentModel.sessions || []);
}

function shellLabelAliases(): Record<string, string> {
  return storageJson<Record<string, string>>(SHELL_LABEL_ALIASES_KEY, {});
}

function shellCreatedAt(name: string): number | null {
  return sessionByName(name)?.created ?? null;
}

function shellAutoTitleStore(): Record<string, string | ShellAutoTitleEntry> {
  return storageJson<Record<string, string | ShellAutoTitleEntry>>(SHELL_AUTO_TITLES_KEY, {});
}

function shellAutoTitles(): Record<string, string> {
  const store = shellAutoTitleStore();
  const titles: Record<string, string> = {};
  const nextStore: Record<string, ShellAutoTitleEntry> = {};
  const now = Date.now();
  let changed = false;

  Object.entries(store).forEach(([session, value]) => {
    const entry: ShellAutoTitleEntry = typeof value === 'string'
      ? { title: value, cachedAt: now, created: shellCreatedAt(session) }
      : value;
    const title = entry.title?.replace(/\s+/g, ' ').trim();
    const currentCreated = shellCreatedAt(session);
    const cachedCreated = entry.created ?? currentCreated;
    const expired = !entry.cachedAt || now - entry.cachedAt > SHELL_AUTO_TITLE_TTL_MS;
    const restarted = entry.created !== null && entry.created !== undefined && currentCreated !== null && entry.created !== currentCreated;
    if (!title || expired || restarted) {
      changed = true;
      return;
    }
    const normalized = { title, cachedAt: entry.cachedAt, created: cachedCreated };
    titles[session] = title;
    nextStore[session] = normalized;
    if (typeof value === 'string' || value.title !== normalized.title || value.created !== normalized.created) changed = true;
  });

  if (changed) {
    try {
      localStorage.setItem(SHELL_AUTO_TITLES_KEY, JSON.stringify(nextStore));
    } catch {}
  }
  return titles;
}

function clearShellAutoTitleCache(): void {
  try {
    localStorage.removeItem(SHELL_AUTO_TITLES_KEY);
  } catch {}
}

function cacheShellAutoTitle(session: string, title: string, existing?: Record<string, string>): void {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!session || !clean) return;
  const titles = existing || shellAutoTitles();
  if (titles[session] === clean) return;
  const store = shellAutoTitleStore();
  store[session] = { title: clean, cachedAt: Date.now(), created: shellCreatedAt(session) };
  try {
    localStorage.setItem(SHELL_AUTO_TITLES_KEY, JSON.stringify(store));
  } catch {}
}

function shellHasCustomLabel(name: string): boolean {
  return Boolean(shellLabelAliases()[name]?.trim());
}

function shellDisplayLabel(name: string, fallback: string): string {
  const alias = shellLabelAliases()[name]?.trim();
  return alias || shellAutoDisplayLabel(name, fallback);
}

function isNumberedShell(name: string): boolean {
  return /^\d+$/.test(name);
}

function compactShellLabel(name: string, fallback: string): string {
  if (isNumberedShell(name) || name === 'main' || /^slot\d+$/.test(name)) return '';
  return fallback;
}

function shellboxTitle(name: string): string {
  const title = sessionWorkBrief(name, SHELLBOX_TITLE_WORDS).replace(/\s+/g, ' ').trim();
  if (!title) return '';
  return title.replace(/[.,;:!?]+$/, '');
}

function shellboxSummary(name: string): string {
  return sessionWorkTitle(name);
}

function generatedShellLabel(name: string): string {
  return shellboxTitle(name);
}

function shellAutoDisplayLabel(name: string, fallback: string): string {
  const generated = generatedShellLabel(name);
  if (generated) return generated;
  return compactShellLabel(name, fallback);
}

function shellRawNameBadge(name: string, displayLabel: string): string {
  if (isNumberedShell(name) || name === 'main' || /^slot\d+$/.test(name)) return '';
  return name !== displayLabel ? name : '';
}

function renameShellLabel(name: string): boolean {
  const shell = shellPreviewByName(name);
  const session = sessionByName(name);
  const fallback = shell?.label || session?.label || name;
  const current = shellDisplayLabel(name, fallback);
  const next = window.prompt('Shell card name', current);
  if (next === null) return false;
  const clean = next.trim().replace(/\s+/g, ' ').slice(0, 64);
  const defaultLabel = compactShellLabel(name, fallback);
  const autoLabel = shellAutoDisplayLabel(name, fallback);
  const aliases = shellLabelAliases();
  if (!clean || clean === fallback || clean === defaultLabel || clean === autoLabel || clean === name) {
    delete aliases[name];
  } else {
    aliases[name] = clean;
  }
  localStorage.setItem(SHELL_LABEL_ALIASES_KEY, JSON.stringify(aliases));
  return true;
}

function resetShellLabel(name: string): boolean {
  const aliases = shellLabelAliases();
  if (!(name in aliases)) return false;
  delete aliases[name];
  localStorage.setItem(SHELL_LABEL_ALIASES_KEY, JSON.stringify(aliases));
  return true;
}

function hostAlias(): string {
  return localStorage.getItem(HOST_ALIAS_KEY)?.trim() || '';
}

function hostDisplayName(hostname: string): string {
  const alias = hostAlias();
  if (alias) return alias;
  const host = hostname.trim();
  return host || '—';
}

function syncDashboardTitle(hostname: string): void {
  const display = hostDisplayName(hostname);
  document.title = display === '—' ? 'ShellDeck' : display;
  const label = document.getElementById('hostLabel');
  if (label) label.textContent = display;
}

function renameHostLabel(hostname: string): boolean {
  const current = hostDisplayName(hostname);
  const next = window.prompt('Dashboard name', current);
  if (next === null) return false;
  const clean = next.trim().replace(/\s+/g, ' ').slice(0, 48);
  const defaultHost = hostname.trim();
  if (!clean || clean === defaultHost) {
    localStorage.removeItem(HOST_ALIAS_KEY);
  } else {
    localStorage.setItem(HOST_ALIAS_KEY, clean);
  }
  syncDashboardTitle(hostname);
  return true;
}

function nextTmuxSessionName(): string {
  const used = new Set<string>();
  sessions().forEach((session) => used.add(session.name));
  latestShells.forEach((shell) => used.add(shell.name));
  for (let i = 1; i <= 99; i += 1) {
    const name = String(i);
    if (!used.has(name)) return name;
  }
  return `shell-${Date.now().toString(36)}`;
}

function promptNewTmuxSessionName(baseName: string, requireName = false): string | null {
  const session = sessionByName(baseName);
  const fallback = session?.label || baseName;
  const display = shellDisplayLabel(baseName, fallback);
  const suggestion = requireName ? nextTmuxSessionName() : '';
  const value = window.prompt(
    requireName
      ? `Name for the extra tmux session from ${display}.`
      : `Name for the new tmux session from ${display}\nLeave blank to use ${baseName}.`,
    suggestion,
  );
  if (value === null) return null;
  const clean = value.trim();
  if (!clean && requireName) throw new Error('Name the extra tmux session');
  if (!clean) return '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clean)) {
    throw new Error('Use 1-64 letters, numbers, dash, or underscore for tmux session names');
  }
  return clean;
}

function stripTerminalDecor(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[╭╮╰╯│┃║┆┊]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAutoFollowUp(value: string): string {
  return stripTerminalDecor(value)
    .replace(/^(?:claude|codex|grok|gemini|cursor|agent|assistant)\s*[:>]\s*/i, '')
    .replace(/^(?:[>›»•*+-]|\d+[.)])\s*/, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .slice(0, AUTO_FOLLOW_UP_MAX_CHARS)
    .trim();
}

function looksLikeAutoFollowUp(line: string): boolean {
  const text = cleanAutoFollowUp(line);
  if (text.length < 12) return false;
  if (/how is claude doing this session|esc to interrupt|shift\+tab|tokens|context left/i.test(text)) return false;
  if (/^(?:would you like me to|do you want me to|should i|shall i|want me to|would you like|do you want|should we|shall we)\b/i.test(text)) return true;
  if (/^(?:i can|next,? i can|i could|we can)\s+(?:also\s+)?(?:add|fix|run|update|review|commit|push|open|continue|test|deploy|implement|create|write|check|wire|rename)\b/i.test(text)) return true;
  return /\?$/.test(text) && /\b(add|fix|run|update|review|commit|push|open|continue|test|deploy|implement|create|write|check|wire|rename)\b/i.test(text);
}

function extractAutoFollowUpDraft(output: string): string {
  const lines = output.split('\n').map(stripTerminalDecor).filter(Boolean).slice(-90);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const heading = line.match(/^(?:auto[- ]?)?(?:follow[- ]?up|suggested follow[- ]?up|suggested next prompt|next prompt|try asking|ask me)[:：-]\s*(.*)$/i);
    if (heading) {
      const inline = cleanAutoFollowUp(heading[1] || '');
      if (inline) return inline;
      const next = cleanAutoFollowUp(lines[i + 1] || '');
      if (next) return next;
    }
    if (looksLikeAutoFollowUp(line)) return cleanAutoFollowUp(line);
  }
  return '';
}

function markAutoFollowUpSent(name: string, text: string): void {
  const clean = text.trim();
  if (clean && autoFollowUpDrafts[name] === clean) autoFollowUpSentDrafts[name] = clean;
}

function sessionByName(name: string): SessionItem | null {
  return sessions().find((session) => session.name === name) || null;
}

function selectedSessionModel(): SessionItem | null {
  return sessionByName(selectedSession);
}

function firstRunningSession(): SessionItem | null {
  return sessions().find((session) => session.running) || null;
}

function chooseSession(preferRunning = false): SessionItem | null {
  const current = selectedSessionModel();
  if (current && (!preferRunning || current.running)) return current;
  const selected = firstRunningSession() || sessions()[0] || null;
  selectedSession = selected ? selected.name : '';
  if (selectedSession) localStorage.setItem('sdSelectedSession', selectedSession);
  return selected;
}

function selectSession(name: string | undefined): void {
  selectedSession = String(name || '');
  if (selectedSession) localStorage.setItem('sdSelectedSession', selectedSession);
  renderShellTabs();
  if (typeof renderSessionRail === 'function') renderSessionRail();
  renderSelectedSessionActions();
  markSelectedShell();
  updateUnlockState();
  // Close the mobile session drawer after picking a session so the shell is front-and-center.
  if (typeof setSessionRailOpen === 'function' && window.innerWidth <= 760) setSessionRailOpen(false);
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
  if (!prev || prev.out !== output) shellActivity[name] = { out: output, at: Date.now() };
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
