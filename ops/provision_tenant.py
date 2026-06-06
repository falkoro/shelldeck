#!/usr/bin/env python3
"""ShellDeck per-customer tenant provisioner (spot-tech-ci VM / Docker).

One isolated Docker container per tenant, fronted by the VM's *shared* cloudflared
tunnel + a per-tenant Cloudflare Access (email one-time-PIN) app. Tunnel/DNS/Access
edits are append-only and preserve production routes — see sd_cf.py. No secret is
ever printed. Runs ON the VM (docker local); CF auth via a scoped SD_CF_TOKEN.

Env: SD_CF_TOKEN (required), SD_TENANT_EMAIL (customer login email for Access),
SD_IMAGE (default ghcr.io/falkoro/shelldeck:saas), SD_NETWORK (cloudflared's docker
net, default discord-bot-runner_default), SD_SECRETS_DIR (0600 tenant envs), plus
the SD_CF_* / SD_TUNNEL_ID / SD_ROOT_DOMAIN knobs read by sd_cf.

Usage: provision_tenant.py {plan|provision|teardown|list} <tenant> [--plan-code solo|team] [--yes]
"""
import os
import secrets
import subprocess
import sys

import sd_cf
from sd_cf import die, hostname, valid_tenant

IMAGE = os.environ.get("SD_IMAGE", "ghcr.io/falkoro/shelldeck:saas")
NETWORK = os.environ.get("SD_NETWORK", "discord-bot-runner_default")
SECRETS_DIR = os.path.expanduser(os.environ.get("SD_SECRETS_DIR", "~/.shelldeck-tenants"))
EMAIL = os.environ.get("SD_TENANT_EMAIL", "").strip()


def container(t):
    return f"sd-{t}"


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
        "DASHBOARD_ALLOWED_ORIGINS": f"https://{hostname(t)}",
    }
    if EMAIL:
        env["DASHBOARD_TRUST_CF_ACCESS_EMAIL"] = "1"
        env["DASHBOARD_ALLOWED_EMAILS"] = EMAIL
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.writelines(f"{k}={v}\n" for k, v in env.items())
    print(f"  secrets: generated {path} (0600)")
    return path


def run_container(t, plan_code, apply):
    name = container(t)
    if not apply:
        print(f"  docker: would run {name} on {NETWORK}, volume sd-{t}-data, env-file (generated on apply)")
        return
    env_path = tenant_env(t, plan_code)
    existing, _ = docker("ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.Names}}", capture=True)
    if existing == name:
        print(f"  docker: {name} exists — recreating")
        docker("rm", "-f", name)
    docker("run", "-d", "--name", name, "--restart", "unless-stopped",
           "--network", NETWORK, "-v", f"sd-{t}-data:/home/shelldeck/data",
           "--env-file", env_path, IMAGE)
    print(f"  docker: {name} started")


def cmd_plan(t, plan_code):
    host = hostname(t)
    print(f"PLAN tenant '{t}' -> https://{host} (read-only)")
    sd_cf.upsert_ingress(host, f"http://{container(t)}:8787", apply=False)
    sd_cf.ensure_dns(host, apply=False)
    sd_cf.ensure_access(host, EMAIL, apply=False)
    run_container(t, plan_code, apply=False)


def cmd_provision(t, plan_code, yes):
    host = hostname(t)
    print(f"PROVISION tenant '{t}' -> https://{host}")
    if not yes:
        die("refusing to write without --yes (this mutates the shared production tunnel)")
    run_container(t, plan_code, apply=True)
    sd_cf.ensure_dns(host, apply=True)
    sd_cf.ensure_access(host, EMAIL, apply=True)
    sd_cf.upsert_ingress(host, f"http://{container(t)}:8787", apply=True)
    print(f"DONE. https://{host}" + (f" (Access email-OTP -> {EMAIL})" if EMAIL else ""))


def cmd_teardown(t, yes):
    host = hostname(t)
    print(f"TEARDOWN tenant '{t}'")
    if not yes:
        die("refusing to teardown without --yes")
    sd_cf.remove_access(host)
    sd_cf.remove_ingress(host)
    sd_cf.remove_dns(host)
    _, rc = docker("rm", "-f", container(t), capture=True)
    print(f"  docker: removed {container(t)}" if rc == 0 else f"  docker: {container(t)} not running")
    print(f"  (volume sd-{t}-data kept; remove manually if intended)")


def cmd_list():
    out, _ = docker("ps", "-a", "--filter", "name=^sd-", "--format", "{{.Names}}\t{{.Status}}", capture=True)
    print(out or "(no sd-* tenant containers)")


def main():
    args = sys.argv[1:]
    if not args:
        die("usage: provision_tenant.py {plan|provision|teardown|list} <tenant> [--plan-code X] [--yes]")
    action = args[0]
    yes = "--yes" in args
    plan_code = args[args.index("--plan-code") + 1] if "--plan-code" in args else None
    rest = [a for a in args[1:] if not a.startswith("--") and a != plan_code]
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
