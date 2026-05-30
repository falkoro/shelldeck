"use strict";
let shellStream = null;
const AGENT_IMAGE_TARGET_BYTES = 640 * 1024;
const AGENT_IMAGE_MAX_EDGES = [1400, 1200, 1024, 900, 768, 640];
const AGENT_IMAGE_QUALITIES = [0.86, 0.78, 0.70, 0.62, 0.54];
const SUPPORTED_UPLOAD_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
let quickLinks = [];
function applyDashboardSettings(settings) {
    const panels = { ...dashboardSettings.panels, ...(settings.panels || {}) };
    dashboardSettings = { ...settings, panels };
    const metricsPanel = document.getElementById('metricsPanel');
    const metricTemps = document.getElementById('metricTemps');
    const containersPanel = document.getElementById('containersPanel');
    const remotePanel = document.getElementById('remotePanel');
    const linksPanel = document.getElementById('linksPanel');
    const tickerStrip = document.getElementById('tickerStrip');
    const tickerBar = document.getElementById('tickerBar');
    if (metricsPanel)
        metricsPanel.hidden = !panels.machine;
    if (metricTemps)
        metricTemps.hidden = !panels.machine || !panels.machineSensors;
    if (containersPanel)
        containersPanel.hidden = !panels.containers;
    if (remotePanel)
        remotePanel.hidden = !panels.remoteHosts;
    if (linksPanel)
        linksPanel.hidden = !panels.links;
    if (tickerStrip)
        tickerStrip.hidden = !panels.tickers;
    if (tickerBar) {
        tickerBar.hidden = false;
        if (!panels.tickers)
            tickerBar.innerHTML = '<span class="ticker-empty">Tickers hidden</span>';
    }
}
async function loadDashboardSettings() {
    const response = await fetch('/api/ui-config', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    applyDashboardSettings(await response.json());
}
function parseTickerText(text) {
    return text
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}
function focusSettingsEditor(focus) {
    const editor = document.getElementById('settingsEditor');
    if (!editor)
        return;
    const tickers = editor.querySelector('#settingsTickers');
    if (focus === 'tickers' && tickers) {
        tickers.focus();
        tickers.select();
        return;
    }
    editor.querySelector('input[name="machine"]')?.focus();
}
function openSettingsEditor(focus) {
    if (document.getElementById('settingsEditor')) {
        focusSettingsEditor(focus);
        return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'links-editor-modal settings-editor-modal';
    overlay.id = 'settingsEditor';
    const panels = dashboardSettings.panels;
    overlay.innerHTML = `<form class="links-editor-box settings-editor-box"><div class="links-editor-head"><div><h2>Configure</h2><p class="muted">Sidebar widgets and stock/crypto tickers are saved in dashboard-config.json.</p></div><button type="button" class="ghost" data-close-settings>Cancel</button></div><div class="settings-grid"><label><input type="checkbox" name="machine" ${panels.machine ? 'checked' : ''}> Machine</label><label class="settings-subsetting"><input type="checkbox" name="machineSensors" ${panels.machineSensors ? 'checked' : ''}> Thermal sensors</label><label><input type="checkbox" name="remoteHosts" ${panels.remoteHosts ? 'checked' : ''}> Remote hosts</label><label><input type="checkbox" name="containers" ${panels.containers ? 'checked' : ''}> Local containers</label><label><input type="checkbox" name="links" ${panels.links ? 'checked' : ''}> Links</label><label><input type="checkbox" name="tickers" ${panels.tickers ? 'checked' : ''}> Ticker bar</label></div><label for="settingsTickers">Tickers</label><textarea id="settingsTickers" spellcheck="false" placeholder="MSFT, NVDA, BTC-USD"></textarea><div class="links-editor-actions"><button type="submit" class="primary">${icon('settings')}<span>Save config</span></button></div></form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const textarea = overlay.querySelector('#settingsTickers');
    textarea.value = (dashboardSettings.tickers || []).join('\n');
    const close = () => overlay.remove();
    overlay.querySelector('[data-close-settings]')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay)
        close(); });
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(form);
        saveDashboardSettings({
            tickers: parseTickerText(textarea.value),
            panels: {
                machine: data.has('machine'),
                machineSensors: data.has('machineSensors'),
                remoteHosts: data.has('remoteHosts'),
                containers: data.has('containers'),
                links: data.has('links'),
                tickers: data.has('tickers'),
            },
        }).then(close).catch((error) => toast(error.message));
    });
    requestAnimationFrame(() => focusSettingsEditor(focus));
}
async function saveDashboardSettings(settings) {
    const saved = await postJson('/api/ui-config', settings);
    applyDashboardSettings(saved);
    await Promise.allSettled([loadTickers(), loadMetrics(), loadContainers(), loadRemoteHosts(), loadLinks()]);
    toast('Config saved');
}
function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
function drawSafeShot() {
    const shells = latestShells.length ? latestShells : sessions().map((session) => ({
        name: session.name,
        label: session.label,
        running: session.running,
        cwd: '',
        command: '',
        output: '',
    }));
    const modelSessions = sessions();
    const width = Math.min(2200, Math.max(1600, Math.round(window.innerWidth || 1600)));
    const pad = 40;
    const gap = 18;
    const topH = 98;
    const tickerH = 54;
    const contentTop = pad + topH + tickerH + gap * 2;
    const sidebarW = width >= 1900 ? 370 : 330;
    const mainX = pad + sidebarW + gap;
    const mainW = width - mainX - pad;
    const tabCols = Math.max(2, Math.min(width >= 1900 ? 4 : 3, Math.floor(mainW / 330)));
    const tabRows = Math.max(1, Math.ceil(Math.max(1, modelSessions.length) / tabCols));
    const tabW = Math.floor((mainW - 28 - (tabCols - 1) * 10) / tabCols);
    const cardCols = mainW >= 1080 ? 2 : 1;
    const cardW = Math.floor((mainW - 28 - (cardCols - 1) * 14) / cardCols);
    const cardH = 206;
    const cardRows = Math.max(1, Math.ceil(shells.length / cardCols));
    const shellPanelH = 72 + tabRows * 44 + 56 + cardRows * (cardH + 14) + 28;
    const sidebarH = 860;
    const height = Math.max(980, contentTop + Math.max(shellPanelH, sidebarH) + pad);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Could not create safe screenshot');
    const text = (value, x, y, maxWidth) => {
        ctx.fillText(value, x, y, maxWidth);
    };
    const panel = (x, y, w, h, title, subtitle = '') => {
        ctx.fillStyle = '#0b121a';
        roundedRect(ctx, x, y, w, h, 12);
        ctx.fill();
        ctx.strokeStyle = 'rgba(139,246,255,.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#edf7ff';
        ctx.font = '700 18px Segoe UI, sans-serif';
        text(title, x + 16, y + 28, w - 32);
        if (subtitle) {
            ctx.fillStyle = '#91a7b7';
            ctx.font = '13px Segoe UI, sans-serif';
            text(subtitle, x + 16, y + 48, w - 32);
        }
    };
    const pill = (x, y, label, color = '#cfeaff', w = 118) => {
        ctx.fillStyle = '#071017';
        roundedRect(ctx, x, y, w, 32, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(139,246,255,.25)';
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = '700 13px Segoe UI, sans-serif';
        text(label, x + 14, y + 21, w - 24);
    };
    const line = (x, y, w, color = 'rgba(145,167,183,.24)') => {
        ctx.fillStyle = color;
        roundedRect(ctx, x, y, w, 7, 4);
        ctx.fill();
    };
    const button = (x, y, label, w = 92) => {
        ctx.fillStyle = '#0c1720';
        roundedRect(ctx, x, y, w, 30, 7);
        ctx.fill();
        ctx.strokeStyle = 'rgba(139,246,255,.25)';
        ctx.stroke();
        ctx.fillStyle = '#edf7ff';
        ctx.font = '700 12px Segoe UI, sans-serif';
        text(label, x + 12, y + 20, w - 18);
    };
    ctx.fillStyle = '#070b10';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#0b121a';
    roundedRect(ctx, pad, pad, width - pad * 2, topH, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.16)';
    ctx.stroke();
    ctx.fillStyle = '#8bf6ff';
    roundedRect(ctx, pad + 22, pad + 22, 54, 54, 10);
    ctx.fill();
    ctx.fillStyle = '#061014';
    ctx.font = '900 17px Segoe UI, sans-serif';
    text('SD', pad + 38, pad + 57);
    ctx.fillStyle = '#edf7ff';
    ctx.font = '800 28px Segoe UI, sans-serif';
    text('ShellDeck', pad + 92, pad + 42);
    ctx.fillStyle = '#91a7b7';
    ctx.font = '14px Segoe UI, sans-serif';
    text('Safe dashboard snapshot. Hostnames, paths, commands, shell names, and output are hidden.', pad + 92, pad + 66, 760);
    const running = shells.filter((shell) => shell.running).length;
    const waiting = shells.filter((shell) => shell.running && !shellWorking(shell.name)).length;
    const active = shells.filter((shell) => shell.running && shellWorking(shell.name)).length;
    const stats = [`${shells.length} shells`, `${active} active`, `${waiting} waiting`, `${Math.max(0, shells.length - running)} offline`];
    stats.forEach((value, idx) => {
        pill(width - pad - 520 + idx * 128, pad + 33, value, idx === 1 ? '#72f7c8' : idx === 2 ? '#ffc857' : '#cfeaff', 116);
    });
    ctx.fillStyle = '#0b121a';
    roundedRect(ctx, pad, pad + topH + gap, width - pad * 2, tickerH, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.16)';
    ctx.stroke();
    ctx.fillStyle = '#91a7b7';
    ctx.font = '700 13px Segoe UI, sans-serif';
    text(dashboardSettings.tickers.length ? `${dashboardSettings.tickers.length} tickers configured` : 'Ticker bar empty', pad + 16, pad + topH + gap + 32, 260);
    for (let i = 0; i < Math.min(6, Math.max(3, dashboardSettings.tickers.length || 3)); i += 1) {
        const x = pad + 250 + i * 112;
        pill(x, pad + topH + gap + 11, `TICK ${i + 1}`, i % 2 ? '#ff9fb4' : '#72f7c8', 92);
    }
    button(width - pad - 130, pad + topH + gap + 12, 'Configure', 112);
    let sideY = contentTop;
    panel(pad, sideY, sidebarW, 176, 'Machine', 'Host details hidden');
    line(pad + 18, sideY + 76, sidebarW - 52, 'rgba(114,247,200,.45)');
    line(pad + 18, sideY + 116, Math.round((sidebarW - 52) * 0.68), 'rgba(139,246,255,.28)');
    ctx.fillStyle = '#91a7b7';
    ctx.font = '12px Segoe UI, sans-serif';
    text('CPU / RAM / load', pad + 18, sideY + 96);
    text('Thermal sensors summarized', pad + 18, sideY + 136);
    sideY += 190;
    panel(pad, sideY, sidebarW, 136, 'Remote Hosts', 'Server ping and containers');
    for (let i = 0; i < 2; i += 1) {
        const y = sideY + 64 + i * 32;
        ctx.fillStyle = '#050a0f';
        roundedRect(ctx, pad + 16, y, sidebarW - 32, 24, 6);
        ctx.fill();
        line(pad + 28, y + 9, sidebarW - 132, i === 0 ? 'rgba(114,247,200,.32)' : 'rgba(139,246,255,.18)');
    }
    sideY += 150;
    panel(pad, sideY, sidebarW, 166, 'Local Containers', 'Docker and Podman');
    for (let i = 0; i < 3; i += 1) {
        const y = sideY + 64 + i * 30;
        ctx.fillStyle = '#050a0f';
        roundedRect(ctx, pad + 16, y, sidebarW - 32, 22, 6);
        ctx.fill();
        line(pad + 28, y + 8, sidebarW - 112, 'rgba(139,246,255,.18)');
    }
    sideY += 180;
    panel(pad, sideY, sidebarW, 132, 'Links', 'Quick jumps');
    for (let i = 0; i < 4; i += 1)
        button(pad + 16 + (i % 2) * ((sidebarW - 42) / 2), sideY + 64 + Math.floor(i / 2) * 38, 'Link', (sidebarW - 50) / 2);
    sideY += 146;
    panel(pad, sideY, sidebarW, 126, 'Shell Unlock', 'Input controls hidden');
    ctx.fillStyle = '#03070b';
    roundedRect(ctx, pad + 16, sideY + 68, sidebarW - 112, 34, 7);
    ctx.fill();
    button(pad + sidebarW - 84, sideY + 70, 'Unlock', 68);
    panel(mainX, contentTop, mainW, shellPanelH, 'Shells', 'All panes side-by-side. Text and output redacted.');
    const toolsX = mainX + mainW - 514;
    ['Grid', '80', 'Follow', 'Compact', 'Refresh'].forEach((label, idx) => button(toolsX + idx * 100, contentTop + 18, label, 88));
    modelSessions.forEach((session, idx) => {
        const state = sessionRuntime(session);
        const col = idx % tabCols;
        const row = Math.floor(idx / tabCols);
        const x = mainX + 14 + col * (tabW + 10);
        const y = contentTop + 76 + row * 44;
        ctx.fillStyle = session.name === selectedSession ? '#10202b' : '#0d151f';
        roundedRect(ctx, x, y, tabW, 34, 7);
        ctx.fill();
        ctx.strokeStyle = session.name === selectedSession ? 'rgba(139,246,255,.7)' : 'rgba(255,255,255,.09)';
        ctx.stroke();
        ctx.fillStyle = '#071017';
        roundedRect(ctx, x + 10, y + 6, 34, 22, 5);
        ctx.fill();
        ctx.fillStyle = '#edf7ff';
        ctx.font = '900 12px Cascadia Mono, monospace';
        text(String(session.badge || idx + 1).slice(0, 2).toUpperCase(), x + 20, y + 21, 22);
        ctx.fillStyle = state.dotClass === 'on' ? '#72f7c8' : state.dotClass === 'wait' ? '#ffc857' : '#ff6a7a';
        ctx.beginPath();
        ctx.arc(x + 58, y + 17, 4, 0, Math.PI * 2);
        ctx.fill();
        line(x + 70, y + 13, tabW - 96, 'rgba(207,234,255,.28)');
    });
    const actionY = contentTop + 86 + tabRows * 44;
    ctx.fillStyle = '#071017';
    roundedRect(ctx, mainX + 14, actionY, mainW - 28, 42, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(139,246,255,.16)';
    ctx.stroke();
    line(mainX + 30, actionY + 17, 230, 'rgba(207,234,255,.24)');
    button(mainX + mainW - 274, actionY + 6, 'Start', 78);
    button(mainX + mainW - 188, actionY + 6, 'Restart', 86);
    button(mainX + mainW - 94, actionY + 6, 'Attach', 76);
    const cardsTop = actionY + 56;
    shells.forEach((shell, idx) => {
        const col = idx % cardCols;
        const row = Math.floor(idx / cardCols);
        const x = mainX + 14 + col * (cardW + 14);
        const y = cardsTop + row * (cardH + 14);
        const activeShell = shell.running && shellWorking(shell.name);
        const waitingShell = shell.running && !activeShell;
        ctx.fillStyle = '#050a0f';
        roundedRect(ctx, x, y, cardW, cardH, 10);
        ctx.fill();
        ctx.strokeStyle = activeShell ? 'rgba(114,247,200,.5)' : waitingShell ? 'rgba(255,200,87,.45)' : 'rgba(139,246,255,.22)';
        ctx.stroke();
        ctx.fillStyle = '#071017';
        roundedRect(ctx, x + 1, y + 1, cardW - 2, 44, 10);
        ctx.fill();
        ctx.fillStyle = '#edf7ff';
        ctx.font = '800 17px Segoe UI, sans-serif';
        text(`Shell ${idx + 1}`, x + 18, y + 28);
        ctx.fillStyle = activeShell ? '#72f7c8' : waitingShell ? '#ffc857' : '#ff6a7a';
        ctx.beginPath();
        ctx.arc(x + cardW - 28, y + 23, 6, 0, Math.PI * 2);
        ctx.fill();
        line(x + 18, y + 62, cardW - 60, 'rgba(139,246,255,.2)');
        ctx.fillStyle = '#03070b';
        roundedRect(ctx, x + 18, y + 78, cardW - 36, 42, 7);
        ctx.fill();
        line(x + 32, y + 96, cardW - 92, 'rgba(145,167,183,.22)');
        for (let i = 0; i < 5; i += 1) {
            button(x + 18 + i * 76, y + 130, ['Send', 'Paste', 'Image', 'Mic', 'Enter'][i], 68);
        }
        ctx.fillStyle = '#03070b';
        roundedRect(ctx, x + 18, y + 166, cardW - 36, 24, 7);
        ctx.fill();
        for (let i = 0; i < 3; i += 1) {
            line(x + 32 + i * 118, y + 175, Math.min(88, cardW - 72 - i * 118), 'rgba(145,167,183,.18)');
        }
    });
    ctx.fillStyle = '#91a7b7';
    ctx.font = '13px Segoe UI, sans-serif';
    text(`Generated ${new Date().toLocaleString()} by ShellDeck safe shot`, pad, height - 24, width - pad * 2);
    return canvas;
}
function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob)
                resolve(blob);
            else
                reject(new Error('Could not export safe screenshot'));
        }, 'image/png');
    });
}
async function writeImageToClipboard(blob) {
    const ClipboardItemCtor = window.ClipboardItem;
    if (!navigator.clipboard || !ClipboardItemCtor)
        return false;
    await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
    return true;
}
async function createSafeShot() {
    const button = document.getElementById('safeShotBtn');
    if (button)
        button.disabled = true;
    try {
        const canvas = drawSafeShot();
        const blob = await canvasToPngBlob(canvas);
        const copied = await writeImageToClipboard(blob).catch(() => false);
        await postJson('/api/share-shot', { dataUrl: canvas.toDataURL('image/png') });
        toast(copied ? 'Safe shot copied and saved in share/' : 'Safe shot saved in share/');
    }
    finally {
        if (button)
            button.disabled = false;
    }
}
async function loadTickers() {
    if (!document.getElementById('tickerBar') || !dashboardSettings.panels.tickers)
        return;
    const response = await fetch('/api/tickers', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    const payload = await response.json();
    renderTickers(payload.tickers || []);
}
function renderLinks(links) {
    quickLinks = links;
    const grid = document.getElementById('linksGrid');
    if (!grid)
        return;
    if (!links.length) {
        grid.innerHTML = '<div class="muted links-empty">No links configured</div>';
        return;
    }
    grid.innerHTML = links
        .map((link) => `<a class="link-item" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${escapeHtml(link.label)}</span></a>`)
        .join('');
}
async function loadLinks() {
    if (!document.getElementById('linksPanel') || !dashboardSettings.panels.links)
        return;
    const response = await fetch('/api/links', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    const payload = await response.json();
    renderLinks(payload.links || []);
}
function linkEditorText() {
    return quickLinks.map((link) => `${link.label}|${link.url}`).join('\n');
}
function parseLinkEditorText(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [label, ...urlParts] = line.split('|');
        return { label: (label || '').trim(), url: urlParts.join('|').trim() };
    })
        .filter((link) => link.label && link.url);
}
function openLinksEditor() {
    if (document.getElementById('linksEditor'))
        return;
    const overlay = document.createElement('div');
    overlay.className = 'links-editor-modal';
    overlay.id = 'linksEditor';
    overlay.innerHTML = `<form class="links-editor-box"><div class="links-editor-head"><div><h2>Links</h2><p class="muted">One per line: Label|https://example.com</p></div><button type="button" class="ghost" data-close-links>Cancel</button></div><textarea id="linksEditorText" spellcheck="false"></textarea><div class="links-editor-actions"><button type="submit" class="primary">Save links</button></div></form>`;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#linksEditorText');
    textarea.value = linkEditorText();
    textarea.focus();
    const close = () => overlay.remove();
    overlay.querySelector('[data-close-links]')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay)
        close(); });
    overlay.querySelector('form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        saveLinks(parseLinkEditorText(textarea.value)).then(close).catch((error) => toast(error.message));
    });
}
async function saveLinks(links) {
    const payload = await postJson('/api/links', { links });
    renderLinks(payload.links || []);
    toast('Links saved');
}
let remoteHostConfig = [];
async function loadRemoteHostConfig() {
    const response = await fetch('/api/remote-hosts/config', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    const payload = await response.json();
    remoteHostConfig = payload.hosts || [];
}
function remoteHostEditorText() {
    return remoteHostConfig.map((host) => `${host.id}|${host.label}|${host.target}`).join('\n');
}
function parseRemoteHostEditorText(text) {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [id, label, ...rest] = line.split('|');
        return { id: (id || '').trim(), label: (label || '').trim(), target: rest.join('|').trim() };
    })
        .filter((host) => host.id && host.label && host.target);
}
async function openRemoteHostsEditor() {
    if (document.getElementById('remoteHostsEditor'))
        return;
    await loadRemoteHostConfig();
    const overlay = document.createElement('div');
    overlay.className = 'links-editor-modal';
    overlay.id = 'remoteHostsEditor';
    overlay.innerHTML = `<form class="links-editor-box"><div class="links-editor-head"><div><h2>Remote hosts</h2><p class="muted">One per line: id|Label|user@host — checked over SSH (ping + docker/podman ps)</p></div><button type="button" class="ghost" data-close-remote>Cancel</button></div><textarea id="remoteHostsEditorText" spellcheck="false" placeholder="logan|Logan GL502VS|logan-gl502vs"></textarea><div class="links-editor-actions"><button type="submit" class="primary">Save hosts</button></div></form>`;
    document.body.appendChild(overlay);
    const textarea = overlay.querySelector('#remoteHostsEditorText');
    textarea.value = remoteHostEditorText();
    textarea.focus();
    const close = () => overlay.remove();
    overlay.querySelector('[data-close-remote]')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay)
        close(); });
    overlay.querySelector('form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        saveRemoteHosts(parseRemoteHostEditorText(textarea.value)).then(close).catch((error) => toast(error.message));
    });
}
async function saveRemoteHosts(hosts) {
    const payload = await postJson('/api/remote-hosts/config', { hosts });
    remoteHostConfig = payload.hosts || [];
    await loadRemoteHosts();
    toast('Remote hosts saved');
}
window.openRemoteHostsEditor = openRemoteHostsEditor;
async function sessionAction(endpoint, name) {
    if (!shellUnlocked)
        throw new Error('Unlock shells first');
    const payload = await postJson(endpoint, { name });
    toast(payload.message || 'Done');
    await refresh({ preserveUnlock: true });
    await loadShells(false);
}
async function sendInput(name, submit) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    const input = inputFor(name);
    const text = input?.value || '';
    if (!text.trim())
        throw new Error('Input is empty');
    if (activeDictation?.name === name)
        stopDictation();
    const payload = await postJson('/api/input', { name, text, submit });
    pushHistory(name, text);
    markAutoFollowUpSent(name, text);
    toast(payload.message || 'Sent');
    if (input)
        input.value = '';
    clearShellImages(name);
    setShellStatus(name, 'Sent. Attachments cleared.');
    updateUnlockState();
}
let activeDictation = null;
function speechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
}
function browserMicHelp() {
    if (/Edg\//.test(navigator.userAgent)) {
        return 'In Edge, open the lock icon, set Microphone to Allow for this site, then reload ShellDeck.';
    }
    return 'Allow Microphone for this site in the browser address bar, then try Mic again.';
}
function dictationErrorMessage(error) {
    const code = String(error?.error || error?.name || error?.message || '').toLowerCase();
    if (code.includes('service-not-allowed')) {
        return `Speech recognition is blocked by this browser or network. ${browserMicHelp()}`;
    }
    if (code.includes('not-allowed') || code.includes('notallowed') || code.includes('permission')) {
        return `Microphone is blocked. ${browserMicHelp()}`;
    }
    if (code.includes('audio-capture') || code.includes('notfound')) {
        return 'No microphone was found. Check your input device, then try Mic again.';
    }
    if (code.includes('no-speech')) {
        return 'No speech was heard. Check the microphone input and try again.';
    }
    if (code.includes('network')) {
        return 'Speech recognition could not reach the browser speech service. Check the connection or type/paste instead.';
    }
    if (code.includes('security') || code.includes('secure')) {
        return 'Microphone dictation needs HTTPS or localhost. Open ShellDeck over HTTPS or 127.0.0.1.';
    }
    return 'Dictation stopped. Check microphone permissions for this site and try again.';
}
function reportDictationError(name, error) {
    const message = dictationErrorMessage(error);
    setShellStatus(name, message);
    toast(message);
}
function requestMicrophoneForDictation() {
    if (!navigator.mediaDevices?.getUserMedia)
        return Promise.resolve(null);
    return navigator.mediaDevices
        .getUserMedia({ audio: true })
        .catch((error) => { throw new Error(dictationErrorMessage(error)); });
}
function appendDictationText(base, transcript) {
    const clean = transcript.trim().replace(/\s+/g, ' ');
    if (!clean)
        return base;
    return `${base}${base && !/\s$/.test(base) ? ' ' : ''}${clean}`;
}
function setDictationState(name, listening) {
    document.querySelectorAll('[data-dictate-shell]').forEach((button) => {
        const active = listening && button.dataset.dictateShell === name;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}
async function warmMicrophonePermission(name, recognition, streamRequest) {
    try {
        const stream = await streamRequest;
        const current = activeDictation;
        if (!current || current.recognition !== recognition) {
            stream?.getTracks().forEach((track) => track.stop());
            return;
        }
        current.stream = stream;
    }
    catch (error) {
        if (activeDictation?.recognition !== recognition)
            return;
        reportDictationError(name, error);
        stopDictation();
    }
}
function stopDictation() {
    const current = activeDictation;
    activeDictation = null;
    if (!current)
        return;
    setDictationState(current.name, false);
    current.stream?.getTracks().forEach((track) => track.stop());
    try {
        current.recognition.stop();
    }
    catch { }
}
async function toggleDictation(name) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    if (activeDictation?.name === name) {
        stopDictation();
        setShellStatus(name, 'Dictation stopped.');
        return;
    }
    stopDictation();
    const Recognition = speechRecognitionCtor();
    if (!Recognition) {
        throw new Error('Browser dictation is unavailable here. Use Chrome or Edge and allow Microphone for this site.');
    }
    if (!window.isSecureContext) {
        throw new Error('Microphone dictation needs HTTPS or localhost. Open ShellDeck over HTTPS or 127.0.0.1.');
    }
    const input = inputFor(name);
    if (!input)
        throw new Error('Could not find this shell input');
    const recognition = new Recognition();
    const micWarmup = requestMicrophoneForDictation();
    const base = input.value;
    const finals = [];
    let hadError = false;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
        if (activeDictation?.recognition !== recognition)
            return;
        let interim = '';
        for (let i = 0; i < event.results.length; i += 1) {
            const transcript = String(event.results[i][0]?.transcript || '').trim();
            if (event.results[i].isFinal)
                finals[i] = transcript;
            else if (i >= event.resultIndex)
                interim += ` ${transcript}`;
        }
        const spoken = [...finals.filter(Boolean), interim.trim()].filter(Boolean).join(' ');
        input.value = appendDictationText(base, spoken);
        updateUnlockState();
    };
    recognition.onstart = () => {
        if (activeDictation?.recognition !== recognition)
            return;
        setDictationState(name, true);
        setShellStatus(name, 'Listening. Speak into your microphone.');
    };
    recognition.onaudiostart = () => {
        if (activeDictation?.recognition !== recognition)
            return;
        setShellStatus(name, 'Microphone active. Listening...');
    };
    recognition.onspeechstart = () => {
        if (activeDictation?.recognition !== recognition)
            return;
        setShellStatus(name, 'Speech detected. Dictating...');
    };
    recognition.onspeechend = () => {
        if (activeDictation?.recognition !== recognition)
            return;
        setShellStatus(name, 'Speech paused. Keep talking or press Mic to stop.');
    };
    recognition.onnomatch = () => {
        if (activeDictation?.recognition !== recognition)
            return;
        setShellStatus(name, 'Could not understand that audio. Try again or speak closer to the mic.');
    };
    recognition.onerror = (event) => {
        hadError = true;
        reportDictationError(name, event);
    };
    recognition.onend = () => {
        activeDictation?.stream?.getTracks().forEach((track) => track.stop());
        if (activeDictation?.recognition === recognition)
            activeDictation = null;
        setDictationState(name, false);
        if (!hadError)
            setShellStatus(name, 'Dictation stopped.');
    };
    try {
        setShellStatus(name, 'Starting dictation. Allow Microphone when the browser asks.');
        activeDictation = { name, recognition, stream: null };
        recognition.start();
        setDictationState(name, true);
        warmMicrophonePermission(name, recognition, micWarmup);
    }
    catch (error) {
        activeDictation = null;
        setDictationState(name, false);
        micWarmup.then((stream) => stream?.getTracks().forEach((track) => track.stop())).catch(() => { });
        throw new Error(dictationErrorMessage(error));
    }
}
async function submitShellInput(name) {
    await sendInput(name, sendMode(name) === 'send');
}
// Send an explicit command line (not the textarea) to a shell, e.g. a recovery `codex resume <id>`.
async function runCommand(name, text) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    const payload = await postJson('/api/input', { name, text, submit: true });
    toast(payload.message || 'Sent');
}
async function sendKey(name, key) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    const payload = await postJson('/api/key', { name, key });
    toast(payload.message || 'Key sent');
}
function appendInput(value, name = selectedSession) {
    const text = String(value || '');
    if (!text || !name)
        return;
    const input = inputFor(name);
    if (!input)
        return;
    input.value += (input.value && !input.value.endsWith('\n') ? '\n' : '') + text;
    input.focus();
    updateUnlockState();
}
function shellNameFromElement(element) {
    return element?.closest('[data-shell-card]')?.dataset.shellCard || selectedSession;
}
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Could not read image'));
        reader.readAsDataURL(file);
    });
}
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function imageNameWithExtension(name, extension) {
    const raw = name || 'pasted-image';
    const base = raw.replace(/\.[a-z0-9]+$/i, '') || 'pasted-image';
    return `${base}.${extension}`;
}
function loadImageElement(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not read image'));
        };
        img.src = url;
    });
}
function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob)
                resolve(blob);
            else
                reject(new Error('Could not optimize image'));
        }, type, quality);
    });
}
function renderImageCanvas(image, maxEdge) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Could not optimize image');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}
async function optimizeImageForAgents(file) {
    if (file.size <= AGENT_IMAGE_TARGET_BYTES)
        return file;
    const image = await loadImageElement(file);
    let best = null;
    for (const maxEdge of AGENT_IMAGE_MAX_EDGES) {
        const canvas = renderImageCanvas(image, maxEdge);
        for (const quality of AGENT_IMAGE_QUALITIES) {
            const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
            if (!best || blob.size < best.size)
                best = blob;
            if (blob.size <= AGENT_IMAGE_TARGET_BYTES) {
                return new File([blob], imageNameWithExtension(file.name, 'jpg'), {
                    type: 'image/jpeg',
                    lastModified: Date.now(),
                });
            }
        }
    }
    if (best && best.size < file.size) {
        return new File([best], imageNameWithExtension(file.name, 'jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now(),
        });
    }
    return file;
}
async function uploadImageForShell(file, name, setStatus = (text) => setShellStatus(name, text)) {
    if (!shellUnlocked)
        throw new Error('Unlock shells first');
    if (!name)
        throw new Error('Choose a shell first');
    if (!String(file.type || '').startsWith('image/'))
        throw new Error('That file is not an image');
    if (!SUPPORTED_UPLOAD_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
        throw new Error('Supported image types are PNG, JPEG, WebP, and GIF');
    }
    setStatus(file.size > AGENT_IMAGE_TARGET_BYTES ? 'Optimizing image...' : 'Saving image...');
    const uploadFile = await optimizeImageForAgents(file);
    const optimized = uploadFile !== file;
    setStatus(`Saving image (${formatBytes(uploadFile.size)})...`);
    const payload = await postJson('/api/upload-image', {
        name: uploadFile.name || 'pasted-image',
        type: uploadFile.type,
        dataUrl: await fileToDataUrl(uploadFile),
    });
    if (!payload.image)
        throw new Error('Image upload did not return an image');
    addShellImage(name, payload.image);
    renderShellImages(name);
    return { image: payload.image, optimized, originalBytes: file.size };
}
async function uploadImageFile(file, name) {
    const result = await uploadImageForShell(file, name);
    const { image, optimized, originalBytes } = result;
    appendInput(image.path, name);
    const sizeNote = optimized ? `optimized ${formatBytes(originalBytes)} -> ${formatBytes(image.bytes)}` : formatBytes(image.bytes);
    setShellStatus(name, `Inserted ${image.path} (${sizeNote})`);
    toast(optimized ? 'Optimized image path inserted' : 'Image path inserted');
}
async function handleImageFiles(files, name) {
    const images = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/'));
    for (const image of images)
        await uploadImageFile(image, name);
}
function pasteImageFiles(event, name) {
    const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file) => Boolean(file));
    if (!files.length)
        return;
    event.preventDefault();
    handleImageFiles(files, name || shellNameFromElement(event.target instanceof Element ? event.target : null)).catch((error) => {
        toast(error.message);
    });
}
function setShellStatus(name, text) {
    const card = document.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
    const status = card?.querySelector('[data-role="status"]');
    if (status)
        status.textContent = text;
}
// The Hermes/Grok summary is no longer shown as one block — it feeds the per-slot titles
// (sessionWorkTitle) so each shell shows its own line. We only keep the raw text + repaint titles.
async function loadSummary(force = false) {
    if (!shellUnlocked) {
        latestSummaryText = '';
        summaryLoading = false;
        updateSummaryRefreshState();
        applyWorkTitles();
        return;
    }
    if (force) {
        latestSummaryText = '';
        clearShellAutoTitleCache();
    }
    summaryLoading = true;
    updateSummaryRefreshState();
    applyWorkTitles();
    try {
        const response = await fetch('/api/summary', { cache: 'no-store', credentials: 'same-origin' });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error || 'Summary failed');
        const provider = String(payload.provider || '');
        const summary = payload.summary || '';
        // Keep the last model-backed summary during transient fallback blips, but still accept local
        // summaries when no better text exists yet so default installs can populate shell titles.
        if (summary && (force || !provider.startsWith('local') || !latestSummaryText.trim()))
            latestSummaryText = summary;
    }
    finally {
        summaryLoading = false;
        updateSummaryRefreshState();
        applyWorkTitles();
    }
}
async function refreshSummaries() {
    if (!shellUnlocked)
        throw new Error('Unlock shells before refreshing summaries');
    await loadSummary(true);
    toast('Summaries refreshed');
}
async function unlockShells(password) {
    const status = q('#unlockStatus');
    status.className = 'unlock-status';
    status.textContent = 'Checking second password...';
    const payload = await postJson('/api/unlock', { password });
    shellUnlocked = true;
    status.className = 'unlock-status ok';
    status.textContent = 'Unlocked. Loading shell panes now...';
    q('#unlockPassword').value = '';
    if (payload.model)
        render({ ...payload.model, unlocked: true });
    if (Array.isArray(payload.shells))
        renderShells({ shells: payload.shells });
    startShellStream();
    (document.getElementById('currentWork') || q('#shellSection')).scrollIntoView({ block: 'start', behavior: 'smooth' });
    toast(payload.message || 'Unlocked');
    await Promise.allSettled([refresh({ preserveUnlock: true }), loadSummary()]);
}
async function loadShells(showLoading = true) {
    const grid = q('#shells');
    if (!shellUnlocked) {
        grid.innerHTML = `<div class="unlock-cta">
      <div class="unlock-cta-lock">${icon('lock')}</div>
      <h3>Shells are locked in this browser</h3>
      <p class="muted">This Chrome profile isn't unlocked yet. Enter your second password to reveal all live tmux panes.</p>
      <form class="unlock-form" id="inlineUnlockForm">
        <input id="inlineUnlockPassword" name="password" type="password" autocomplete="one-time-code" placeholder="second password">
        <button class="primary" type="submit">${icon('unlock')}<span>Unlock shells</span></button>
      </form>
      <div class="unlock-status" id="inlineUnlockStatus"></div>
    </div>`;
        document.getElementById('inlineUnlockPassword')?.focus();
        setStreamState('stream locked');
        return;
    }
    if (showLoading && !grid.querySelector('[data-shell-card]')) {
        const cached = cachedShellPreviews();
        if (cached.length) {
            setShellsLoading(true);
            renderShells({ shells: cached, fromCache: true });
            setStreamState('refreshing shells');
        }
        else {
            grid.innerHTML = '<div class="locked-note">Loading shell previews...</div>';
        }
    }
    setShellsLoading(true);
    try {
        const response = await fetch(shellEndpoint('/api/shells'), { cache: 'no-store', credentials: 'same-origin' });
        const payload = await response.json();
        if (!response.ok) {
            if (response.status === 403)
                shellUnlocked = false;
            updateUnlockState();
            grid.innerHTML = `<div class="locked-note">${escapeHtml(payload.error || 'Shell preview failed')}. Enter the second password and try again.</div>`;
            throw new Error(payload.error || 'Shell preview failed');
        }
        renderShells({ shells: payload.shells });
    }
    finally {
        setShellsLoading(false);
    }
}
function startShellStream() {
    if (!shellUnlocked || shellStream)
        return;
    if (!('EventSource' in window)) {
        setStreamState('stream unavailable');
        return;
    }
    shellStream = new EventSource(shellEndpoint('/api/shells/stream'));
    shellStream.addEventListener('shells', (event) => {
        const payload = JSON.parse(event.data);
        setShellsLoading(false);
        renderShells({ shells: payload.shells });
        setStreamState(`live ${new Date().toLocaleTimeString()}`, true);
    });
    shellStream.onerror = () => setStreamState('stream reconnecting');
}
function restartShellStream() {
    if (shellStream) {
        shellStream.close();
        shellStream = null;
    }
    startShellStream();
}
function copyShellOutput(name) {
    const text = shellPreviewByName(name)?.output || '';
    if (!text)
        throw new Error('No output to copy');
    return copyText(text);
}
function clearShellPreview(name) {
    const shell = shellPreviewByName(name);
    if (!shell)
        return;
    clearedOutputs[name] = shell.output;
    const pre = document.querySelector(`[data-shell-card="${selectorEscape(name)}"] [data-role="output"]`);
    if (pre)
        pre.textContent = '';
}
