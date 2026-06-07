# ShellDeck → self-serve SaaS — build plan (2026-06-06)

Source: ultracode design workflow `wf_fc4c1f4b-f0c` (4 research subagents + synthesis).
Decisions locked: per-customer host = **isolated Docker container on the spot-tech-ci VM** (revised 2026-06-06 from Cloudflare Containers); signup = **ShellDeck as a full spot-suite product** (catalog + buy form + `/v1/signup` + Stripe invoicing). Pricing: Solo €29 / Team €99 /mo, 90-day trial, EUR. Domain: `{tenant}.spot-suite.com` for now → migrate to shelldeck.com once there are customers. Image CLIs: claude + codex + aider + opencode.

## ⚠️ Why the VM, not Cloudflare Containers
The earlier CF Containers plan had two conflicts with ShellDeck's core job (babysitting long-lived tmux/agent sessions): all container disk is ephemeral (sleep/eviction wipes running session state), and there's no inbound raw TCP. **Running each customer as an isolated Docker container on the spot-tech-ci VM solves both:**
- **Persistent disk** — a per-tenant Docker volume keeps tmux/agent session state, uploads, and config across restarts. The `saas` feature's best-effort/stateless behavior still applies but is no longer load-bearing.
- **No per-container cloud cost** — runs on hardware we already pay for (VM has ~6 GiB RAM + 120 GB free; headroom for many small tenants).
- **Existing fronting pattern** — the VM already runs a `cloudflared` container (remotely-managed tunnel). Each tenant gets a tunnel ingress rule + DNS + CF Access, exactly like dev.falkinator.org / glances.

**VM constraints (from recon 2026-06-06):** Docker (not podman) 29.1.3; the cloudflared tunnel is **shared** with production routes (autonomy-ev remark42, news-mcp, mail relay, bots) so ingress rules must be **appended, never replaced**; `127.0.0.1:8787` is already in use, so allocate per-tenant ports from a free range; production services on the box must not be disturbed.

## Phases (safest-first, each independently shippable)
- **Phase 0 — GitHub CI-runs monitor** (ShellDeck only, S). New `src/gh_runs.rs` + `/api/gh-runs` + a "CI Runs" sidebar panel, mirroring the Remote Hosts panel. Env: `DASHBOARD_GH_REPOS`, `DASHBOARD_GH_TOKEN` (token env-only, never serialized/logged). *Building now via codex.*
- **Phase 1 — Containerization** (ShellDeck, M). Dockerfile (linux/amd64, tmux+ssh-client, non-root), config-from-env, `saas-stateless` Cargo feature (disables disk "save"), fix host assumptions in tmux.rs/term.rs, per-tenant socket. **Opt-in / feature-gated so code.falkinator.org keeps working unchanged.**
- **Phase 2 — Spot-suite product** (spot-suite config, M). Add `shelldeck` to `packages/pricing-catalog/src/catalog.json` (+ `ProductSlug`/`PlanCode` unions), `directPurchaseReady=false` until ready, Stripe price IDs via `STRIPE_PRICE_IDS_JSON` secret, product-logo art from the brand hub, landing copy. Go-live = flip `directPurchaseReady=true`.
- **Phase 3 — VM provisioning** (ShellDeck ops + spot-suite, L). Revised to the VM/Docker model:
  - **Image publish** — ShellDeck CI builds the `--features saas` linux/amd64 image and pushes it to GHCR (`ghcr.io/spot-techno/shelldeck:saas`) on master, so the VM can `docker pull`.
  - **Tenant provisioner** (`ops/` script/agent, idempotent + teardown) — per tenant: allocate a free port; `docker run` the image with a per-tenant Docker volume (`sd-{tenant}-data`) and injected env (`DASHBOARD_PASSWORD`, `DASHBOARD_UNLOCK_PASSWORD`, stable `DASHBOARD_SECRET`, `DASHBOARD_TMUX_SOCKET=tenant`, `DASHBOARD_HOSTNAME`); register a cloudflared **ingress append** (`{tenant}.spot-suite.com → http://localhost:{port}`), a DNS CNAME to the tunnel, and a CF Access policy. **Reads current tunnel config and appends — never replaces** (shared production tunnel).
  - **Spot-suite wiring** — `shelldeck` provisioning topology = `vm_container` (diverges from the Worker+Pages+D1 path); the provisioner calls the VM agent (authenticated) on signup. v1 may start with manual/scripted provisioning before the automated trigger.
  - Go-live = flip `directPurchaseReady=true` + real Stripe price ids once a tenant provisions cleanly end-to-end.

## Decisions — locked (2026-06-06)
1. **Host / durability:** isolated Docker container per customer on the **spot-tech-ci VM** with a persistent volume — sessions survive. (Supersedes CF Containers + the ephemerality caveat.)
2. **Pricing/tiers:** Solo €29/mo, Team €99/mo (highlight), 90-day trial, EUR. *(Stripe price ids placeholder until go-live.)*
3. **Domain:** `{tenant}.spot-suite.com` for now (reuse the existing zone + shared tunnel) → migrate to shelldeck.com once there are paying customers.
4. **Cost ceiling:** n/a — runs on the existing VM; bound by VM RAM/disk, not per-container cloud billing. Watch aggregate VM load.
5. **Default image CLIs:** claude + codex + aider + opencode (preinstalled; customers bring their own API keys).
6. **Azure Marketplace:** direct-buy + Stripe only for v1; Marketplace later.
7. **GH panel:** default OFF; a single shared `DASHBOARD_GH_TOKEN` for your own instance.

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
