#!/usr/bin/env python3
"""ShellDeck per-customer tenant provisioner (spot-tech-ci VM / Docker).

One isolated Docker container per tenant, fronted by the VM's *shared* cloudflared
tunnel. Because that tunnel also serves production routes (autonomy-ev comments,
news-mcp, mail, bots), ingress edits are strictly read-modify-write: every existing
rule is preserved and the http_status:404 catch-all stays last. No secret is printed.

Runs ON the VM (docker local). Auth via a *scoped* CF token (DNS:Edit on the zone +
Cloudflare Tunnel:Edit on the account) — never the global key. Config via env:
SD_CF_TOKEN (required), SD_CF_ACCOUNT, SD_CF_ZONE, SD_TUNNEL_ID, SD_ROOT_DOMAIN,
SD_IMAGE, SD_NETWORK (cloudflared's docker net), SD_SECRETS_DIR (0600 tenant envs).

Usage: provision_tenant.py {plan|provision|teardown|list} <tenant> [--plan-code solo|team] [--yes]
"""
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

ACCOUNT = os.environ.get("SD_CF_ACCOUNT", "3357d9740fb8e64bc1a8cb07a4e96da6")
ZONE = os.environ.get("SD_CF_ZONE", "31e27309f010a10619bf53821397c130")
TUNNEL = os.environ.get("SD_TUNNEL_ID", "77bc93f6-9cc5-4c5e-ade3-a320a3a6b760")
ROOT = os.environ.get("SD_ROOT_DOMAIN", "spot-suite.com")
IMAGE = os.environ.get("SD_IMAGE", "ghcr.io/falkoro/shelldeck:saas")
NETWORK = os.environ.get("SD_NETWORK", "discord-bot-runner_default")
SECRETS_DIR = os.path.expanduser(os.environ.get("SD_SECRETS_DIR", "~/.shelldeck-tenants"))
API = "https://api.cloudflare.com/client/v4"


def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def token():
    t = os.environ.get("SD_CF_TOKEN", "").strip()
    return t or die("SD_CF_TOKEN is required (scoped CF token; not the global key)")


def cf(method, path, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Authorization", "Bearer " + token())
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            payload = json.load(r)
    except urllib.error.HTTPError as e:
        payload = json.load(e)
    if not payload.get("success"):
        die(f"CF API {method} {path} failed: {payload.get('errors')}")
    return payload["result"]


def valid_tenant(t):
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?", t or ""):
        die(f"invalid tenant slug '{t}' (lowercase alnum + dashes, <=40)")
    return t


def hostname(t):
    return f"{t}.{ROOT}"


def container(t):
    return f"sd-{t}"


# --- tunnel ingress (read-modify-write, catch-all stays last) ---
def get_config():
    return cf("GET", f"/accounts/{ACCOUNT}/cfd_tunnel/{TUNNEL}/configurations")


def put_config(config):
    cf("PUT", f"/accounts/{ACCOUNT}/cfd_tunnel/{TUNNEL}/configurations", {"config": config})


def show_ingress(ingress, label):
    print(f"  {label} ({len(ingress)} rules):")
    for r in ingress:
        print(f"    - {r.get('hostname', '(catch-all)')} -> {r.get('service')}")


def upsert_ingress(t, apply):
    res = get_config()
    config = res.get("config") or {}
    ingress = list(config.get("ingress") or [])
    show_ingress(ingress, "current")
    host, svc = hostname(t), f"http://{container(t)}:8787"
    rest = [r for r in ingress if r.get("hostname") != host]
    catchall = [r for r in rest if not r.get("hostname")]
    keep = [r for r in rest if r.get("hostname")]
    new_ingress = keep + [{"hostname": host, "service": svc}] + (catchall or [{"service": "http_status:404"}])
    show_ingress(new_ingress, "planned")
    if not apply:
        print("  (plan only — no write)")
        return
    config["ingress"] = new_ingress
    put_config(config)
    print(f"  ingress updated: {host} -> {svc}")


def remove_ingress(t):
    res = get_config()
    config = res.get("config") or {}
    ingress = list(config.get("ingress") or [])
    host = hostname(t)
    if not any(r.get("hostname") == host for r in ingress):
        print(f"  ingress: no rule for {host}")
        return
    keep = [r for r in ingress if r.get("hostname") and r.get("hostname") != host]
    catchall = [r for r in ingress if not r.get("hostname")] or [{"service": "http_status:404"}]
    config["ingress"] = keep + catchall
    put_config(config)
    print(f"  ingress removed: {host}")


# --- DNS (CNAME -> tunnel) ---
def find_dns(host):
    recs = cf("GET", f"/zones/{ZONE}/dns_records?type=CNAME&name={host}")
    return recs[0] if recs else None


def ensure_dns(t, apply):
    host = hostname(t)
    rec = find_dns(host)
    target = f"{TUNNEL}.cfargotunnel.com"
    if rec:
        print(f"  dns: {host} already CNAME -> {rec['content']}")
        return
    print(f"  dns: {'would create' if not apply else 'creating'} {host} CNAME -> {target} (proxied)")
    if apply:
        cf("POST", f"/zones/{ZONE}/dns_records",
           {"type": "CNAME", "name": host, "content": target, "proxied": True})


def remove_dns(t):
    rec = find_dns(hostname(t))
    if not rec:
        print(f"  dns: no record for {hostname(t)}")
        return
    cf("DELETE", f"/zones/{ZONE}/dns_records/{rec['id']}")
    print(f"  dns removed: {hostname(t)}")


# --- docker (local) ---
def docker(*args, capture=False):
    r = subprocess.run(["docker", *args], capture_output=True, text=True)
    if capture:
        return r.stdout.strip(), r.returncode
    if r.returncode != 0:
        die(f"docker {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def tenant_env(t, plan_code):
    os.makedirs(SECRETS_DIR, mode=0o700, exist_ok=True)
    path = os.path.join(SECRETS_DIR, f"{t}.env")
    if os.path.exists(path):
        return path
    env = {
        "DASHBOARD_PASSWORD": secrets.token_urlsafe(24),
        "DASHBOARD_UNLOCK_PASSWORD": secrets.token_urlsafe(24),
        "DASHBOARD_SECRET": secrets.token_urlsafe(48),
        "DASHBOARD_HOSTNAME": t,
        "DASHBOARD_TMUX_SOCKET": t,
        "DASHBOARD_PLAN": plan_code or "solo",
        "DASHBOARD_AGENT_PRESETS": "claude,codex,aider,opencode",
    }
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.writelines(f"{k}={v}\n" for k, v in env.items())
    print(f"  secrets: generated {path} (0600)")
    return path


def run_container(t, plan_code, apply):
    name = container(t)
    existing, _ = docker("ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.Names}}", capture=True)
    env_path = tenant_env(t, plan_code) if apply else "(generated on apply)"
    if not apply:
        print(f"  docker: would run {name} on {NETWORK}, volume sd-{t}-data, --env-file {env_path}")
        return
    if existing == name:
        print(f"  docker: {name} exists — recreating")
        docker("rm", "-f", name)
    docker("run", "-d", "--name", name, "--restart", "unless-stopped",
           "--network", NETWORK, "-v", f"sd-{t}-data:/home/shelldeck/data",
           "--env-file", env_path, IMAGE)
    print(f"  docker: {name} started")


# --- commands ---
def cmd_plan(t, plan_code):
    print(f"PLAN tenant '{t}' -> https://{hostname(t)} (read-only)")
    upsert_ingress(t, apply=False)
    ensure_dns(t, apply=False)
    run_container(t, plan_code, apply=False)


def cmd_provision(t, plan_code, yes):
    print(f"PROVISION tenant '{t}' -> https://{hostname(t)}")
    if not yes:
        die("refusing to write without --yes (this mutates the shared production tunnel)")
    run_container(t, plan_code, apply=True)
    ensure_dns(t, apply=True)
    upsert_ingress(t, apply=True)
    print(f"DONE. https://{hostname(t)} (login with the generated DASHBOARD_PASSWORD)")


def cmd_teardown(t, yes):
    print(f"TEARDOWN tenant '{t}'")
    if not yes:
        die("refusing to teardown without --yes")
    remove_ingress(t)
    remove_dns(t)
    name = container(t)
    _, rc = docker("rm", "-f", name, capture=True)
    print(f"  docker: removed {name}" if rc == 0 else f"  docker: {name} not running")
    print("  (volume sd-%s-data kept; remove manually if intended)" % t)


def cmd_list():
    out, _ = docker("ps", "-a", "--filter", "name=^sd-", "--format", "{{.Names}}\t{{.Status}}", capture=True)
    print(out or "(no sd-* tenant containers)")


def main():
    args = sys.argv[1:]
    if not args:
        die("usage: provision_tenant.py {plan|provision|teardown|list} <tenant> [--plan-code X] [--yes]")
    action = args[0]
    yes = "--yes" in args
    plan_code = None
    if "--plan-code" in args:
        plan_code = args[args.index("--plan-code") + 1]
    rest = [a for a in args[1:] if not a.startswith("--") and a not in (plan_code or "",)]
    if action == "list":
        return cmd_list()
    t = valid_tenant(rest[0] if rest else None)
    if action == "plan":
        cmd_plan(t, plan_code)
    elif action == "provision":
        cmd_provision(t, plan_code, yes)
    elif action == "teardown":
        cmd_teardown(t, yes)
    else:
        die(f"unknown action '{action}'")


if __name__ == "__main__":
    main()
