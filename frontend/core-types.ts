// Split from core-orig.ts L1-165
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

