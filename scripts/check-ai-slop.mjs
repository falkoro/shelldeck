#!/usr/bin/env bun
/**
 * Extensive deterministic AI-slop linter for ShellDeck.
 * Rules: scripts/ai-slop-rules.mjs (Grok 4.3 + spot-suite anti-ai-slop.md).
 *
 * Usage:
 *   bun scripts/check-ai-slop.mjs [path ...]   # default: frontend, public/app.css
 *
 * Suppress: trailing  // slop-allow
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative } from 'node:path'
import {
  ALLOW_LINE,
  CODE_LINE,
  CSS_TELLS,
  FUNCTIONAL_UI,
  PHRASES,
  STRUCTURE_TELLS,
  UI_TELLS,
  WORDS,
} from './ai-slop-rules.mjs'

const ROOT = process.cwd()
const targets = process.argv.slice(2)
const SCAN = targets.length ? targets : ['frontend', 'public/app.css']
const TS_EXTS = new Set(['.ts', '.tsx'])
const CSS_EXTS = new Set(['.css'])
const HTML_EXTS = new Set(['.html'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.cache', 'xterm'])

const wordRe = new RegExp(
  `\\b(${WORDS.map((w) => w.replace(/-/g, '\\-')).join('|')})\\b`,
  'i',
)

const hits = []

function record(rel, n, kind, match, line) {
  hits.push({ rel, n, kind, match, line: line.trim() })
}

/** Pull quoted / template literal chunks likely to be user-facing copy. */
function extractCopyChunks(line) {
  const chunks = []
  const patterns = [
    /'([^'\\]|\\.)*'/g,
    /"([^"\\]|\\.)*"/g,
    /`([^`\\]|\\.)*`/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(line)) !== null) {
      const raw = m[0]
      const inner = raw.slice(1, -1)
      if (inner.length >= 8 && /[a-zA-Z]{3,}/.test(inner)) chunks.push(inner)
    }
  }
  return chunks
}

function scanCopyText(rel, n, text, line) {
  const w = text.match(wordRe)
  if (w) record(rel, n, 'word', w[1], line)
  for (const { id, re } of PHRASES) {
    if (re.test(text)) {
      record(rel, n, 'phrase', id, line)
      break
    }
  }
  for (const { id, re } of STRUCTURE_TELLS) {
    if (re.test(text)) {
      record(rel, n, 'structure', id, line)
      break
    }
  }
}

function scanTsLine(rel, n, line) {
  if (ALLOW_LINE.test(line)) return
  if (FUNCTIONAL_UI.test(line)) return
  if (CODE_LINE.test(line)) {
    // Still scan template HTML inside code lines (innerHTML, overlay, etc.)
    if (!/innerHTML|overlay\.|textContent\s*=|placeholder=|title=|aria-label=|toast\(|muted|>[^<]{8,}</.test(line)) {
      return
    }
  }

  for (const { id, re } of UI_TELLS) {
    if (re.test(line)) {
      record(rel, n, 'ui', id, line)
      break
    }
  }

  const chunks = extractCopyChunks(line)
  if (chunks.length) {
    for (const chunk of chunks) scanCopyText(rel, n, chunk, line)
    return
  }

  // Comments and plain UI labels without string wrappers
  if (/^\s*\/\/|^\s*\*|toast\(|\.textContent|placeholder|aria-label|title=/.test(line)) {
    scanCopyText(rel, n, line, line)
  }
}

function scanCssLine(rel, n, line) {
  if (ALLOW_LINE.test(line)) return
  if (FUNCTIONAL_UI.test(line)) return
  for (const { id, re } of CSS_TELLS) {
    if (re.test(line)) {
      record(rel, n, 'css', id, line)
      break
    }
  }
}

function scanHtmlLine(rel, n, line) {
  if (ALLOW_LINE.test(line)) return
  if (FUNCTIONAL_UI.test(line)) return
  for (const { id, re } of UI_TELLS) {
    if (re.test(line)) {
      record(rel, n, 'ui', id, line)
      break
    }
  }
  scanCopyText(rel, n, line, line)
}

function walk(p) {
  let st
  try {
    st = statSync(p)
  } catch {
    return
  }
  if (st.isDirectory()) {
    const base = p.split('/').pop()
    if (SKIP_DIRS.has(base)) return
    for (const e of readdirSync(p)) walk(join(p, e))
    return
  }

  const ext = extname(p)
  const rel = relative(ROOT, p)
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    const n = i + 1
    if (CSS_EXTS.has(ext)) scanCssLine(rel, n, line)
    else if (TS_EXTS.has(ext)) scanTsLine(rel, n, line)
    else if (HTML_EXTS.has(ext)) scanHtmlLine(rel, n, line)
  })
}

for (const t of SCAN) walk(isAbsolute(t) ? t : join(ROOT, t))

if (hits.length === 0) {
  console.log(`✓ no AI-slop tells found in: ${SCAN.join(', ')}`)
  process.exit(0)
}

const order = { word: 0, phrase: 1, structure: 2, ui: 3, css: 4 }
hits.sort((a, b) => order[a.kind] - order[b.kind] || a.rel.localeCompare(b.rel) || a.n - b.n)

console.log(`✗ ${hits.length} AI-slop tell(s) found:\n`)
for (const h of hits) {
  const tag = h.kind.toUpperCase()
  const snip = h.line.length > 110 ? `${h.line.slice(0, 108)}…` : h.line
  console.log(`  ${h.rel}:${h.n}  [${tag}: ${h.match}]\n      ${snip}`)
}
console.log('\nFix copy/chrome, or add trailing "slop-allow". Rules: scripts/ai-slop-rules.mjs')
process.exit(1)