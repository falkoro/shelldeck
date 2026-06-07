#!/usr/bin/env bun
/**
 * Deterministic AI-slop linter for ShellDeck operator-facing copy and UI chrome.
 * Functional session/run/ticker chips and unlock flows are allowlisted.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative } from 'node:path'

const ROOT = process.cwd()
const targets = process.argv.slice(2)
const SCAN = targets.length ? targets : ['frontend']
const EXTS = new Set(['.ts', '.tsx', '.html'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', 'xterm'])

const ALLOW_LINE = /slop-allow/
const FUNCTIONAL_CLASS = /agent-badge|run-status-badge|ci-badges|session-tab|session-item|container-age|gh-run|ticker-chip|session-chip|attach-chip|run-branch-tag|shell-name-pill|unlock-|locked-note/

const WORDS = [
  'delve', 'leverage', 'foster', 'ignite', 'empower', 'unleash',
  'streamline', 'supercharge', 'seamless', 'seamlessly',
  'cutting-edge', 'state-of-the-art', 'best-in-class', 'future-ready',
  'future-proof', 'next-generation', 'world-class', 'game-changer',
  'game-changing', 'transformative', 'revolutionary', 'synergy', 'holistic',
  'myriad', 'plethora', 'multifaceted', 'pivotal', 'testament', 'beacon',
  'tapestry', 'symphony', 'elevate',
]
const PHRASES = [
  /in today'?s\s+(fast-paced|ever-evolving|digital|modern)/i,
  /ever-evolving/i,
  /whether you'?re\b/i,
  /it'?s not just\b.*\bit'?s\b/i,
  /\bno [a-z]+\.\s*no [a-z]+\.\s*just /i,
  /\b(let'?s )?dive in\b/i,
  /at the end of the day/i,
  /\bin conclusion\b/i,
  /paradigm shift/i,
  /trusted by industry leaders/i,
  /elevate your (workflow|experience)/i,
]
// Marketing-template pills only — not ShellDeck's functional chip classes.
const DECORATIVE_PILL = [
  /class(:list)?=["'][^"']*\b(pill|eyebrow-pill|hero-badge|feature-badge)\b/,
  /rounded-full[^"']*\b(bg|background)-(emerald|amber|indigo|sky|rose|pink|violet)-(500|600|700|800|900)\b[^"']*\bpx-/,
]

const wordRe = new RegExp(`\\b(${WORDS.map((w) => w.replace(/-/g, '\\-')).join('|')})\\b`, 'i')

const hits = []
function walk(p) {
  let st
  try { st = statSync(p) } catch { return }
  if (st.isDirectory()) {
    const base = p.split('/').pop()
    if (SKIP_DIRS.has(base)) return
    for (const e of readdirSync(p)) walk(join(p, e))
    return
  }
  if (!EXTS.has(extname(p))) return
  const rel = relative(ROOT, p)
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    if (ALLOW_LINE.test(line)) return
    if (FUNCTIONAL_CLASS.test(line)) return
    const w = line.match(wordRe)
    if (w) hits.push({ rel, n: i + 1, kind: 'word', match: w[1], line: line.trim() })
    for (const re of PHRASES) {
      if (re.test(line)) {
        hits.push({ rel, n: i + 1, kind: 'phrase', match: re.source, line: line.trim() })
        break
      }
    }
    for (const re of DECORATIVE_PILL) {
      if (re.test(line)) {
        hits.push({ rel, n: i + 1, kind: 'pill', match: 'decorative pill/badge', line: line.trim() })
        break
      }
    }
  })
}

for (const t of SCAN) walk(isAbsolute(t) ? t : join(ROOT, t))

if (hits.length === 0) {
  console.log(`✓ no AI-slop tells found in: ${SCAN.join(', ')}`)
  process.exit(0)
}

console.log(`✗ ${hits.length} AI-slop tell(s) found:\n`)
for (const h of hits) {
  const tag = h.kind.toUpperCase()
  const snip = h.line.length > 100 ? `${h.line.slice(0, 98)}…` : h.line
  console.log(`  ${h.rel}:${h.n}  [${tag}: ${h.match}]\n      ${snip}`)
}
console.log('\nFix the copy/chrome, or add a trailing "slop-allow" comment if justified.')
process.exit(1)