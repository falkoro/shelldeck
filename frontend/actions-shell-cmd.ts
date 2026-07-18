// frontend/actions-shell-cmd.ts
async function submitShellInput(name: string): Promise<void> {
  await sendInput(name, sendMode(name) === 'send');
}

// Send an explicit command line (not the textarea) to a shell, e.g. a recovery `codex resume <id>`.
async function runCommand(name: string, text: string): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  const payload = await postJson('/api/input', { name, text, submit: true });
  toast(payload.message || 'Sent');
}

async function sendKey(name: string, key: string): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  const payload = await postJson('/api/key', { name, key });
  toast(payload.message || 'Key sent');
}

function appendInput(value: string | undefined, name = selectedSession): void {
  const text = String(value || '');
  if (!text || !name) return;
  const input = inputFor(name);
  if (!input) return;
  input.value += (input.value && !input.value.endsWith('\n') ? '\n' : '') + text;
  input.focus();
  updateUnlockState();
}

function shellNameFromElement(element: Element | null): string {
  return element?.closest<HTMLElement>('[data-shell-card]')?.dataset.shellCard || selectedSession;
}

