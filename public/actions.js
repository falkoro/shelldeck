"use strict";
// frontend/actions.ts
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
        if (typeof invalidateSessionRail === 'function')
            invalidateSessionRail();
        if (typeof renderSessionRail === 'function')
            renderSessionRail();
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
    status.textContent = 'Unlocked. Attaching live terminal...';
    q('#unlockPassword').value = '';
    if (payload.model)
        render({ ...payload.model, unlocked: true });
    if (Array.isArray(payload.shells))
        renderShells({ shells: payload.shells });
    startShellStream();
    if (selectedSession && typeof openTerminal === 'function')
        openTerminal(selectedSession);
    document.getElementById('shellSection')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    toast(payload.message || 'Unlocked');
    await Promise.allSettled([refresh({ preserveUnlock: true }), loadSummary()]);
}
async function loadShells(showLoading = true) {
    const grid = document.getElementById('shells') || q('#shells');
    if (!shellUnlocked) {
        const empty = document.getElementById('liveStageEmpty');
        if (empty) {
            empty.removeAttribute('hidden');
            empty.innerHTML = `<div class="unlock-cta">
      <div class="unlock-cta-lock">${icon('lock')}</div>
      <h3>Terminal locked</h3>
      <p class="muted">Enter the second password in the left Unlock panel (or below) to attach live tmux.</p>
      <form class="unlock-form" id="inlineUnlockForm">
        <input id="inlineUnlockPassword" name="password" type="password" autocomplete="one-time-code" placeholder="second password">
        <button class="primary" type="submit">${icon('unlock')}<span>Unlock</span></button>
      </form>
      <div class="unlock-status" id="inlineUnlockStatus"></div>
    </div>`;
        }
        document.getElementById('inlineUnlockPassword')?.focus();
        setStreamState('stream locked');
        return;
    }
    if (showLoading) {
        const cached = cachedShellPreviews();
        if (cached.length) {
            setShellsLoading(true);
            renderShells({ shells: cached, fromCache: true });
            setStreamState('refreshing shells');
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
        setStreamState('live', true);
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
    const sel = window.getSelection?.();
    const selText = sel?.toString() || '';
    const card = document.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
    if (selText.trim() && card && sel?.anchorNode && card.contains(sel.anchorNode)) {
        return copyText(selText);
    }
    const pre = card?.querySelector('[data-role="output"]');
    const text = pre?.dataset.rawOutput || shellPreviewByName(name)?.output || '';
    if (!text.trim())
        throw new Error('No output to copy');
    return copyText(text);
}
function toggleShellPrivacy(name) {
    if (!name)
        return;
    if (privacyAllOn())
        setPrivacyAll(false);
    const next = !shellPrivate(name);
    setShellPrivate(name, next);
    toast(next ? 'Shell text blurred' : 'Shell text visible');
}
