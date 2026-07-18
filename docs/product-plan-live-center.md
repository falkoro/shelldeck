# ShellDeck product plan — live-center era

**Status:** active after #118–#122  
**Last updated:** 2026-07-18  
**Layout contract:** Conversation (left) · Live tmux (center) · Monitor (right)

## Product vision

ShellDeck is a **session cockpit**: pick an agent/tmux session, see what it is doing, attach live, and glance at host health. It is not a card grid of scrollback previews.

Success looks like:

1. Unlock once → click a session → type in a full-size live terminal.
2. Conversation sidebar always answers “what is each session working on?”
3. Monitor rail is optional noise (hide with **Monitor**), never competes with the terminal.
4. Code stays maintainable: **≤250 lines per source file**.

## What we already shipped

| PR | Outcome |
|----|---------|
| #118 | Session rail + pins (too much chrome) |
| #120 | Palette / unread / multi-select (overloaded) |
| #121 | Dropped left rail; conversation in sidebar |
| #122 | **Live center** — no preview cards; monitor on the right |

## Near-term product improvements (priority)

### P0 — polish the live-center contract

1. **Empty / offline states**  
   Offline session selected → clear empty state with “Create tmux” / “Session offline”, not a black void.

2. **Unlock path**  
   Unlock panel only on the left; inline unlock in the stage when locked (already started) — one obvious path.

3. **Session switch performance**  
   Keep previous terminal WS warm (or fast reconnect) when switching tabs; avoid full recreate thrash.

4. **Mobile**  
   Conversation collapses above stage; monitor stacks below; live stage ≥55svh.

### P1 — conversation quality

5. **Per-session conversation snippet** from pane + Hermes summary, not only the global blob.  
6. **Unread indicators** only on the conversation list (already partially there).  
7. **Pin agents by default** stays; pin control stays small (no multi-select UI).

### P2 — monitor & ops

8. Collapse Machine / Containers into compact cards by default.  
9. CI Runs panel stays opt-in.  
10. Safe-shot / tickers stay secondary (top bar only).

### Explicit non-goals (now)

- Bringing back shell preview cards as the main surface  
- SaaS multi-tenant packaging (separate `shelldeck-saas-plan.md`)  
- Themes marketplace / mobile native apps  

## Engineering plan — 250-line file limit

### Rule

- **Hard max ~250 lines** for `frontend/**/*.ts` and new Rust modules.  
- Enforced by `bun run file:size` (CI-friendly).  
- Compiled `public/*.js` mirrors TS; do not hand-edit.  
- Giant legacy Rust (`routes.rs`, `summary.rs`, `config.rs`) tracked as **Phase B** below.

### Phase A (this PR) — frontend under 250

| Oversized | Split into |
|-----------|------------|
| `actions.ts` (~1147) | `actions-settings`, `actions-safe-shot`, `actions-dictation`, `actions-images`, `actions` (shell I/O) |
| `metrics.ts` (~865) | `metrics-machine`, `metrics-containers`, `metrics-remote`, `metrics` (orchestrate) |
| `core.ts` (~763) | `core-types`, `core-icons`, `core-labels`, `core` (session + activity) |
| `events.ts` (~690) | `events-click`, `events-keys`, `events` (boot wiring) |
| `prefs.ts` (~400) | `prefs-privacy`, `prefs-shell-meta`, `prefs` (view/sidebar) |
| `terminal-window.ts` (~277) | `terminal-dock`, `terminal-window` (lifecycle) |

Script load order in `pages.rs` `VERSIONED_ASSETS` must match dependency order (types/icons → core → prefs → … → events last).

### Phase B — Rust modules under 250

- `routes.rs` → route groups (`routes_api`, `routes_assets`, `routes_auth`)  
- `summary.rs` → provider adapters  
- `config.rs` → env parse / known sessions  
- Gate with the same `file:size` tool extended to `src/**/*.rs` once splits land.

### Phase C — product P0 items

Implement empty/offline stage copy, warm reconnect, mobile stack QA — separate PR after Phase A.

## Acceptance for “done” on this plan slice

- [x] Product plan document in repo  
- [x] All `frontend/**/*.ts` ≤ 250 lines  
- [x] `bun run file:size` fails on regressions  
- [x] `bun run build:frontend` + `cargo test` green  
- [x] Live layout unchanged in behavior (conversation | live stage | monitor)  
- [x] AGENTS.md notes the 250-line rule  

## Open decisions

- Whether monitor defaults **hidden** on first visit (recommend: shown on desktop, hidden on ≤760px).  
- Whether shell tabs stay under the stage title or move into the conversation list only (recommend: keep thin tabs for keyboard cycle).
