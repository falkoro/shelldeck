#!/usr/bin/env node
// Fail if product source files exceed the workspace line budget (default 250).
// Scope: frontend TypeScript modules. Rust Phase B is tracked in docs/product-plan-live-center.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX = Number(process.env.SHELLDECK_MAX_LINES || 250);
const dirs = ['frontend'];
const overs = [];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.isFile() && ent.name.endsWith('.ts')) {
      const n = fs.readFileSync(p, 'utf8').split(/\r?\n/).length;
      // count like wc -l (newline-terminated lines); tolerate final newline variance
      const lines = fs.readFileSync(p, 'utf8').split(/\n/).length - (fs.readFileSync(p, 'utf8').endsWith('\n') ? 1 : 0);
      const count = Math.max(n - 1, lines);
      const wc = fs.readFileSync(p, 'utf8').split('\n').length - 1;
      if (wc > MAX) overs.push({ file: path.relative(root, p), lines: wc });
    }
  }
}

for (const d of dirs) walk(path.join(root, d));
overs.sort((a, b) => b.lines - a.lines);

if (overs.length) {
  console.error(`file:size — ${overs.length} file(s) over ${MAX} lines:`);
  for (const o of overs) console.error(`  ${o.lines}\t${o.file}`);
  process.exit(1);
}
console.log(`file:size — all frontend/**/*.ts ≤ ${MAX} lines`);
