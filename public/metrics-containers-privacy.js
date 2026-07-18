"use strict";
function containerPrivacyState() {
    const saved = storageJson(CONTAINER_PRIVACY_KEY, null);
    return { local: Boolean(saved?.local), remote: Boolean(saved?.remote) };
}
function containerPrivacyOn(scope) {
    return containerPrivacyState()[scope];
}
function saveContainerPrivacy(scope, on) {
    const state = containerPrivacyState();
    state[scope] = on;
    localStorage.setItem(CONTAINER_PRIVACY_KEY, JSON.stringify(state));
}
function containerPrivacyPanel(scope) {
    return document.getElementById(scope === 'local' ? 'containersPanel' : 'remotePanel');
}
function syncContainerPrivacyTitles(panel, on) {
    panel.querySelectorAll('[title]').forEach((el) => {
        if (el.matches('[data-container-privacy]'))
            return;
        if (on) {
            if (el.dataset.privacyTitle === undefined) {
                el.dataset.privacyTitle = el.getAttribute('title') || '';
            }
            el.removeAttribute('title');
        }
        else if (el.dataset.privacyTitle !== undefined) {
            const title = el.dataset.privacyTitle;
            if (title)
                el.setAttribute('title', title);
            delete el.dataset.privacyTitle;
        }
    });
}
function applyContainerPrivacy(scope) {
    const on = containerPrivacyOn(scope) || privacyAllOn();
    const panel = containerPrivacyPanel(scope);
    panel?.classList.toggle('container-privacy-blur', on);
    if (panel)
        syncContainerPrivacyTitles(panel, on);
    const button = document.querySelector(`[data-container-privacy="${scope}"]`);
    if (!button)
        return;
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', String(on));
    button.title = on
        ? `Show ${scope === 'local' ? 'local' : 'remote'} container text`
        : `Blur ${scope === 'local' ? 'local' : 'remote'} container text`;
    button.setAttribute('aria-label', button.title);
}
function applyAllContainerPrivacy() {
    applyContainerPrivacy('local');
    applyContainerPrivacy('remote');
}
function toggleContainerPrivacy(rawScope) {
    if (rawScope === 'all') {
        togglePrivacyAll();
        return;
    }
    if (privacyAllOn())
        setPrivacyAll(false);
    const scope = rawScope === 'remote' ? 'remote' : rawScope === 'local' ? 'local' : null;
    if (!scope)
        return;
    const next = !containerPrivacyOn(scope);
    saveContainerPrivacy(scope, next);
    applyContainerPrivacy(scope);
    toast(next ? 'Container text blurred' : 'Container text visible');
}
window.toggleContainerPrivacy = toggleContainerPrivacy;
