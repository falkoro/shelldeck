#!/usr/bin/env node
// Drives the shipped public/session-pins.js helpers (order + persist round-trip).
// Failures exit non-zero so CI / local gating can catch regressions.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shipped = path.join(root, 'public', 'session-pins.js');

if (!fs.existsSync(shipped)) {
  console.error(`Missing shipped helper: ${shipped} — run bun run build:frontend first`);
  process.exit(1);
}

const code = fs.readFileSync(shipped, 'utf8');
const store = new Map();
const sandbox = {
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const {
  orderSessionsByPins,
  togglePinnedName,
  isSessionPinned,
  readPinnedSessionNames,
  writePinnedSessionNames,
  pinnedSessionNames,
  savePinnedSessionNames,
  toggleSessionPin,
} = sandbox;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

// --- pure order ---
const sessions = [
  { name: '3', label: 'Slot 3' },
  { name: 'codex', label: 'Codex' },
  { name: '1', label: 'Slot 1' },
  { name: 'claude', label: 'Claude' },
  { name: 'ssh-ops', label: 'SSH Ops' },
];

const ordered = orderSessionsByPins(sessions, ['claude', 'codex', 'missing-stale']);
assertEqual(
  ordered.map((s) => s.name),
  ['claude', 'codex', '3', '1', 'ssh-ops'],
  'pinned sessions sort above unpinned; stale pins dropped; relative unpinned order kept',
);

const noPins = orderSessionsByPins(sessions, []);
assertEqual(
  noPins.map((s) => s.name),
  sessions.map((s) => s.name),
  'empty pin set preserves input order',
);

const toggled = togglePinnedName('codex', ['claude']);
assertEqual(toggled, ['claude', 'codex'], 'toggle pin adds name');
assertEqual(togglePinnedName('claude', toggled), ['codex'], 'toggle pin removes name');
assert(isSessionPinned('codex', toggled), 'isSessionPinned true for pinned');
assert(!isSessionPinned('1', toggled), 'isSessionPinned false for unpinned');

// --- persistence round-trip via injectable storage ---
const mem = new Map();
const getItem = (k) => (mem.has(k) ? mem.get(k) : null);
const setItem = (k, v) => mem.set(k, String(v));
writePinnedSessionNames(['codex', '1'], setItem);
assertEqual(readPinnedSessionNames(getItem), ['codex', '1'], 'read/write pin names round-trip');
// Simulate reload: new reader against same store
const afterReload = readPinnedSessionNames(getItem);
const reordered = orderSessionsByPins(sessions, afterReload);
assertEqual(
  reordered.map((s) => s.name),
  ['codex', '1', '3', 'claude', 'ssh-ops'],
  'pin set survives simulated reload and still orders pinned first',
);

// --- browser wrappers against sandbox localStorage ---
store.clear();
savePinnedSessionNames(['ssh-ops']);
assertEqual(pinnedSessionNames(), ['ssh-ops'], 'localStorage pin wrapper reads back');
toggleSessionPin('claude');
assertEqual(pinnedSessionNames().sort(), ['claude', 'ssh-ops'].sort(), 'toggleSessionPin mutates store');
toggleSessionPin('ssh-ops');
assertEqual(pinnedSessionNames(), ['claude'], 'toggleSessionPin unpins');

console.log('session-pins: all checks passed');
