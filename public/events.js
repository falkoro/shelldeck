"use strict";
document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target)
        return;
    const copyButton = target.closest('[data-copy]');
    const startButton = target.closest('[data-start]');
    const restartButton = target.closest('[data-restart]');
    const keyButton = target.closest('[data-key]');
    const sendButton = target.closest('[data-send-shell]');
    const pasteButton = target.closest('[data-paste-shell]');
    const imageButton = target.closest('[data-add-image]');
    const historyButton = target.closest('[data-history]');
    const copyOutputButton = target.closest('[data-copy-output]');
    const clearPreviewButton = target.closest('[data-clear-preview]');
    const shellinButton = target.closest('[data-shellin]');
    const resumeButton = target.closest('[data-resume]');
    const removeImageButton = target.closest('[data-remove-image]');
    const tabButton = target.closest('[data-shell-tab]');
    const selectItem = target.closest('[data-select-session]');
    const interactive = target.closest('textarea,input,button,a,pre');
    try {
        if (copyButton)
            return copyText(copyButton.dataset.copy || '');
        if (sendButton && !sendButton.disabled)
            return sendInput(sendButton.dataset.sendShell || '', true);
        if (pasteButton && !pasteButton.disabled)
            return sendInput(pasteButton.dataset.pasteShell || '', false);
        if (historyButton)
            return cycleHistory(historyButton.dataset.history || '', 1);
        if (copyOutputButton)
            return copyShellOutput(copyOutputButton.dataset.copyOutput || '');
        if (clearPreviewButton)
            return clearShellPreview(clearPreviewButton.dataset.clearPreview || '');
        if (shellinButton) {
            openTerminal(shellinButton.dataset.shellin || '');
            return;
        }
        const minimizeShellButton = target.closest('[data-minimize-shell]');
        if (minimizeShellButton) {
            minimizeShellPreview(minimizeShellButton.dataset.minimizeShell || '');
            return;
        }
        const resizePreviewButton = target.closest('[data-resize-preview]');
        if (resizePreviewButton) {
            floatAndResizeShellPreview(resizePreviewButton.dataset.resizePreview || '');
            return;
        }
        const maximizePreviewButton = target.closest('[data-maximize-preview]');
        if (maximizePreviewButton) {
            maximizeShellPreview(maximizePreviewButton.dataset.maximizePreview || '');
            return;
        }
        if (resumeButton && resumeButton.dataset.resumeCmd)
            return runCommand(resumeButton.dataset.resume || '', resumeButton.dataset.resumeCmd);
        if (removeImageButton)
            return removeShellImage(removeImageButton.dataset.shell || '', removeImageButton.dataset.removeImage || '');
        if (tabButton) {
            selectSession(tabButton.dataset.shellTab);
            focusComposer(tabButton.dataset.shellTab || '');
            return;
        }
        if (imageButton && !imageButton.disabled) {
            pendingImageTarget = imageButton.dataset.addImage || selectedSession;
            imageFile.click();
            return;
        }
        if (startButton && !startButton.disabled) {
            await sessionAction('/api/start', startButton.dataset.start || '');
            return selectSession(startButton.dataset.start);
        }
        if (restartButton && !restartButton.disabled) {
            await sessionAction('/api/restart', restartButton.dataset.restart || '');
            return selectSession(restartButton.dataset.restart);
        }
        if (keyButton && !keyButton.disabled)
            return sendKey(keyButton.dataset.shell || '', keyButton.dataset.key || '');
        // Select when clicking a session/card — allow the case where the clicked interactive element
        // IS the select target itself (the sidebar session items are <button data-select-session>),
        // but still ignore clicks on inner controls (textarea/pre inside a card).
        if (selectItem && (!interactive || interactive === selectItem)) {
            selectSession(selectItem.dataset.selectSession);
            focusComposer(selectItem.dataset.selectSession || '');
        }
    }
    catch (error) {
        toast(error instanceof Error ? error.message : String(error));
    }
});
document.addEventListener('focusin', (event) => {
    const input = event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]') ? event.target : null;
    if (input)
        selectSession(input.dataset.command);
});
document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]'))
        updateUnlockState();
});
document.addEventListener('keydown', (event) => {
    const input = event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]') ? event.target : null;
    if (!input)
        return;
    // Ctrl/Cmd+Enter sends on desktop; on touch/mobile-layout plain Enter sends (Shift+Enter =
    // newline) so phone users don't have to reach the Run button hidden behind the soft keyboard.
    const mobileSend = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || window.matchMedia('(max-width: 760px)').matches;
    if (event.key === 'Enter' && !event.shiftKey && (event.ctrlKey || event.metaKey || mobileSend)) {
        event.preventDefault();
        sendInput(input.dataset.command || '', true).catch((error) => toast(error.message));
    }
    if (event.key === 'ArrowUp' && !input.value) {
        event.preventDefault();
        cycleHistory(input.dataset.command || '', 1);
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        cycleHistory(input.dataset.command || '', -1);
    }
});
// Backstop: when focus is on the page body (not an editable field, button, link or
// select), Space scrolls the document. Swallow it and pull focus into the selected
// shell composer so a stray Space never jumps the page down.
document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.code !== 'Space')
        return;
    const el = document.activeElement;
    const interactive = el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement ||
        el instanceof HTMLButtonElement ||
        el instanceof HTMLAnchorElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable);
    if (interactive)
        return;
    event.preventDefault();
    focusComposer(selectedSession);
});
document.addEventListener('paste', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-shell-card]'))
        pasteImageFiles(event);
});
document.addEventListener('dragover', (event) => {
    const card = event.target instanceof Element ? event.target.closest('[data-shell-card]') : null;
    if (!card)
        return;
    event.preventDefault();
    card.classList.add('dragging');
});
document.addEventListener('dragleave', (event) => {
    const card = event.target instanceof Element ? event.target.closest('[data-shell-card]') : null;
    if (card)
        card.classList.remove('dragging');
});
document.addEventListener('drop', (event) => {
    const card = event.target instanceof Element ? event.target.closest('[data-shell-card]') : null;
    if (!card)
        return;
    event.preventDefault();
    card.classList.remove('dragging');
    handleImageFiles(event.dataTransfer?.files, card.dataset.shellCard || '').catch((error) => toast(error.message));
});
q('#refreshBtn').addEventListener('click', () => refresh().catch((error) => toast(error.message)));
q('#guideBtn').addEventListener('click', () => showOnboarding());
q('#refreshShellsTopBtn').addEventListener('click', () => loadShells().catch((error) => toast(error.message)));
q('#viewToggle').addEventListener('click', () => setViewMode(viewMode === 'focus' ? 'grid' : 'focus'));
q('#densityToggle').addEventListener('click', toggleDensity);
q('#followToggle').addEventListener('click', () => { followOutput = !followOutput; localStorage.setItem('sdFollowOutput', followOutput ? '1' : '0'); applyPrefs(); });
// Restore all minimized shell previews button (injected)
const shellTools = q('.shell-tools');
if (shellTools && !q('#restoreAllPreviewsBtn')) {
    const restoreAllBtn = document.createElement('button');
    restoreAllBtn.id = 'restoreAllPreviewsBtn';
    restoreAllBtn.type = 'button';
    restoreAllBtn.title = 'Restore all minimized shell previews from the dock';
    restoreAllBtn.innerHTML = 'Restore all';
    restoreAllBtn.addEventListener('click', () => {
        const fn = window.restoreAllShellPreviews || (() => {
            const set = window.minimizedPreviews;
            if (set)
                set.clear();
            document.querySelectorAll('[data-shell-card]').forEach(c => c.style.display = '');
            window.renderDock?.();
        });
        fn();
    });
    shellTools.appendChild(restoreAllBtn);
}
q('#lineCount').addEventListener('change', (event) => setTerminalLines(Number(event.target.value)));
imageFile.addEventListener('change', () => {
    handleImageFiles(imageFile.files || undefined, pendingImageTarget).catch((error) => toast(error.message)).finally(() => {
        imageFile.value = '';
    });
});
q('#unlockForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = q('#unlockPassword');
    unlockShells(input.value).catch((error) => {
        input.focus();
        toast(error.message);
    });
});
// The inline unlock prompt inside the shells area is rendered dynamically, so wire
// it through delegation. It reuses the same unlock flow as the sidebar form.
document.addEventListener('submit', (event) => {
    const form = event.target instanceof Element ? event.target.closest('#inlineUnlockForm') : null;
    if (!form)
        return;
    event.preventDefault();
    const input = document.getElementById('inlineUnlockPassword');
    const status = document.getElementById('inlineUnlockStatus');
    if (!input)
        return;
    if (status) {
        status.className = 'unlock-status';
        status.textContent = 'Checking second password...';
    }
    unlockShells(input.value).catch((error) => {
        input.focus();
        if (status) {
            status.className = 'unlock-status error';
            status.textContent = error.message;
        }
        toast(error.message);
    });
});
// --- Drag-to-reorder shell cards ---
// Mousedown on a card header initiates reorder after a drag threshold.
document.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    // Only start reorder if dragging from the card header (not buttons/inputs inside)
    const header = target?.closest('.terminal-card > header');
    if (!header)
        return;
    // Don't initiate drag when clicking buttons, inputs, or the card window controls
    if (event.target?.closest('button,input,textarea,select,[data-minimize-shell],[data-resize-preview],[data-maximize-shell]'))
        return;
    const card = header.closest('[data-shell-card]');
    if (!card)
        return;
    const name = card.dataset.shellCard || '';
    if (!name)
        return;
    const grid = card.parentElement;
    if (!grid)
        return;
    const startX = event.clientX;
    const startY = event.clientY;
    let reorderActive = false;
    let dragEl = null;
    const onMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!reorderActive && Math.abs(dx) + Math.abs(dy) < DRAG_REORDER_THRESHOLD)
            return;
        if (!reorderActive) {
            reorderActive = true;
            card.classList.add('reorder-dragging');
            dragEl = card.cloneNode(true);
            dragEl.classList.add('reorder-clone');
            dragEl.style.position = 'fixed';
            dragEl.style.pointerEvents = 'none';
            dragEl.style.zIndex = '999';
            dragEl.style.width = `${card.offsetWidth}px`;
            dragEl.style.left = '0';
            dragEl.style.top = '0';
            dragEl.style.opacity = '0.85';
            dragEl.style.transform = 'scale(0.97)';
            document.body.appendChild(dragEl);
            card.style.opacity = '0.35';
        }
        // Update clone position
        if (dragEl) {
            dragEl.style.left = `${e.clientX - 40}px`;
            dragEl.style.top = `${e.clientY - 14}px`;
        }
        // Highlight target position
        const cards = Array.from(grid.querySelectorAll('[data-shell-card]:not(.reorder-dragging)'));
        cards.forEach((c) => c.classList.remove('reorder-target'));
        const targetEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-shell-card]');
        if (targetEl && targetEl !== card)
            targetEl.classList.add('reorder-target');
    };
    const onUp = (e) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('reorder-dragging');
        card.style.opacity = '';
        if (dragEl)
            dragEl.remove();
        grid.querySelectorAll('[data-shell-card]').forEach((c) => c.classList.remove('reorder-target'));
        if (!reorderActive)
            return;
        // Find the card we dropped on
        const dropTarget = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-shell-card]');
        if (!dropTarget || dropTarget === card)
            return;
        const targetName = dropTarget.dataset.shellCard || '';
        if (!targetName)
            return;
        // Reorder in the saved list
        const order = shellOrder();
        const fromIdx = order.indexOf(name);
        const toIdx = order.indexOf(targetName);
        if (fromIdx < 0 || toIdx < 0)
            return;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, name);
        saveShellOrder(order);
        // Physically reorder in DOM
        const cards = Array.from(grid.querySelectorAll('[data-shell-card]'));
        const fromCard = cards.find((c) => c.dataset.shellCard === name);
        const toCard = cards.find((c) => c.dataset.shellCard === targetName);
        if (fromCard && toCard) {
            if (fromIdx > toIdx) {
                toCard.before(fromCard);
            }
            else {
                toCard.after(fromCard);
            }
        }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
});
// --- Drag-to-resize shell cards ---
document.addEventListener('mousedown', (event) => {
    const handle = event.target?.closest('.card-resize-handle');
    if (!handle)
        return;
    event.preventDefault();
    event.stopPropagation();
    const card = handle.closest('[data-shell-card]');
    if (!card)
        return;
    const name = card.dataset.shellCard || '';
    const startX = event.clientX;
    const startY = event.clientY;
    const origH = card.offsetHeight;
    const origW = card.offsetWidth;
    card.classList.add('resizing');
    const onMove = (e) => {
        const newH = Math.max(280, Math.min(1200, origH + (e.clientY - startY)));
        const newW = Math.max(340, Math.min(window.innerWidth - 40, origW + (e.clientX - startX)));
        card.style.minHeight = `${newH}px`;
        if (newW > 340)
            card.style.maxWidth = `${newW}px`;
        // Update the pre element's max-height to keep it proportional
        const pre = card.querySelector('[data-role="output"]');
        if (pre)
            pre.style.maxHeight = `${Math.max(180, newH - 220)}px`;
        // Track that this card has been resized
        card.dataset.sized = '1';
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('resizing');
        if (name) {
            saveShellCardSize(name, { w: card.offsetWidth, h: card.offsetHeight });
        }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
});
render(initialModel);
buildLegend();
maybeShowOnboarding();
queueMicrotask(() => loadSummary().catch(() => { }));
queueMicrotask(() => loadShells().then(startShellStream).catch((error) => toast(error.message)));
setInterval(() => refresh({ preserveUnlock: true }).catch(() => { }), 30000);
setInterval(() => loadSummary().catch(() => { }), 60000);
// Live-tick relative last activity labels (the main "add last activity" UX fix for code.falkinator.org)
// Note: defined in core.ts (loaded before events.js in the page).
window.updateLastActivityTimes?.();
setInterval(() => window.updateLastActivityTimes?.(), 30000);
// Live tickers (if any configured)
queueMicrotask(() => loadTickers().catch(() => { }));
setInterval(() => loadTickers().catch(() => { }), 60000);
