# ShellDeck → self-serve SaaS — build plan (2026-06-06)

Source: ultracode design workflow `wf_fc4c1f4b-f0c` (4 research subagents + synthesis).
Decisions locked: per-customer host = **Cloudflare Containers**; signup = **ShellDeck as a full spot-suite product** (catalog + buy form + `/v1/signup` + Stripe invoicing).

## ⚠️ Headline finding (verified vs live Cloudflare docs)
Cloudflare Containers conflicts with ShellDeck's core job (babysitting long-lived tmux/agent sessions) in two ways:
1. **All container disk is ephemeral** — sleep/eviction/redeploy wipes uploads, `*.json` config, **and running tmux/agent session state**. `keepAlive` reduces but does not eliminate eviction.
2. **No inbound raw TCP** — no public SSH *into* the box. The UI works over HTTP through a fronting Worker (WebSocket terminal is fine); outbound SSH-to-remote-hosts from inside the container still works with injected keys.

The plan ships on Containers as decided, designed to *survive* this (stateless-config build + best-effort sessions), and flags session-durability as the one soft spot. The "always-on agents" promise may later want a Fly.io/VM tier.

## Phases (safest-first, each independently shippable)
- **Phase 0 — GitHub CI-runs monitor** (ShellDeck only, S). New `src/gh_runs.rs` + `/api/gh-runs` + a "CI Runs" sidebar panel, mirroring the Remote Hosts panel. Env: `DASHBOARD_GH_REPOS`, `DASHBOARD_GH_TOKEN` (token env-only, never serialized/logged). *Building now via codex.*
- **Phase 1 — Containerization** (ShellDeck, M). Dockerfile (linux/amd64, tmux+ssh-client, non-root), config-from-env, `saas-stateless` Cargo feature (disables disk "save"), fix host assumptions in tmux.rs/term.rs, per-tenant socket. **Opt-in / feature-gated so code.falkinator.org keeps working unchanged.**
- **Phase 2 — Spot-suite product** (spot-suite config, M). Add `shelldeck` to `packages/pricing-catalog/src/catalog.json` (+ `ProductSlug`/`PlanCode` unions), `directPurchaseReady=false` until ready, Stripe price IDs via `STRIPE_PRICE_IDS_JSON` secret, product-logo art from the brand hub, landing copy. Go-live = flip `directPurchaseReady=true`.
- **Phase 3 — CF Containers provisioning** (spot-suite + ShellDeck, L, **codex-heavy**). Add `shelldeck` to provisioner `PRODUCT_REGISTRY_JSON`; fronting Worker (Host→tenant routing, CF Access, WebSocket passthrough, per-tenant envVars); ShellDeck CI publishes a linux/amd64 image bundle row; provisioner deploys+routes+secrets a per-customer container; entitlement unblock. Per-tenant stable `DASHBOARD_SECRET` (generated once, stored in Spot Suite secrets).

## Decisions needed from Falk (with my recommendations)
1. **Session-durability promise** (the caveat): v1 = *stateless config + best-effort sessions* on Containers, clearly messaged. *(rec)* Revisit Fly.io/VM for an always-on tier if customers need guaranteed long-lived agents.
2. **Pricing/tiers** (EUR, trial 90d like the suite): *(rec placeholder)* Solo €19/mo, Team €79/mo — needs your real numbers.
3. **Domain:** *(rec)* `{tenant}.shelldeck.com` (own domain, free Universal SSL, matches xevolve pattern). Needs shelldeck.com registered into the spotcloud CF account.
4. **CF cost ceiling:** always-on standard-1 ≈ €30-45/customer/mo. *(rec)* trial tier scales-to-zero (accepts idle session loss), paid tier keepAlive; set an aggregate cap.
5. **Default image CLIs:** *(rec)* ship claude + codex (+ maybe aider/opencode); customers add their own API keys via injected secrets.
6. **Azure Marketplace:** *(rec)* direct-buy + Stripe only for v1; Marketplace later.
7. **GH panel:** *(rec)* default OFF; a single shared `DASHBOARD_GH_TOKEN` is fine for your own instance.

## Phase 1 — what shipped

- `saas` Cargo feature: default builds remain host-style and strict; `--features saas` seeds UI state from env and treats settings/links/remote-hosts/share/uploads disk write failures as best-effort.
- New env: `DASHBOARD_PANELS` for SaaS panel defaults, `DASHBOARD_TMUX_SOCKET` for per-tenant `tmux -L` isolation, and `DASHBOARD_HOSTNAME` for a friendly displayed host/container name.
- Container: multi-stage `Dockerfile` builds `cargo build --release --features saas`, rebuilds frontend JS with Bun, runs as non-root `shelldeck`, and expects all secrets/config at runtime via env.

Local build/run:

```sh
podman build -t shelldeck:saas .
podman run --rm -p 8787:8787 \
  -e DASHBOARD_PASSWORD=replace-dev-password \
  -e DASHBOARD_UNLOCK_PASSWORD=replace-dev-unlock \
  -e DASHBOARD_SECRET=replace-with-32-plus-random-bytes \
  -e DASHBOARD_HOSTNAME=tenant-dev \
  -e DASHBOARD_TMUX_SOCKET=tenant-dev \
  -e DASHBOARD_AGENT_PRESETS=claude,codex,aider,opencode \
  -e DASHBOARD_PANELS=machine,containers,ci-runs,links,tickers \
  shelldeck:saas
```
