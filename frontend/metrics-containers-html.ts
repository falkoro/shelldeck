function containerState(status: string, alert?: string | null): ContainerStateKind {
  if ((alert || '').trim()) return 'unhealthy';
  const s = (status || '').toLowerCase().trim();
  if (s.includes('unhealthy')) return 'unhealthy';
  if (s.startsWith('restarting')) return 'restarting';
  if (s.includes('paused')) return 'paused';
  if (s.startsWith('created')) return 'created';
  if (s.startsWith('dead')) return 'crashed';
  const exit = /^exited \((\d+)\)/.exec(s);
  if (exit) return exit[1] === '0' ? 'stopped' : 'crashed';
  if (s.startsWith('up')) return 'running';
  return 'stopped';
}

// "23 running · 1 unhealthy · 2 crashed · 1 stopped" — every non-empty bucket, severity order.
function containerHealth(containers: ContainerInfo[]): string {
  const counts: Partial<Record<ContainerStateKind, number>> = {};
  for (const c of containers) {
    const st = containerState(c.status, c.alert);
    counts[st] = (counts[st] || 0) + 1;
  }
  const parts = CONTAINER_STATE_ORDER
    .filter((st) => counts[st])
    .map((st) => `${counts[st]} ${CONTAINER_STATE_LABEL[st]}`);
  return parts.join(' · ') || 'no containers';
}

function containerVersionSummary(containers: ContainerInfo[]): string {
  let staleContainers = 0;
  let totalBehind = 0;
  for (const c of containers) {
    if (c.version?.state === 'behind' && c.version.behind > 0) {
      staleContainers += 1;
      totalBehind += c.version.behind;
    }
  }
  if (!staleContainers) return '';
  const rows = staleContainers === 1 ? '1 update' : `${staleContainers} updates`;
  const versions = totalBehind === 1 ? '1 version' : `${totalBehind} versions`;
  return `${rows} · ${versions} behind`;
}

function containerOverview(containers: ContainerInfo[]): string {
  const version = containerVersionSummary(containers);
  return version ? `${containerHealth(containers)} · ${version}` : containerHealth(containers);
}

// "12.50%" → 12.5; null when there's no parseable number.
function parsePercent(s?: string | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

// "128MiB" / "1.5GiB" / "512kB" → bytes. Handles docker's IEC (KiB/MiB/GiB) and SI (kB/MB/GB) units.
function parseBytes(s?: string | null): number | null {
  if (!s) return null;
  const m = /([\d.]+)\s*([kmgtp]i?b|b)?/i.exec(s.trim());
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  const mult: Record<string, number> = {
    b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, pib: 1024 ** 5,
  };
  return val * (mult[(m[2] || 'b').toLowerCase()] ?? 1);
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${bytes.toFixed(0)} B`;
}

// One stat pill with an inline intensity bar (the `--fill` width) behind the text.
function statChip(kind: 'cpu' | 'mem', fillPct: number, text: string, title: string): string {
  const fill = Math.max(0, Math.min(100, fillPct)).toFixed(0);
  return `<span class="ci-stat ci-stat-${kind} ${meterLevel(fillPct)}" style="--fill:${fill}%" title="${escapeHtml(title)}"><span>${escapeHtml(text)}</span></span>`;
}

// Compact CPU + mem pills shared by the local and remote container rows so both lists read alike.
// CPU% can exceed 100 on multi-core hosts, so the bar clamps but the printed number is the real
// value; mem shows used + %-of-limit, with the full "used / limit" string in the tooltip.
function containerStatChipsHtml(c: ContainerInfo): string {
  const chips: string[] = [];
  const cpu = parsePercent(c.cpu);
  if (cpu !== null) chips.push(statChip('cpu', cpu, `CPU ${cpu.toFixed(cpu < 10 ? 1 : 0)}%`, `CPU ${c.cpu}`));
  if (c.mem) {
    const [usedRaw, limitRaw] = c.mem.split('/').map((p) => p.trim());
    const used = parseBytes(usedRaw);
    const limit = parseBytes(limitRaw);
    if (used !== null && limit && limit > 0) {
      const pct = (used / limit) * 100;
      chips.push(statChip('mem', pct, `${fmtBytes(used)} · ${pct.toFixed(pct < 10 ? 1 : 0)}%`, `RAM ${c.mem}`));
    } else if (used !== null) {
      chips.push(statChip('mem', 0, fmtBytes(used), `RAM ${c.mem}`));
    } else {
      chips.push(`<span class="ci-stat ci-stat-mem ok"><span>${escapeHtml(c.mem)}</span></span>`);
    }
  }
  return chips.join('');
}

// Compact age from a docker status string, e.g. "Up 7 days (healthy)" → "7d", "Up About an hour"
// → "~1h", "Exited (0) 3 minutes ago" → "" (stopped, no age badge).
function containerUptime(status: string): string {
  if (!/^up\b/i.test(status)) return '';
  if (/about an hour/i.test(status)) return '~1h';
  if (/less than a (second|minute)/i.test(status)) return '<1m';
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(status);
  if (!m) return '';
  const unit = { second: 's', minute: 'm', hour: 'h', day: 'd', week: 'w', month: 'mo', year: 'y' }[m[2].toLowerCase()] || '';
  return `${m[1]}${unit}`;
}

// Precise uptime from StartedAt: "7d 3h 12m", "14h 4m 9s", "3m 22s", "47s".
function preciseUptime(startedIso?: string | null): string {
  if (!startedIso) return '';
  const start = Date.parse(startedIso);
  if (!Number.isFinite(start)) return '';
  let s = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

// Running containers show precise uptime (from StartedAt); stopped show nothing here.
function containerAge(c: ContainerInfo): string {
  if (containerState(c.status, c.alert) !== 'running') return '';
  return preciseUptime(c.started) || containerUptime(c.status);
}

// Descriptions: localStorage override > seed map (our own apps) > the image's label.
const CONTAINER_DESC_KEY = 'sdContainerDesc';
const DEFAULT_CONTAINER_DESC: Record<string, string> = {
  'autonomy-ev-ops': 'AutonomyEV publishing bot — drafts/reviews/publishes articles + Reddit/X',
  'spot-cloud-chat': 'Spot Cloud website-chat operator + repo-agent bot',
  'linkedin-ops': 'LinkedIn approval + publishing for the Spot brands',
  'wsb-digest': 'Daily r/wallstreetbets digest emailer',
  'smtp-graph-relay': 'SMTP → Microsoft Graph mail relay',
  'memoh-server': 'Memoh AI House — Discord persona fleet server',
  'memoh-web': 'Memoh web UI',
  'memoh-postgres': 'Memoh Postgres database',
  'memoh-qdrant': 'Memoh Qdrant vector store',
  'memoh-sparse': 'Memoh sparse-embedding service',
  'remark42': 'Comments backend (autonomy-ev.com)',
  'logan-services-tunnel': 'Cloudflare tunnel for the gl502vs sidecar services',
  'glances': 'System + container monitor (this dashboard reads it)',
  'plex': 'Plex media server',
  'sonarr': 'TV series management',
  'radarr': 'Movie management',
  'sabnzbd': 'Usenet downloader',
  'qbittorrent': 'Torrent client',
  'jackett': 'Indexer proxy',
  'adguardhome': 'Network-wide ad-blocking DNS',
  'homeassistant': 'Home automation',
  'smokeping': 'Network latency monitor',
};
function containerDescStore(): Record<string, string> {
  return storageJson<Record<string, string>>(CONTAINER_DESC_KEY, {});
}
function containerDescription(c: ContainerInfo): string {
  return (containerDescStore()[c.name] || DEFAULT_CONTAINER_DESC[c.name] || c.desc || '').trim();
}
function editContainerDescription(name: string): void {
  if (!name) return;
  const store = containerDescStore();
  const current = store[name] || DEFAULT_CONTAINER_DESC[name] || '';
  const next = window.prompt(`Description for ${name}`, current);
  if (next === null) return;
  const clean = next.trim().slice(0, 160);
  if (clean) store[name] = clean; else delete store[name];
  localStorage.setItem(CONTAINER_DESC_KEY, JSON.stringify(store));
  Promise.allSettled([loadContainers(), loadRemoteHosts()]);
  toast('Description saved');
}
(window as any).editContainerDescription = editContainerDescription;

// Restart + Pull-latest as small icon buttons. Hidden via CSS unless shells are unlocked; the
// click handler confirms and the server re-checks login + unlock + action header.
function containerActionsHtml(c: ContainerInfo, host: string): string {
  const attrs = `data-cname="${escapeHtml(c.name)}" data-cengine="${escapeHtml(c.engine)}" data-chost="${escapeHtml(host)}"`;
  return `<div class="container-actions"><button type="button" class="container-action ca-restart" data-container-action="restart" ${attrs} title="Restart ${escapeHtml(c.name)}" aria-label="Restart ${escapeHtml(c.name)}">↻</button><button type="button" class="container-action ca-pull" data-container-action="pull" ${attrs} title="Pull latest image + recreate ${escapeHtml(c.name)}" aria-label="Pull latest ${escapeHtml(c.name)}">⬇</button></div>`;
}

function containerVersionBadgeHtml(c: ContainerInfo): string {
  const v = c.version;
  if (!v) return '';
  const current = v.current || '';
  const latest = v.latest || current;
  const title = `${c.image}\ncurrent: ${current}\nlatest: ${latest}\n${v.detail || ''}`.trim();
  if (v.state === 'behind' && v.behind > 0) {
    return `<span class="ci-version behind" title="${escapeHtml(title)}">${escapeHtml(String(v.behind))} behind</span>`;
  }
  return `<span class="ci-version current" title="${escapeHtml(title)}">current</span>`;
}

// Image .Created comes through as RFC3339 (docker) OR Go's time.String() "2026-05-31 15:44:15.7
// +0000 UTC" (podman). Try native parse first, then massage the Go form into ISO. NaN when unknown.
function parseBuilt(raw?: string | null): number {
  if (!raw) return NaN;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?/);
  if (m) {
    const iso = Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4] || '00'}`);
    if (Number.isFinite(iso)) return iso;
  }
  return Date.parse(raw.slice(0, 10));
}

// "updated 2026-06-04 (2d ago)" from the image's build time; '' when unparseable/unknown.
function builtAge(raw?: string | null): string {
  const t = parseBuilt(raw);
  if (!Number.isFinite(t)) return '';
  const date = new Date(t).toISOString().slice(0, 10);
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const rel = d > 0 ? `${d}d ago` : h > 0 ? `${h}h ago` : 'today';
  return `${date} (${rel})`;
}

// Small "updated …" line for a container card: build date + short image digest. '' when unknown.
function containerBuiltHtml(c: ContainerInfo): string {
  const age = builtAge(c.built);
  if (!age && !c.image_id) return '';
  const idChip = c.image_id ? ` · #${escapeHtml(c.image_id)}` : '';
  const label = age ? `updated ${age}` : 'image';
  const t = parseBuilt(c.built);
  const fullDate = Number.isFinite(t) ? new Date(t).toLocaleString() : (c.built || 'unknown');
  const title = `Image built: ${fullDate}${c.image_id ? `\ndigest: ${c.image_id}` : ''}`;
  return `<div class="ci-built" title="${escapeHtml(title)}">${escapeHtml(label)}${idChip}</div>`;
}

// Shared row for local + remote container lists: name + engine tag, image, status + age, stats,
// then actions. Stopped/unhealthy get a state class for greying/highlighting.
function containerAlertHtml(c: ContainerInfo): string {
  const alert = (c.alert || '').trim();
  if (!alert) return '';
  return `<div class="ci-alert" title="${escapeHtml(alert)}">${escapeHtml(alert)}</div>`;
}

