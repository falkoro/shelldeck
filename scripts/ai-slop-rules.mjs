/**
 * AI-slop rule corpus for ShellDeck.
 * Merged from spot-suite/docs/anti-ai-slop.md, check-ai-slop.mjs (spot-suite),
 * and a Grok 4.3 Hermes review (2026-06-07).
 *
 * Keep in sync with scripts/grok-review.py ANTI-AI-SLOP section.
 */

/** Skip entire line when matching functional ShellDeck UI or explicit allow. */
export const ALLOW_LINE = /slop-allow/
export const FUNCTIONAL_UI =
  /agent-badge|run-status-badge|ci-badges|session-tab|session-item|container-age|gh-run|ticker-chip|ticker-empty-chip|session-chip|attach-chip|run-branch-tag|shell-name-pill|unlock-|locked-note|name-spinner|card-label-|session-action-|shell-composer|shell-tools|terminal-meta|fmtTime|escapeHtml|icon\(|data-role/

/** Skip code-only lines (not operator-facing copy). */
export const CODE_LINE =
  /^\s*(import |export |from ['"]|const |let |var |function |class |if \(|for \(|while \(|switch |case |return |await |async |try \{|catch \(|finally|throw |\/\/|\/\*|\*\/|\}|\.style\.|addEventListener|removeEventListener|querySelector|getElementById|getAttribute|setAttribute|classList|dataset\.|push\(|pop\(|shift\(|map\(|filter\(|reduce\(|forEach\(|JSON\.|Math\.|Number\.|String\.|parseInt|parseFloat|typeof |instanceof |new Date|performance\.|requestAnimationFrame|cancelAnimationFrame|localStorage|sessionStorage|navigator\.|document\.|window\.|HTMLElement|SVGElement|MutationObserver|ResizeObserver|WebSocket|EventSource|postJson|getJson|fetch\(|AbortController|crypto\.|btoa|atob|encodeURI|decodeURI|split\(|join\(|slice\(|splice\(|indexOf|includes\(|startsWith|endsWith|replace\(|match\(|test\(|exec\(|trim\(|toLowerCase|toUpperCase|padStart|padEnd|scrollTop|scrollHeight|clientWidth|offsetHeight|getBoundingClientRect|createElement|appendChild|removeChild|innerHTML\s*=|textContent\s*=|value\s*=|checked\s*=|disabled\s*=|hidden\s*=|tabIndex|aria-|role=|type=|spellcheck|autocomplete|placeholder=.*tmux|Could not optimize image)/

/** Words banned in operator-facing copy (not code identifiers). */
export const WORDS = [
  'delve', 'leverage', 'foster', 'ignite', 'empower', 'unleash',
  'underscore', 'streamline', 'supercharge', 'seamless', 'seamlessly',
  'cutting-edge', 'state-of-the-art', 'best-in-class', 'future-ready',
  'future-proof', 'next-generation', 'next-gen', 'world-class',
  'game-changer', 'game-changing', 'transformative', 'revolutionary',
  'revolutionize', 'synergy', 'holistic', 'myriad', 'plethora',
  'multifaceted', 'pivotal', 'testament', 'beacon', 'tapestry', 'symphony',
  'elevate', 'robust', 'innovative', 'disrupt', 'redefine', 'reimagine',
  'boilerplate', 'production-ready', 'groundbreaking', 'bleeding-edge',
  'turnkey', 'plug-and-play', 'zero-config', 'out-of-the-box',
  'user-centric', 'frictionless', 'effortless', 'enterprise-grade',
  'pioneering', 'paradigm', 'cultivate', 'harness', 'optimise',
  'bespoke', 'myriad', 'multifaceted',
  // metaphor slop (flag in user strings; CODE_LINE usually skips technical use)
  'landscape', 'journey', 'ecosystem', 'realm',
]

/** Multi-word copy patterns. */
export const PHRASES = [
  { id: 'fast-paced-opener', re: /in today'?s\s+(fast-paced|ever-evolving|digital|modern|competitive)/i },
  { id: 'ever-evolving', re: /ever-evolving/i },
  { id: 'whether-you', re: /whether you'?re\b/i },
  { id: 'not-just-its', re: /it'?s not just\b.*\bit'?s\b/i },
  { id: 'more-than-just', re: /more than just a\b/i },
  { id: 'no-x-no-y-just', re: /\bno [a-z]+\.\s*no [a-z]+\.\s*just /i },
  { id: 'picture-this', re: /\bpicture this\b/i },
  { id: 'imagine-a-world', re: /imagine (a world|if you could|a future)/i },
  { id: 'as-a-role', re: /as a (developer|engineer|team|founder), you know/i },
  { id: 'dive-in', re: /\b(let'?s )?dive in\b/i },
  { id: 'heres-the-thing', re: /here'?s the thing\b/i },
  { id: 'real-talk', re: /\breal talk\b/i },
  { id: 'but-heres-the-kicker', re: /but here'?s the kicker\b/i },
  { id: 'at-end-of-day', re: /at the end of the day\b/i },
  { id: 'in-conclusion', re: /\bin conclusion\b/i },
  { id: 'ultimately', re: /\bultimately,\b/i },
  { id: 'in-essence', re: /\bin essence\b/i },
  { id: 'paradigm-shift', re: /paradigm shift/i },
  { id: 'trusted-by-vague', re: /trusted by (industry leaders|teams everywhere|thousands)/i },
  { id: 'trusted-by-teams-at', re: /trusted by teams at\b/i },
  { id: 'loved-by-teams', re: /loved by teams everywhere/i },
  { id: 'thousands-of-companies', re: /thousands of (companies|teams|users)/i },
  { id: 'elevate-workflow', re: /elevate your (workflow|experience|productivity)/i },
  { id: 'future-of', re: /the future of\b/i },
  { id: 'say-goodbye', re: /say goodbye to\b/i },
  { id: 'say-hello', re: /say hello to\b/i },
  { id: 'built-for-devs-by-devs', re: /built for developers,? by developers/i },
  { id: 'introducing-the', re: /introducing the\b/i },
  { id: 'meet-the', re: /meet the (all-new|new|next)/i },
  { id: 'welcome-to-the', re: /welcome to the\b/i },
  { id: 'redefining-the-way', re: /redefining the way\b/i },
  { id: 'reimagining-how', re: /reimagining how\b/i },
  { id: 'set-and-forget', re: /set it and forget it\b/i },
  { id: 'the-truth-is', re: /the truth is\b/i },
  { id: 'lets-be-honest', re: /let'?s be honest\b/i },
  { id: 'in-a-world-where', re: /in a world where\b/i },
  { id: 'as-easy-as', re: /as easy as\b/i },
  { id: 'just-works', re: /\bjust works\b/i },
  { id: 'ready-to-transform', re: /ready to (get started|level up|transform|supercharge)/i },
  { id: 'stop-struggling', re: /stop (struggling|wrestling|dealing) with\b/i },
  { id: 'built-with-love', re: /built with (love|care|passion)\b/i },
  { id: 'aims-to', re: /\baims to\b/i },
  { id: 'may-help', re: /\bmay help\b/i },
  { id: 'important-to-note', re: /it'?s important to note\b/i },
  { id: 'generally-speaking', re: /generally speaking\b/i },
  { id: 'three-reasons', re: /(three|four|five) (reasons|benefits|features|ways) (why|to)\b/i },
  { id: 'join-happy-users', re: /join \d+[kK]?\+? (happy|satisfied)/i },
  { id: 'powering-n-users', re: /(used by|powering|trusted by) \d+[kK]?\+?/i },
  { id: 'moreover-stack', re: /^\s*(Moreover|Furthermore|Additionally),/i },
]

/** Decorative marketing UI chrome in HTML/template strings. */
export const UI_TELLS = [
  { id: 'marketing-pill-class', re: /class(:list)?=["'][^"']*\b(eyebrow-pill|hero-badge|feature-badge|marketing-badge|promo-pill|status-pill)\b/ },
  { id: 'pill-chip-tag-class', re: /class(:list)?=["'][^"']*\b(pill|chip|tag)\b(?!-(line|row|container|empty))/ },
  { id: 'uppercase-launch-pill', re: />\s*(NEW|BETA|FEATURED|EARLY ACCESS|COMING SOON)\s*</ },
  { id: 'emoji-section-header', re: /[🆕✨🚀💡🔥🌟⭐️]\s*(Features|Benefits|Why|How|Highlights|Get Started)/ },
  { id: 'emoji-bullet-list', re: /[🆕✨🚀💡🔥🌟⭐️•]\s+\w+.*[🆕✨🚀💡🔥🌟⭐️•]/ },
  { id: 'fake-metric-card', re: /(metric|stat|kpi).{0,40}(users|developers|companies|stars|deploys).{0,20}\d+[kK]?\+?/i },
  { id: 'fake-trust-score', re: /trust score\s*\d+\s*\/\s*100/i },
  { id: 'tailwind-gradient-slop', re: /bg-gradient-to-(r|l|t|b|br|bl|tr|tl).*(purple|indigo|violet|teal|sky|rose|pink)/ },
  { id: 'tailwind-rounded-pill', re: /rounded-full[^"']{0,80}\b(px-[34]|py-1).{0,40}text-(xs|sm)/ },
  { id: 'tailwind-tone-pill', re: /rounded-full[^"']*\bbg-(emerald|amber|indigo|sky|rose|pink|violet)-(500|600|700|800|900)\b/ },
  { id: 'hero-stat-card', re: /(hero-stat|stat-card|metric-card|kpi-card)\b/i },
  { id: 'as-seen-in', re: /as seen in\b/i },
  { id: 'stock-team-photo', re: /(diverse team|team at laptop|people at computers)/i },
]

/** Vanilla CSS / app.css tells (ShellDeck is not Tailwind — catch real CSS slop). */
export const CSS_TELLS = [
  { id: 'gradient-mesh-purple', re: /radial-gradient\([^)]*(#7c3aed|#6366f1|#3b82f6|purple|indigo|violet|rebeccapurple)/i },
  { id: 'gradient-mesh-multi-blob', re: /radial-gradient\([^)]*,\s*radial-gradient\(/i },
  { id: 'linear-gradient-blob', re: /linear-gradient\([^)]*(135deg|120deg)[^)]*(#7c3aed|#6366f1|#8b5cf6|purple)/i },
  { id: 'inter-only-stack', re: /font-family:\s*["']?Inter["']?\s*,\s*(system-ui|sans-serif)/i },
  { id: 'generic-hero-glow', re: /\.(hero|banner|glow|orb|blob)\b[^{]*\{[^}]*(box-shadow:\s*0\s+0\s+\d+px|filter:\s*blur)/i },
  { id: 'uniform-card-shadow-stack', re: /border-radius:\s*(16|20|24)px[^}]*box-shadow:\s*0\s+\d+px\s+\d+px[^}]*border-radius:\s*(16|20|24)px/ },
  { id: 'marketing-eyebrow-pill-css', re: /\.(eyebrow-pill|hero-badge|feature-badge|marketing-badge)\b/ },
  { id: 'uppercase-tracking-pill', re: /border-radius:\s*999px[^}]*text-transform:\s*uppercase[^}]*letter-spacing:\s*0\.(1|2|3)em/i },
]

/** Structural copy tells — checked in extracted string literals and comments. */
export const STRUCTURE_TELLS = [
  { id: 'tricolon-heading', re: /^(fast|simple|secure|easy|powerful|flexible),?\s+(simple|secure|reliable|fast),?\s+(and|&)\s+\w+/i },
  { id: 'rhetorical-section-h', re: /^(Why|How|What|Who) .+\?$/ },
  { id: 'ellipsis-teaser', re: /\.{3}.*\.{3}/ },
]