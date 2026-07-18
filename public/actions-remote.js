"use strict";
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
