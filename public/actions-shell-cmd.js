"use strict";
// frontend/actions-shell-cmd.ts
async function submitShellInput(name) {
    await sendInput(name, sendMode(name) === 'send');
}
// Send an explicit command line (not the textarea) to a shell, e.g. a recovery `codex resume <id>`.
async function runCommand(name, text) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    const payload = await postJson('/api/input', { name, text, submit: true });
    toast(payload.message || 'Sent');
}
async function sendKey(name, key) {
    if (!targetReady(name))
        throw new Error('Choose a running unlocked shell');
    const payload = await postJson('/api/key', { name, key });
    toast(payload.message || 'Key sent');
}
function appendInput(value, name = selectedSession) {
    const text = String(value || '');
    if (!text || !name)
        return;
    const input = inputFor(name);
    if (!input)
        return;
    input.value += (input.value && !input.value.endsWith('\n') ? '\n' : '') + text;
    input.focus();
    updateUnlockState();
}
function shellNameFromElement(element) {
    return element?.closest('[data-shell-card]')?.dataset.shellCard || selectedSession;
}
