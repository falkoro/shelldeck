"use strict";
const PRIVACY_ALL_KEY = 'sdPrivacyAll';
function privacyAllOn() {
    return localStorage.getItem(PRIVACY_ALL_KEY) === '1';
}
function applyPrivacyAll() {
    const on = privacyAllOn();
    document.body.classList.toggle('privacy-all', on);
    const allBtn = document.querySelector('[data-container-privacy="all"]');
    if (allBtn) {
        allBtn.classList.toggle('active', on);
        allBtn.setAttribute('aria-pressed', String(on));
        allBtn.title = on ? 'Show dashboard text' : 'Blur dashboard text';
        allBtn.setAttribute('aria-label', allBtn.title);
    }
    const containersPanel = document.getElementById('containersPanel');
    const remotePanel = document.getElementById('remotePanel');
    if (on) {
        containersPanel?.classList.add('container-privacy-blur');
        remotePanel?.classList.add('container-privacy-blur');
        document.querySelectorAll('[data-shell-card]').forEach((card) => {
            card.classList.add('privacy-blur');
            card.querySelector('[data-privacy-shell]')?.classList.add('active');
        });
    }
    else {
        containersPanel?.classList.remove('container-privacy-blur');
        remotePanel?.classList.remove('container-privacy-blur');
        if (typeof applyAllContainerPrivacy === 'function')
            applyAllContainerPrivacy();
        document.querySelectorAll('[data-shell-card]').forEach((card) => {
            applyShellPrivacy(card, card.dataset.shellCard || '');
        });
    }
}
function setPrivacyAll(on) {
    localStorage.setItem(PRIVACY_ALL_KEY, on ? '1' : '0');
    if (on) {
        localStorage.setItem('sdContainerPrivacy', JSON.stringify({ local: true, remote: true }));
        const names = [];
        document.querySelectorAll('[data-shell-card]').forEach((card) => {
            if (card.dataset.shellCard)
                names.push(card.dataset.shellCard);
        });
        privateShells = new Set(names);
        localStorage.setItem('sdPrivateShells', JSON.stringify(names));
    }
    else {
        privateShells.clear();
        localStorage.setItem('sdPrivateShells', '[]');
        localStorage.setItem('sdContainerPrivacy', JSON.stringify({ local: false, remote: false }));
    }
    applyPrivacyAll();
}
function togglePrivacyAll() {
    const next = !privacyAllOn();
    setPrivacyAll(next);
    toast(next ? 'All dashboard text blurred' : 'All dashboard text visible');
}
