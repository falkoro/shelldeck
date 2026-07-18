"use strict";
// events split L434-511
// Step the selected shell to the previous/next tab.
function cycleShell(direction) {
    const tabs = Array.from(document.querySelectorAll('[data-shell-tab]'))
        .map((el) => el.dataset.shellTab || '')
        .filter(Boolean);
    if (!tabs.length)
        return;
    const current = Math.max(0, tabs.indexOf(selectedSession));
    const next = tabs[(current + direction + tabs.length) % tabs.length];
    if (next)
        selectSession(next);
}
// Command palette: ⌘/Ctrl+K always; plain / when not typing in a field.
document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (typeof toggleCommandPalette === 'function')
            toggleCommandPalette();
        return;
    }
    if (event.key === 'Escape' && typeof isCommandPaletteOpen === 'function' && isCommandPaletteOpen()) {
        event.preventDefault();
        if (typeof closeCommandPalette === 'function')
            closeCommandPalette();
    }
});
// Single-key shortcuts, active only when focus isn't in a field, the terminal, or with a modifier.
document.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey)
        return;
    const el = document.activeElement;
    const busy = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement || (el instanceof HTMLElement && (el.isContentEditable || !!el.closest('.term-window') || !!el.closest('#commandPalette')));
    if (busy)
        return;
    switch (event.key) {
        case '/':
            event.preventDefault();
            if (typeof openCommandPalette === 'function')
                openCommandPalette();
            break;
        case 'r':
            event.preventDefault();
            document.getElementById('refreshShellsTopBtn')?.click();
            break;
        case 'g':
            event.preventDefault();
            document.getElementById('viewToggle')?.click();
            break;
        case 'c':
            event.preventDefault();
            document.getElementById('densityToggle')?.click();
            break;
        case 'f':
            event.preventDefault();
            document.getElementById('followToggle')?.click();
            break;
        case '[':
            event.preventDefault();
            cycleShell(-1);
            break;
        case ']':
            event.preventDefault();
            cycleShell(1);
            break;
        case '?':
            event.preventDefault();
            toast('Shortcuts — / or ⌘K jump · r refresh · g grid · c density · f follow · [ ] cycle');
            break;
        default: break;
    }
});
document.getElementById('lineCount')?.addEventListener('change', (event) => setTerminalLines(Number(event.target.value)));
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
// Mousedown on the grip or card header initiates reorder after a drag threshold.
