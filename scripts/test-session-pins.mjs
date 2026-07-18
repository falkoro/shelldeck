#!/usr/bin/env node
// Drives the shipped public/session-pins.js helpers (order, groups, auto-pin, reorder).

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
  partitionRailGroups,
  applyAutoPinAgents,
  isAgentSession,
  reorderPinnedName,
  movePinnedName,
} = sandbox;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected: ${e}\n  actual:   ${a}`);
}

const sessions = [
  { name: '3', label: 'Slot 3', family: 'shell' },
  { name: 'codex', label: 'Codex', family: 'agent' },
  { name: '1', label: 'Slot 1', family: 'shell' },
  { name: 'claude', label: 'Claude', family: 'agent' },
  { name: 'ssh-ops', label: 'SSH Ops', family: 'custom' },
];

// --- pure order ---
const ordered = orderSessionsByPins(sessions, ['claude', 'codex', 'missing-stale']);
assertEqual(
  ordered.map((s) => s.name),
  ['claude', 'codex', '3', '1', 'ssh-ops'],
  'pinned sessions sort above unpinned; stale pins dropped',
);

// --- family groups ---
const groups = partitionRailGroups(sessions, ['claude']);
assertEqual(groups.pinned.map((s) => s.name), ['claude'], 'pinned group');
assertEqual(groups.agents.map((s) => s.name), ['codex'], 'agents unpinned');
assertEqual(groups.shells.map((s) => s.name), ['3', '1'], 'shells unpinned');
assertEqual(groups.custom.map((s) => s.name), ['ssh-ops'], 'custom unpinned');
assert(isAgentSession({ name: 'codex', family: 'shell' }), 'known agent name');
assert(isAgentSession({ name: '9', family: 'agent' }), 'agent family');
assert(!isAgentSession({ name: '1', family: 'shell' }), 'numbered shell not agent');

// --- auto-pin agents first time only ---
const auto1 = applyAutoPinAgents(sessions, [], []);
assertEqual(
  auto1.pins.sort(),
  ['claude', 'codex'].sort(),
  'auto-pin agents on first see',
);
assert(auto1.seen.includes('1') && auto1.seen.includes('codex'), 'all names marked seen');
// User unpinned codex; re-running with seen should not re-pin
const afterUnpin = applyAutoPinAgents(sessions, ['claude'], auto1.seen);
assertEqual(afterUnpin.pins, ['claude'], 'seen agents stay unpinned after user unpin');

// --- reorder pins ---
assertEqual(reorderPinnedName(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b'], 'reorder to front');
assertEqual(movePinnedName(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'], 'move pin up');
assertEqual(movePinnedName(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'], 'move pin down');

// --- persistence ---
const mem = new Map();
const getItem = (k) => (mem.has(k) ? mem.get(k) : null);
const setItem = (k, v) => mem.set(k, String(v));
writePinnedSessionNames(['codex', '1'], setItem);
assertEqual(readPinnedSessionNames(getItem), ['codex', '1'], 'read/write pin names');
const reordered = orderSessionsByPins(sessions, readPinnedSessionNames(getItem));
assertEqual(
  reordered.map((s) => s.name),
  ['codex', '1', '3', 'claude', 'ssh-ops'],
  'pin set survives reload',
);

store.clear();
savePinnedSessionNames(['ssh-ops']);
assertEqual(pinnedSessionNames(), ['ssh-ops'], 'localStorage wrapper');
toggleSessionPin('claude');
assertEqual(pinnedSessionNames().sort(), ['claude', 'ssh-ops'].sort(), 'toggle pin');
assert(isSessionPinned('claude', pinnedSessionNames()), 'is pinned');

console.log('session-pins: all checks passed');
