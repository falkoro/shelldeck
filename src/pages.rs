use crate::{config::Config, tmux::SessionModel, webutil::html_escape};

pub fn blocked() -> String {
    r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071017"><title>Access blocked</title><link rel="stylesheet" href="/assets/app.css"></head><body class="center-page"><main class="message-panel danger"><div class="mark">!</div><h1>Not from an allowed route</h1><p class="muted">This dashboard only accepts your approved network IP or a Cloudflare Access identity for the allowed email.</p></main></body></html>"##.to_string()
}

pub fn login(config: &Config, message: &str) -> String {
    format!(
        r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071017"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="ShellDeck"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/app.css"><title>ShellDeck Login</title></head><body class="center-page"><main class="login-panel"><div class="login-logo"><img class="brand-logo small" src="/assets/shelldeck-logo.png" alt="" width="44" height="44"><div><h1>ShellDeck</h1><p class="muted">Live tmux + agent dashboard</p></div></div><form method="post" action="/login"><label for="username">User</label><input id="username" name="username" autocomplete="username" value="{}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus><div class="error">{}</div><button class="primary wide" type="submit">Sign in</button></form></main></body></html>"##,
        html_escape(&config.user),
        html_escape(message)
    )
}

pub fn dashboard(model: &SessionModel, config: &Config) -> String {
    let data = serde_json::to_string(model)
        .unwrap_or_else(|_| "{}".to_string())
        .replace('<', "\\u003c");
    let safe_shot_btn = if config.enable_safe_shot {
        r##"<button class="ghost" id="safeShotBtn" type="button"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4 13 2H7L5.5 4H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-6.5Z"/><circle cx="12" cy="12" r="3.5"/><path d="M20 8h.01"/></svg><span>Safe shot</span></button>"##
    } else {
        ""
    };
    let v = asset_ver(config);
    let html = format!(
        r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071017"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="ShellDeck"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/xterm.css"><link rel="stylesheet" href="/assets/app.css"><title>ShellDeck</title></head><body><script type="application/json" id="initial-model">{}</script><main class="shell"><header class="topbar"><div class="brand"><img class="brand-logo" src="/assets/shelldeck-logo.png" alt="" width="50" height="50"><div><h1>ShellDeck</h1><div class="status-line"><span class="pill">{}</span><span class="pill" id="updated">syncing</span><span class="pill access-pill" id="accessState">shells locked</span></div></div></div><div class="topbar-privacy" aria-label="Container privacy"><button type="button" class="ghost container-privacy-toggle" data-container-privacy="local" title="Blur local container text" aria-label="Blur local container text"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg><span>Local</span></button><button type="button" class="ghost container-privacy-toggle" data-container-privacy="remote" title="Blur remote container text" aria-label="Blur remote container text"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg><span>Remote</span></button></div><div class="ticker-strip" id="tickerStrip"><div class="ticker-bar" id="tickerBar"><span class="ticker-empty">No tickers configured</span></div><button type="button" id="editTickersBtn"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg><span>Edit tickers</span></button></div><div class="top-actions">{}<button class="primary" id="refreshBtn" type="button"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Refresh</span></button><a class="button ghost" href="/logout"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Sign out</span></a></div></header>{}<div class="toast" id="toast" role="status" aria-live="polite" aria-atomic="true"></div><div id="bootSplash" aria-hidden="true"><div class="boot-card"><img class="brand-logo" src="/assets/shelldeck-logo.png" alt="" width="54" height="54"><div class="boot-spinner"></div><div class="boot-title">ShellDeck</div></div></div><script src="/assets/xterm.js"></script><script src="/assets/addon-fit.js"></script><script src="/assets/core.js"></script><script src="/assets/prefs.js"></script><script src="/assets/render.js"></script><script src="/assets/actions.js"></script><script src="/assets/terminal.js"></script><script src="/assets/metrics.js"></script><script src="/assets/events.js"></script><script>setTimeout(()=>document.body.classList.add('booted'),4000);</script></body></html>"##,
        data,
        html_escape(&model.hostname),
        safe_shot_btn,
        workspace(&links_panel_html(config))
    );
    bust_assets(&html, &v)
}

// Cache-bust the app's own CSS/JS so a stale browser/CDN copy can't serve old code: the origin
// sends no-cache, but Cloudflare overrides that to a 4h max-age and caches the assets. The HTML
// is no-store (always fresh), so a versioned URL is what forces the browser to refetch the CSS/JS
// after every deploy or hot-reloaded CSS edit. Version = newest mtime among the app's own files.
const VERSIONED_ASSETS: [&str; 8] = [
    "app.css",
    "core.js",
    "prefs.js",
    "render.js",
    "actions.js",
    "terminal.js",
    "metrics.js",
    "events.js",
];

fn asset_ver(config: &Config) -> String {
    let dir = config.root_dir.join("public");
    let mut newest: u64 = 0;
    for name in VERSIONED_ASSETS {
        if let Ok(t) = std::fs::metadata(dir.join(name)).and_then(|m| m.modified()) {
            if let Ok(d) = t.duration_since(std::time::UNIX_EPOCH) {
                newest = newest.max(d.as_secs());
            }
        }
    }
    newest.to_string()
}

fn bust_assets(html: &str, v: &str) -> String {
    let mut out = html.to_string();
    for name in VERSIONED_ASSETS {
        out = out.replace(
            &format!("/assets/{name}\""),
            &format!("/assets/{name}?v={v}\""),
        );
    }
    out
}

// Configurable quick links (DASHBOARD_LINKS) rendered as a sidebar panel.
fn links_panel_html(config: &Config) -> String {
    let ext = r##"<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>"##;
    let items: String = config.quick_links.iter().map(|(label, url)| {
        format!(r##"<a class="link-item" href="{}" target="_blank" rel="noopener noreferrer">{}<span>{}</span></a>"##, html_escape(url), ext, html_escape(label))
    }).collect();
    let items = if items.is_empty() {
        r#"<div class="muted links-empty">No links configured</div>"#.to_string()
    } else {
        items
    };
    format!(
        r##"<section class="panel links-panel" id="linksPanel"><div class="panel-header"><div><h2>Links</h2><p class="muted">Quick jumps</p></div><button type="button" id="editLinksBtn"><span>Edit</span></button></div><div class="links-grid" id="linksGrid">{}</div></section>"##,
        items
    )
}

fn workspace(links_panel: &str) -> String {
    let ci_runs_panel = r#"<section class="panel ci-runs-panel" id="ciRunsPanel" hidden><div class="panel-header"><div><h2>CI Runs</h2><p class="muted">GitHub Actions latest status</p></div></div><div class="gh-runs-list" id="ciRunsList" aria-live="polite"><div class="skel-host"><div class="skeleton skel-line skel-w50"></div><div class="skeleton skel-bar"></div><div class="skeleton skel-line skel-w70"></div></div></div></section>"#;
    format!(
        r#"<div class="workspace compact"><aside class="sidebar"><div class="sidebar-head"><span class="sidebar-head-title">Dashboard</span><button class="ghost sidebar-gear" id="settingsBtn" type="button"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.36.45.7.6 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-.5 1Z"/></svg><span>Configure</span></button></div><section class="panel metrics-panel" id="metricsPanel"><div class="panel-header"><div><h2>Machine</h2><p class="muted" id="metricsHost">—</p></div></div><div class="metrics loading"><div class="metric"><div class="metric-top"><span>CPU</span><span data-m="cpu">—</span></div><div class="meter"><i data-bar="cpu"></i></div></div><div class="metric"><div class="metric-top"><span>RAM</span><span data-m="mem">—</span></div><div class="meter"><i data-bar="mem"></i></div></div><div class="metric-temps" id="metricTemps"></div><div class="metric-load muted" id="metricLoad">—</div></div></section><section class="panel remote-panel" id="remotePanel"><div class="panel-header"><div><h2>Remote Hosts</h2><p class="muted">Server ping and containers</p></div><div class="panel-actions"><button type="button" id="editRemoteHostsBtn"><span>Edit</span></button></div></div><div class="remote-list" id="remoteHostList" aria-live="polite"><div class="skel-host"><div class="skeleton skel-line skel-w50"></div><div class="skeleton skel-bar"></div><div class="skeleton skel-bar"></div><div class="skeleton skel-line skel-w70"></div><div class="skeleton skel-crow"></div><div class="skeleton skel-crow"></div><div class="skeleton skel-crow"></div></div></div></section><section class="panel containers-panel" id="containersPanel"><div class="panel-header"><div><h2>Local Containers</h2><p class="muted">Docker and Podman</p></div></div><div class="container-list" id="containerList" aria-live="polite"><div class="skeleton skel-crow"></div><div class="skeleton skel-crow"></div><div class="skeleton skel-crow"></div></div></section><section class="panel unlock-panel" id="unlockPanel"><div><h2>Shell Unlock</h2><p class="muted">Input, previews, and summaries need the second password.</p></div><form class="unlock-form" id="unlockForm"><input id="unlockPassword" name="password" type="password" autocomplete="one-time-code" placeholder="second password"><button class="primary" type="submit"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg><span>Unlock</span></button></form><div class="unlock-status" id="unlockStatus"></div></section>{}</aside><section class="main-stack"><section class="panel terminal-panel" id="shellSection" aria-live="polite"><div class="panel-header"><div><h2>Shells</h2><p class="muted">All panes side-by-side. Type into any shell.</p></div><div class="shell-tools"><span class="pill" id="streamState">stream idle</span><button type="button" id="viewToggle">Focus</button><select id="lineCount" aria-label="Line count"><option value="80">80</option><option value="200">200</option><option value="500">500</option></select><button type="button" id="followToggle">Follow</button><button type="button" id="densityToggle">Compact</button><button type="button" id="refreshSummaryBtn" title="Refresh shell summaries"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg><span>Summary</span></button><button type="button" id="refreshShellsTopBtn"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Refresh</span></button></div></div><div class="session-actions" id="sessionActions" hidden></div><div class="shell-tabs" id="shellTabs"></div><input id="imageFile" type="file" accept="image/*" hidden><div class="terminal-grid" id="shells"></div></section></section></div></main>"#,
        links_panel
    )
    .replace(
        r#"</div></section><section class="panel unlock-panel""#,
        &format!(r#"</div></section>{}<section class="panel unlock-panel""#, ci_runs_panel),
    )
}

pub fn manifest() -> serde_json::Value {
    serde_json::json!({
        "name": "ShellDeck",
        "short_name": "ShellDeck",
        "description": "Self-hosted dashboard to monitor and drive tmux sessions and AI coding agents.",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#071017",
        "theme_color": "#071017",
        "icons": [
            { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" },
            { "src": "/assets/shelldeck-logo.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
        ]
    })
}

pub fn icon() -> &'static str {
    r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#071017"/><rect x="72" y="72" width="368" height="368" rx="74" fill="#8bf6ff"/><rect x="112" y="112" width="288" height="288" rx="48" fill="#071017"/><path d="M154 322V174h36v116h70v32H154Zm118 0V174h98v32h-62v28h54v31h-54v57h-36Z" fill="#eaffff"/></svg>"##
}
