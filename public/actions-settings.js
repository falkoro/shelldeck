"use strict";
function applyDashboardSettings(settings) {
    const panels = { ...dashboardSettings.panels, ...(settings.panels || {}) };
    dashboardSettings = { ...settings, panels };
    const metricsPanel = document.getElementById('metricsPanel');
    const metricTemps = document.getElementById('metricTemps');
    const containersPanel = document.getElementById('containersPanel');
    const remotePanel = document.getElementById('remotePanel');
    const ciRunsPanel = document.getElementById('ciRunsPanel');
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
    if (ciRunsPanel)
        ciRunsPanel.hidden = !panels.ciRuns;
    if (linksPanel)
        linksPanel.hidden = !panels.links;
    if (tickerStrip)
        tickerStrip.hidden = !panels.tickers;
    if (tickerBar) {
        tickerBar.hidden = false;
        if (!panels.tickers)
            tickerBar.innerHTML = '<span class="ticker-empty">Tickers hidden</span>';
    }
    document.body.classList.toggle('expand-lists', !!panels.expandLists);
}
async function loadDashboardSettings() {
    const response = await fetch('/api/ui-config', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok)
        return;
    applyDashboardSettings(await response.json());
}
function focusSettingsEditor(focus) {
    const editor = document.getElementById('settingsEditor');
    if (!editor)
        return;
    const tickers = editor.querySelector('#tickerInput');
    if (focus === 'tickers' && tickers) {
        tickers.focus();
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
    overlay.innerHTML = `<form class="links-editor-box settings-editor-box"><div class="links-editor-head"><div><h2>Configure</h2><p class="muted">Sidebar widgets and stock tickers are saved in dashboard-config.json.</p></div><button type="button" class="ghost" data-close-settings>Cancel</button></div><div class="settings-grid"><label><input type="checkbox" name="machine" ${panels.machine ? 'checked' : ''}> Machine</label><label class="settings-subsetting"><input type="checkbox" name="machineSensors" ${panels.machineSensors ? 'checked' : ''}> Thermal sensors</label><label><input type="checkbox" name="remoteHosts" ${panels.remoteHosts ? 'checked' : ''}> Remote hosts</label><label><input type="checkbox" name="containers" ${panels.containers ? 'checked' : ''}> Local containers</label><label><input type="checkbox" name="ciRuns" ${panels.ciRuns ? 'checked' : ''}> CI runs</label><label><input type="checkbox" name="links" ${panels.links ? 'checked' : ''}> Links</label><label><input type="checkbox" name="tickers" ${panels.tickers ? 'checked' : ''}> Ticker bar</label><label><input type="checkbox" name="expandLists" ${panels.expandLists ? 'checked' : ''}> Expand lists (no scrollbars)</label></div><label>Tickers</label><div class="ticker-editor"><div class="ticker-chips" id="tickerChips"></div><div class="ticker-add"><input id="tickerInput" type="text" spellcheck="false" autocapitalize="characters" placeholder="Add symbol — e.g. NVDA, TSLA, BTC-USD"><button type="button" id="addTickerBtn"><span class="ticker-add-plus">+</span> Add</button></div><p class="muted ticker-hint">Enter to add · Finnhub symbols · US stocks + crypto (BTC-USD) · max 16</p></div><div class="links-editor-actions"><button type="submit" class="primary">${icon('settings')}<span>Save config</span></button></div></form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const chipsEl = overlay.querySelector('#tickerChips');
    const input = overlay.querySelector('#tickerInput');
    const editTickers = (dashboardSettings.tickers || []).slice();
    const renderChips = () => {
        chipsEl.innerHTML = editTickers.length
            ? editTickers.map((sym, i) => `<span class="ticker-chip">${escapeHtml(sym)}<button type="button" data-remove-ticker="${i}" title="Remove ${escapeHtml(sym)}" aria-label="Remove ${escapeHtml(sym)}">×</button></span>`).join('')
            : '<span class="muted ticker-empty-chip">No tickers yet — add one below</span>';
    };
    const addTicker = () => {
        const sym = input.value.trim().toUpperCase().replace(/[^A-Z0-9.\-_=^]/g, '').slice(0, 24);
        input.value = '';
        if (!sym)
            return;
        if (editTickers.includes(sym)) {
            toast(`${sym} already added`);
            return;
        }
        if (editTickers.length >= 16) {
            toast('Max 16 tickers');
            return;
        }
        editTickers.push(sym);
        renderChips();
        input.focus();
    };
    renderChips();
    chipsEl.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-remove-ticker]');
        if (!btn)
            return;
        editTickers.splice(Number(btn.dataset.removeTicker), 1);
        renderChips();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            addTicker();
        }
    });
    overlay.querySelector('#addTickerBtn')?.addEventListener('click', addTicker);
    const close = () => overlay.remove();
    overlay.querySelector('[data-close-settings]')?.addEventListener('click', close);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay)
        close(); });
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const data = new FormData(form);
        saveDashboardSettings({
            tickers: editTickers,
            panels: {
                machine: data.has('machine'),
                machineSensors: data.has('machineSensors'),
                remoteHosts: data.has('remoteHosts'),
                containers: data.has('containers'),
                ciRuns: data.has('ciRuns'),
                links: data.has('links'),
                tickers: data.has('tickers'),
                expandLists: data.has('expandLists'),
            },
        }).then(close).catch((error) => toast(error.message));
    });
    requestAnimationFrame(() => focusSettingsEditor(focus));
}
async function saveDashboardSettings(settings) {
    const saved = await postJson('/api/ui-config', settings);
    applyDashboardSettings(saved);
    await Promise.allSettled([loadTickers(), loadMetrics(), loadContainers(), loadRemoteHosts(), loadGhRuns(), loadLinks()]);
    toast('Config saved');
}
