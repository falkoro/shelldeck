"use strict";
// Live host machine stats (CPU / RAM / temps), polled from /api/metrics.
// Mirrors the CachyOS system-monitor widget: at-a-glance CPU%, RAM, and temperatures.
// Display order (most attention-worthy first) for the health rollup + legend, plus each
// state's legend label and status-dot colour class.
const CONTAINER_STATE_ORDER = ['running', 'unhealthy', 'restarting', 'crashed', 'paused', 'created', 'stopped'];
const CONTAINER_STATE_LABEL = {
    running: 'running', unhealthy: 'unhealthy', restarting: 'restarting',
    crashed: 'crashed', paused: 'paused', created: 'created', stopped: 'stopped',
};
// Fine-grained lifecycle/health from a docker/podman status string. Beyond running/stopped it
// surfaces unhealthy (failed healthcheck), restarting (crash-looping), paused, created, and —
// crucially — distinguishes a clean stop (Exited 0) from a crash (Exited non-zero / Dead).
