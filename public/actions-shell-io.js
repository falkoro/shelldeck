"use strict";
// frontend/actions-shell-io.ts
async function sessionAction(endpoint, name, extra = {}) {
    if (!shellUnlocked)
        throw new Error('Unlock shells first');
    const payload = await postJson(endpoint, { name, ...extra });
    toast(payload.message || 'Done');
    await refresh({ preserveUnlock: true });
    await loadShells(false);
    if (endpoint === '/api/restart')
        restartShellStream();
    return payload;
}
async function sendInput(name, submit) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    const input = inputFor(name);
    const text = input?.value || '';
    if (!text.trim())
        throw new Error('Input is empty');
    if (activeDictation?.name === name)
        stopDictation();
    const payload = await postJson('/api/input', { name, text, submit });
    pushHistory(name, text);
    markAutoFollowUpSent(name, text);
    toast(payload.message || 'Sent');
    if (input)
        input.value = '';
    clearShellImages(name);
    setShellStatus(name, 'Sent. Attachments cleared.');
    updateUnlockState();
}
let activeDictation = null;
