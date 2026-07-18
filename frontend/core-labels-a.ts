// Labels A
// Split from core-orig.ts L275-546
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

