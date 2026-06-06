#!/usr/bin/env python3
"""Cloudflare API helpers for the ShellDeck tenant provisioner.

Tunnel ingress + DNS + Access, all read-modify-write and append-only against the
*shared* spot-tech-ci tunnel (production routes must be preserved; catch-all stays
last). Auth via a scoped CF token (SD_CF_TOKEN) — never the global key. No secret
is ever printed. See provision_tenant.py for the CLI.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

ACCOUNT = os.environ.get("SD_CF_ACCOUNT", "3357d9740fb8e64bc1a8cb07a4e96da6")
ZONE = os.environ.get("SD_CF_ZONE", "31e27309f010a10619bf53821397c130")
TUNNEL = os.environ.get("SD_TUNNEL_ID", "77bc93f6-9cc5-4c5e-ade3-a320a3a6b760")
ROOT = os.environ.get("SD_ROOT_DOMAIN", "spot-suite.com")
API = "https://api.cloudflare.com/client/v4"


def die(msg):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _token():
    t = os.environ.get("SD_CF_TOKEN", "").strip()
    return t or die("SD_CF_TOKEN is required (scoped CF token; not the global key)")


def cf(method, path, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Authorization", "Bearer " + _token())
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


# --- tunnel ingress (catch-all stays last) ---
def _get_config():
    return cf("GET", f"/accounts/{ACCOUNT}/cfd_tunnel/{TUNNEL}/configurations")


def _put_config(config):
    cf("PUT", f"/accounts/{ACCOUNT}/cfd_tunnel/{TUNNEL}/configurations", {"config": config})


def _show(ingress, label):
    print(f"  {label} ({len(ingress)} rules):")
    for r in ingress:
        print(f"    - {r.get('hostname', '(catch-all)')} -> {r.get('service')}")


def upsert_ingress(host, service, apply):
    res = _get_config()
    config = res.get("config") or {}
    ingress = list(config.get("ingress") or [])
    _show(ingress, "current")
    rest = [r for r in ingress if r.get("hostname") != host]
    keep = [r for r in rest if r.get("hostname")]
    catchall = [r for r in rest if not r.get("hostname")] or [{"service": "http_status:404"}]
    new_ingress = keep + [{"hostname": host, "service": service}] + catchall
    _show(new_ingress, "planned")
    if not apply:
        print("  (plan only — no write)")
        return
    config["ingress"] = new_ingress
    _put_config(config)
    print(f"  ingress updated: {host} -> {service}")


def remove_ingress(host):
    res = _get_config()
    config = res.get("config") or {}
    ingress = list(config.get("ingress") or [])
    if not any(r.get("hostname") == host for r in ingress):
        print(f"  ingress: no rule for {host}")
        return
    keep = [r for r in ingress if r.get("hostname") and r.get("hostname") != host]
    catchall = [r for r in ingress if not r.get("hostname")] or [{"service": "http_status:404"}]
    config["ingress"] = keep + catchall
    _put_config(config)
    print(f"  ingress removed: {host}")


# --- DNS (CNAME -> tunnel) ---
def _find_dns(host):
    recs = cf("GET", f"/zones/{ZONE}/dns_records?type=CNAME&name={host}")
    return recs[0] if recs else None


def ensure_dns(host, apply):
    if _find_dns(host):
        print(f"  dns: {host} CNAME already present")
        return
    target = f"{TUNNEL}.cfargotunnel.com"
    print(f"  dns: {'would create' if not apply else 'creating'} {host} CNAME -> {target} (proxied)")
    if apply:
        cf("POST", f"/zones/{ZONE}/dns_records",
           {"type": "CNAME", "name": host, "content": target, "proxied": True})


def remove_dns(host):
    rec = _find_dns(host)
    if not rec:
        print(f"  dns: no record for {host}")
        return
    cf("DELETE", f"/zones/{ZONE}/dns_records/{rec['id']}")
    print(f"  dns removed: {host}")


# --- Access (email one-time-PIN in front of the tenant) ---
def _find_app(host):
    apps = cf("GET", f"/accounts/{ACCOUNT}/access/apps?per_page=200")
    return next((a for a in apps if a.get("domain") == host), None)


def ensure_access(host, email, apply):
    if not email:
        print("  access: no SD_TENANT_EMAIL set — skipping (dashboard stays gated by its own guard)")
        return
    if _find_app(host):
        print(f"  access: app for {host} already exists")
        return
    print(f"  access: {'would create' if not apply else 'creating'} email-OTP app for {host} -> {email}")
    if not apply:
        return
    app = cf("POST", f"/accounts/{ACCOUNT}/access/apps", {
        "name": f"ShellDeck {host}", "domain": host, "type": "self_hosted",
        "session_duration": "24h", "app_launcher_visible": False,
    })
    cf("POST", f"/accounts/{ACCOUNT}/access/apps/{app['id']}/policies", {
        "name": f"allow {email}", "decision": "allow",
        "include": [{"email": {"email": email}}],
    })
    print(f"  access: app + email-OTP policy created for {email}")


def remove_access(host):
    app = _find_app(host)
    if not app:
        print(f"  access: no app for {host}")
        return
    cf("DELETE", f"/accounts/{ACCOUNT}/access/apps/{app['id']}")
    print(f"  access: app removed for {host}")
