"use strict";
// First-run onboarding: a one-screen welcome that explains the core moves. Shown automatically the
// first time (until dismissed, tracked in localStorage) and re-openable from the "Guide" button.
function showOnboarding() {
    if (document.getElementById('onboard'))
        return;
    const steps = [
        ['lock', 'Unlock to take control', 'Enter your second password in “Shell Unlock” to enable input, live previews and the terminal.'],
        ['grid', 'Your shells, side by side', 'Every tmux session streams live. Type and hit Send (Enter on mobile), or Paste to insert without running.'],
        ['terminal', 'Shell in', 'Open a real interactive terminal in any session — type, Ctrl-C, run anything, like being there.'],
        ['restart', 'Recover crashed agents', 'If an agent exits and prints a resume command, a one-click Resume button appears on that shell.'],
        ['clock', 'See what’s happening', 'Each shell’s title summarises the work; the green/amber dot shows running vs waiting for your input.'],
    ];
    const rows = steps
        .map(([ic, head, body]) => `<div class="onboard-row">${icon(ic)}<div><b>${escapeHtml(head)}</b><span>${escapeHtml(body)}</span></div></div>`)
        .join('');
    const overlay = document.createElement('div');
    overlay.className = 'onboard-modal';
    overlay.id = 'onboard';
    overlay.innerHTML = `<div class="onboard-box"><div class="onboard-head"><div class="brand-mark">SD</div><div><h2>Welcome to ShellDeck</h2><p class="muted">Monitor and drive your tmux sessions and AI agents from one place.</p></div></div><div class="onboard-steps">${rows}</div><button class="primary wide" id="onboardDone" type="button">Get started</button></div>`;
    document.body.appendChild(overlay);
    const done = () => {
        localStorage.setItem('sdOnboarded', '1');
        overlay.remove();
    };
    overlay.querySelector('#onboardDone').addEventListener('click', done);
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay)
        done(); });
}
function maybeShowOnboarding() {
    if (!localStorage.getItem('sdOnboarded'))
        showOnboarding();
}
