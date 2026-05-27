use crate::{config::Config, tmux::SessionModel, webutil::html_escape};

pub fn blocked() -> String {
    r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071017"><title>Access blocked</title><link rel="stylesheet" href="/assets/app.css"></head><body class="center-page"><main class="message-panel danger"><div class="mark">!</div><h1>Not from an allowed route</h1><p class="muted">This dashboard only accepts your approved network IP or a Cloudflare Access identity for the allowed email.</p></main></body></html>"##.to_string()
}

pub fn login(config: &Config, message: &str) -> String {
    format!(r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071017"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="ShellDeck"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/app.css"><title>ShellDeck Login</title></head><body class="center-page"><main class="login-panel"><div class="login-logo"><div class="brand-mark small">SD</div><div><h1>ShellDeck</h1><p class="muted">Live tmux + agent dashboard</p></div></div><form method="post" action="/login"><label for="username">User</label><input id="username" name="username" autocomplete="username" value="{}"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus><div class="error">{}</div><button class="primary wide" type="submit">Sign in</button></form></main></body></html>"##, html_escape(&config.user), html_escape(message))
}

pub fn dashboard(model: &SessionModel, config: &Config) -> String {
    let data = serde_json::to_string(model).unwrap_or_else(|_| "{}".to_string()).replace('<', "\\u003c");
    format!(r##"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#071017"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="ShellDeck"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/xterm.css"><link rel="stylesheet" href="/assets/app.css"><title>ShellDeck</title></head><body><script type="application/json" id="initial-model">{}</script><main class="shell"><header class="topbar"><div class="brand"><div class="brand-mark">SD</div><div><h1>ShellDeck</h1><div class="status-line"><span class="pill">{}</span><span class="pill" id="authState">dashboard signed in</span><span class="pill" id="updated">syncing</span><span class="pill access-pill" id="accessState">shells locked</span></div></div></div><div class="top-actions">{}<button class="ghost" id="guideBtn" type="button"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>Guide</span></button><button class="primary" id="refreshBtn" type="button"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Refresh</span></button><a class="button ghost" href="/logout"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Sign out</span></a></div></header><div class="ticker-bar" id="tickerBar" hidden></div>{}<div class="toast" id="toast"></div><script src="/assets/xterm.js"></script><script src="/assets/addon-fit.js"></script><script src="/assets/core.js"></script><script src="/assets/prefs.js"></script><script src="/assets/render.js"></script><script src="/assets/actions.js"></script><script src="/assets/terminal.js"></script><script src="/assets/onboarding.js"></script><script src="/assets/events.js"></script></body></html>"##, data, html_escape(&model.hostname), quick_links_html(config), workspace())
}

// Optional configurable quick links (DASHBOARD_LINKS) rendered as a top-bar dropdown.
fn quick_links_html(config: &Config) -> String {
    if config.quick_links.is_empty() {
        return String::new();
    }
    let ext = r##"<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>"##;
    let chev = r##"<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>"##;
    let items: String = config.quick_links.iter().map(|(label, url)| {
        format!(r##"<a href="{}" target="_blank" rel="noopener noreferrer">{}<span>{}</span></a>"##, html_escape(url), ext, html_escape(label))
    }).collect();
    format!(r##"<div class="links-dd"><button class="ghost" id="linksBtn" type="button" aria-expanded="false">{}<span>Links</span>{}</button><div class="links-menu" id="linksMenu" hidden>{}</div></div>"##, ext, chev, items)
}

fn workspace() -> &'static str {
    r#"<div class="workspace compact"><aside class="sidebar"><section class="panel unlock-panel" id="unlockPanel"><div><h2>Shell Unlock</h2><p class="muted">Input, previews, and summaries need the second password.</p></div><form class="unlock-form" id="unlockForm"><input id="unlockPassword" name="password" type="password" autocomplete="one-time-code" placeholder="second password"><button class="primary" type="submit"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg><span>Unlock</span></button></form><div class="unlock-status" id="unlockStatus"></div></section><section class="panel session-panel"><div class="panel-header"><div><h2>Sessions</h2><p class="muted">Start, restart, or copy attach commands.</p></div></div><div class="sessions" id="sessions" aria-live="polite"></div></section></aside><section class="main-stack"><section class="panel terminal-panel" id="shellSection" aria-live="polite"><div class="panel-header"><div><h2>Shells</h2><p class="muted">All panes side-by-side. Type into any shell.</p></div><div class="shell-tools"><span class="pill" id="streamState">stream idle</span><button type="button" id="viewToggle">Focus</button><select id="lineCount" aria-label="Line count"><option value="80">80</option><option value="200">200</option><option value="500">500</option></select><button type="button" id="followToggle">Follow</button><button type="button" id="densityToggle">Compact</button><button type="button" id="refreshShellsTopBtn"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Refresh</span></button></div></div><div class="shell-tabs" id="shellTabs"></div><input id="imageFile" type="file" accept="image/*" hidden><div class="terminal-grid" id="shells"></div></section></section><aside class="agents-col"><section class="panel agents-panel" aria-live="polite"><div class="panel-header"><div><h2>Agents</h2><p class="muted" id="agentsSummary">Live agent activity</p></div><button type="button" id="agentsBtn"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg><span>Refresh</span></button></div><div class="agents-list" id="agentsList"></div></section></aside></div></main>"#
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
        "icons": [{ "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }]
    })
}

pub fn icon() -> &'static str {
    r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#071017"/><rect x="72" y="72" width="368" height="368" rx="74" fill="#8bf6ff"/><rect x="112" y="112" width="288" height="288" rx="48" fill="#071017"/><path d="M154 322V174h36v116h70v32H154Zm118 0V174h98v32h-62v28h54v31h-54v57h-36Z" fill="#eaffff"/></svg>"##
}
