"use strict";
// events split L207-279
document.addEventListener('focusin', (event) => {
    const input = event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]') ? event.target : null;
    if (input)
        selectSession(input.dataset.command);
});
document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-command]')) {
        resetHistoryNavigation(event.target.dataset.command || '');
        updateUnlockState();
    }
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
        if (cycleHistory(input.dataset.command || '', 1))
            event.preventDefault();
    }
    if (event.key === 'ArrowDown') {
        if (cycleHistory(input.dataset.command || '', -1))
            event.preventDefault();
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
