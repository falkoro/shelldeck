// Live host machine stats (CPU / RAM / temps), polled from /api/metrics.
// Mirrors the CachyOS system-monitor widget: at-a-glance CPU%, RAM, and temperatures.

interface MetricTemp {
  label: string;
  celsius: number;
}

interface MachineMetrics {
  hostname: string;
  ip?: string;
  cpu_pct: number;
  cpu_cores: number;
  cpu_mhz: number;
  load1: number;
  load5: number;
  load15: number;
  mem_total_kb: number;
  mem_used_kb: number;
  mem_pct: number;
  swap_total_kb: number;
  swap_used_kb: number;
  uptime_secs: number;
  temps: MetricTemp[];
}

interface ContainerInfo {
  engine: string;
  name: string;
  image: string;
  status: string;
  cpu?: string | null;
  mem?: string | null;
  started?: string | null;
  desc?: string | null;
  version?: ContainerVersionInfo | null;
  image_id?: string | null;
  built?: string | null;
  alert?: string | null;
}

interface ContainerVersionInfo {
  current: string;
  latest: string;
  behind: number;
  state: 'current' | 'behind';
  detail: string;
}

interface RemoteMetrics {
  cpu_pct: number;
  cpu_cores: number;
  load1: number;
  load5: number;
  load15: number;
  mem_total_kb: number;
  mem_used_kb: number;
  mem_pct: number;
  uptime_secs: number;
  temps: MetricTemp[];
}

interface RemoteHostStatus {
  id: string;
  label: string;
  target: string;
  online: boolean;
  ping_ms: number | null;
  ssh_ms: number | null;
  checked_at: string;
  containers: ContainerInfo[];
  container_total?: number;
  ip?: string | null;
  metrics?: RemoteMetrics | null;
  error?: string | null;
}

interface GhRun {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion?: string | null;
  head_branch?: string | null;
  run_number: number;
  html_url: string;
  updated_at: string;
  event: string;
}

interface GhRepoStatus {
  repo: string;
  ok: boolean;
  error?: string | null;
  run?: GhRun | null;
}

interface GhRunsResult {
  repos: GhRepoStatus[];
  rate_limit_remaining?: number | null;
  rate_limit_reset?: number | null;
  fetched_at: string;
  cached: boolean;
}

type ContainerStateKind =
  | 'running' | 'unhealthy' | 'restarting' | 'paused' | 'crashed' | 'created' | 'stopped';

// Display order (most attention-worthy first) for the health rollup + legend, plus each
// state's legend label and status-dot colour class.
const CONTAINER_STATE_ORDER: ContainerStateKind[] =
  ['running', 'unhealthy', 'restarting', 'crashed', 'paused', 'created', 'stopped'];
const CONTAINER_STATE_LABEL: Record<ContainerStateKind, string> = {
  running: 'running', unhealthy: 'unhealthy', restarting: 'restarting',
  crashed: 'crashed', paused: 'paused', created: 'created', stopped: 'stopped',
};

// Fine-grained lifecycle/health from a docker/podman status string. Beyond running/stopped it
// surfaces unhealthy (failed healthcheck), restarting (crash-looping), paused, created, and —
// crucially — distinguishes a clean stop (Exited 0) from a crash (Exited non-zero / Dead).
