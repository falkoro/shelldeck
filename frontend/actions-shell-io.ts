// frontend/actions-shell-io.ts
async function sessionAction(endpoint: string, name: string, extra: Record<string, unknown> = {}): Promise<ApiPayload> {
  if (!shellUnlocked) throw new Error('Unlock shells first');
  const payload = await postJson(endpoint, { name, ...extra });
  toast(payload.message || 'Done');
  await refresh({ preserveUnlock: true });
  await loadShells(false);
  if (endpoint === '/api/restart') restartShellStream();
  return payload;
}

async function sendInput(name: string, submit: boolean): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  const input = inputFor(name);
  const text = input?.value || '';
  if (!text.trim()) throw new Error('Input is empty');
  if (activeDictation?.name === name) stopDictation();
  const payload = await postJson('/api/input', { name, text, submit });
  pushHistory(name, text);
  markAutoFollowUpSent(name, text);
  toast(payload.message || 'Sent');
  if (input) input.value = '';
  clearShellImages(name);
  setShellStatus(name, 'Sent. Attachments cleared.');
  updateUnlockState();
}

// Mic dictation records audio in the browser and transcribes it server-side (whisper.cpp via
// /api/transcribe). The browser-native Web Speech API is intentionally NOT used: it has no working
// recognition backend on Linux (Edge's is broken since v134; distro Chromium ships no speech key).
// First Mic click starts recording; the second click stops and transcribes into the shell input.
type ActiveDictation = {
  name: string;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  stopMonitor?: () => void;
};

let activeDictation: ActiveDictation | null = null;

