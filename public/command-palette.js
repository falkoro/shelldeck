"use strict";
// Command palette: jump to sessions, pin, open live terminal.
let paletteOpen = false;
let paletteQuery = '';
let paletteIndex = 0;
function buildPaletteRows(query) {
    const q = query.trim().toLowerCase();
    const model = typeof orderedVisibleSessions === 'function'
        ? orderedVisibleSessions()
        : sessions();
    const rows = model.map((session) => {
        const label = typeof sessionTabLabel === 'function'
            ? sessionTabLabel(session)
            : (session.label || session.name);
        const work = typeof sessionWorkTitle === 'function' ? sessionWorkTitle(session.name) : '';
        const state = typeof sessionRuntime === 'function' ? sessionRuntime(session) : { label: '' };
        const meta = [session.name, session.family, state.label, work].filter(Boolean).join(' · ');
        return { name: session.name, label: label || session.name, meta, kind: 'session' };
    });
    if (!q)
        return rows;
    return rows.filter((row) => {
        const hay = `${row.label} ${row.meta} ${row.name}`.toLowerCase();
        return hay.includes(q);
    });
}
function ensurePaletteDom() {
    let root = document.getElementById('commandPalette');
    if (root)
        return root;
    root = document.createElement('div');
    root.id = 'commandPalette';
    root.className = 'command-palette';
    root.hidden = true;
    root.innerHTML = `
    <div class="command-palette-backdrop" data-palette-close></div>
    <div class="command-palette-panel" role="dialog" aria-modal="true" aria-label="Jump to session">
      <div class="command-palette-head">
        <input type="search" id="commandPaletteInput" class="command-palette-input" placeholder="Jump to session…" autocomplete="off" spellcheck="false">
        <kbd class="command-palette-kbd">esc</kbd>
      </div>
      <div class="command-palette-hint muted">Enter open · ⌘/Ctrl+Enter Shell in · p pin · arrows move</div>
      <div class="command-palette-list" id="commandPaletteList" role="listbox"></div>
    </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (event) => {
        const t = event.target;
        if (t.closest('[data-palette-close]'))
            closeCommandPalette();
        const row = t.closest('[data-palette-name]');
        if (row?.dataset.paletteName) {
            runPaletteAction(row.dataset.paletteName, event.metaKey || event.ctrlKey ? 'shellin' : 'select');
        }
    });
    const input = root.querySelector('#commandPaletteInput');
    input?.addEventListener('input', () => {
        paletteQuery = input.value;
        paletteIndex = 0;
        renderPaletteList();
    });
    input?.addEventListener('keydown', (event) => {
        const rows = buildPaletteRows(paletteQuery);
        if (event.key === 'Escape') {
            event.preventDefault();
            closeCommandPalette();
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            paletteIndex = Math.min(rows.length - 1, paletteIndex + 1);
            renderPaletteList();
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            paletteIndex = Math.max(0, paletteIndex - 1);
            renderPaletteList();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            const row = rows[paletteIndex];
            if (!row)
                return;
            if (event.metaKey || event.ctrlKey)
                runPaletteAction(row.name, 'shellin');
            else
                runPaletteAction(row.name, 'select');
            return;
        }
        if (event.key === 'p' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            const row = rows[paletteIndex];
            if (row)
                runPaletteAction(row.name, 'pin');
        }
    });
    return root;
}
function renderPaletteList() {
    const list = document.getElementById('commandPaletteList');
    if (!list)
        return;
    const rows = buildPaletteRows(paletteQuery);
    if (!rows.length) {
        list.innerHTML = '<div class="command-palette-empty muted">No matching sessions</div>';
        return;
    }
    if (paletteIndex >= rows.length)
        paletteIndex = rows.length - 1;
    list.innerHTML = rows.map((row, i) => {
        const pinned = isSessionPinned(row.name, pinnedSessionNames());
        const unread = typeof isSessionUnread === 'function' && isSessionUnread(row.name);
        const active = i === paletteIndex ? ' active' : '';
        return `<button type="button" class="command-palette-row${active}" role="option" aria-selected="${i === paletteIndex}" data-palette-name="${escapeHtml(row.name)}"><span class="command-palette-row-main"><b>${escapeHtml(row.label)}</b><small>${escapeHtml(row.meta)}</small></span><span class="command-palette-row-flags">${pinned ? 'pinned' : ''}${unread ? ' · new' : ''}</span></button>`;
    }).join('');
    list.querySelector('.command-palette-row.active')?.scrollIntoView({ block: 'nearest' });
}
function openCommandPalette() {
    const root = ensurePaletteDom();
    paletteOpen = true;
    paletteQuery = '';
    paletteIndex = 0;
    root.hidden = false;
    document.body.classList.add('palette-open');
    const input = root.querySelector('#commandPaletteInput');
    if (input) {
        input.value = '';
        input.focus();
    }
    renderPaletteList();
}
function closeCommandPalette() {
    paletteOpen = false;
    const root = document.getElementById('commandPalette');
    if (root)
        root.hidden = true;
    document.body.classList.remove('palette-open');
}
function isCommandPaletteOpen() {
    return paletteOpen;
}
function toggleCommandPalette() {
    if (paletteOpen)
        closeCommandPalette();
    else
        openCommandPalette();
}
function runPaletteAction(name, action) {
    if (!name)
        return;
    if (action === 'pin') {
        toggleSessionPin(name);
        if (typeof invalidateSessionRail === 'function')
            invalidateSessionRail();
        if (typeof invalidateShellTabs === 'function')
            invalidateShellTabs();
        renderShellTabs();
        if (typeof renderSessionRail === 'function')
            renderSessionRail();
        toast(isSessionPinned(name, pinnedSessionNames()) ? 'Pinned' : 'Unpinned');
        renderPaletteList();
        return;
    }
    closeCommandPalette();
    selectSession(name);
    if (action === 'shellin' && typeof openTerminal === 'function') {
        openTerminal(name);
    }
    else {
        focusComposer(name);
    }
}
