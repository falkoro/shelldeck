"use strict";
let armedShellActionTimer = 0;
function clearArmedShellAction() {
    if (armedShellActionTimer) {
        window.clearTimeout(armedShellActionTimer);
        armedShellActionTimer = 0;
    }
    document.querySelectorAll('[data-shell-confirm-key]').forEach((button) => {
        const label = button.querySelector('span');
        if (label && button.dataset.originalLabel !== undefined)
            label.textContent = button.dataset.originalLabel;
        if (button.dataset.originalTitle !== undefined)
            button.title = button.dataset.originalTitle;
        if (button.dataset.originalAria !== undefined)
            button.setAttribute('aria-label', button.dataset.originalAria);
        button.classList.remove('confirming');
        button.removeAttribute('aria-pressed');
        delete button.dataset.shellConfirmKey;
        delete button.dataset.originalLabel;
        delete button.dataset.originalTitle;
        delete button.dataset.originalAria;
    });
}
function setShellActionStatus(name, message) {
    const card = document.querySelector(`[data-shell-card="${selectorEscape(name)}"]`);
    const status = card?.querySelector('[data-role="status"]');
    if (status)
        status.textContent = message;
}
function armShellDangerAction(button, action, name) {
    if (!name)
        return false;
    const key = `${action}:${name}`;
    if (button.dataset.shellConfirmKey === key) {
        clearArmedShellAction();
        return true;
    }
    clearArmedShellAction();
    const label = button.querySelector('span');
    const verb = action === 'stop' ? 'terminate' : 'restart';
    const confirmLabel = action === 'stop' ? 'Confirm terminate' : 'Confirm restart';
    const detail = action === 'stop'
        ? `Terminate "${name}" kills the tmux session, stops everything inside it, and hides it from this dashboard.`
        : `Restart "${name}" kills and recreates the tmux session, keeping this dashboard slot visible.`;
    button.dataset.shellConfirmKey = key;
    button.dataset.originalTitle = button.title || '';
    button.dataset.originalAria = button.getAttribute('aria-label') || '';
    if (label) {
        button.dataset.originalLabel = label.textContent || '';
        label.textContent = confirmLabel;
    }
    button.classList.add('confirming');
    button.setAttribute('aria-pressed', 'true');
    button.setAttribute('aria-label', confirmLabel);
    button.title = `${detail} Click again to confirm.`;
    setShellActionStatus(name, `${detail} Click ${confirmLabel} within 5 seconds.`);
    toast(`Click again to ${verb} ${name}`);
    armedShellActionTimer = window.setTimeout(clearArmedShellAction, 5000);
    return false;
}
