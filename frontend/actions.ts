let shellStream: EventSource | null = null;

async function loadTickers(): Promise<void> {
  if (!document.getElementById('tickerBar')) return;
  const response = await fetch('/api/tickers', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const payload = await response.json() as { tickers?: Ticker[] };
  renderTickers(payload.tickers || []);
}

async function sessionAction(endpoint: string, name: string): Promise<void> {
  if (!shellUnlocked) throw new Error('Unlock shells first');
  const payload = await postJson(endpoint, { name });
  toast(payload.message || 'Done');
  await refresh({ preserveUnlock: true });
  await loadShells(false);
}

async function sendInput(name: string, submit: boolean): Promise<void> {
  if (!targetReady(name)) throw new Error('Choose a running unlocked shell');
  const input = inputFor(name);
  const text = input?.value || '';
  if (!text.trim()) throw new Error('Input is empty');
  const payload = await postJson('/api/input', { name, text, submit });
  pushHistory(name, text);
  toast(payload.message || 'Sent');
  if (input) input.value = '';
  updateUnlockState();
}

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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(file: File, name: string): Promise<void> {
  if (!shellUnlocked) throw new Error('Unlock shells first');
  if (!name) throw new Error('Choose a shell first');
  if (!String(file.type || '').startsWith('image/')) throw new Error('That file is not an image');
  setShellStatus(name, 'Saving image...');
  const payload = await postJson('/api/upload-image', {
    name: file.name || 'pasted-image',
    type: file.type,
    dataUrl: await fileToDataUrl(file),
  });
  if (!payload.image) throw new Error('Image upload did not return an image');
  addShellImage(name, payload.image);
  appendInput(payload.image.path, name);
  setShellStatus(name, `Inserted ${payload.image.path}`);
  toast('Image path inserted');
}

async function handleImageFiles(files: FileList | File[] | undefined, name: string): Promise<void> {
  const images = Array.from(files || []).filter((file) => String(file.type || '').startsWith('image/'));
  for (const image of images) await uploadImageFile(image, name);
}

function pasteImageFiles(event: ClipboardEvent, name?: string): void {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (!files.length) return;
  event.preventDefault();
  handleImageFiles(files, name || shellNameFromElement(event.target instanceof Element ? event.target : null)).catch((error: Error) => {
    toast(error.message);
  });
}

function setShellStatus(name: string, text: string): void {
  const card = document.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(name)}"]`);
  const status = card?.querySelector<HTMLElement>('[data-role="status"]');
  if (status) status.textContent = text;
}

// The Hermes/Grok summary is no longer shown as one block — it feeds the per-slot titles
// (sessionWorkTitle) so each shell shows its own line. We only keep the raw text + repaint titles.
async function loadSummary(): Promise<void> {
  if (!shellUnlocked) {
    latestSummaryText = '';
    summaryLoading = false;
    applyWorkTitles();
    return;
  }
  summaryLoading = true;
  applyWorkTitles();
  try {
    const response = await fetch('/api/summary', { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json() as ApiPayload;
    if (!response.ok) throw new Error(payload.error || 'Summary failed');
    // Ignore the transient `local` fallback (bridge blip) so good titles aren't overwritten with
    // the bare "command · cwd" local format; keep the last real summary instead.
    if (!String(payload.provider || '').startsWith('local')) latestSummaryText = payload.summary || '';
  } finally {
    summaryLoading = false;
    applyWorkTitles();
  }
}

async function unlockShells(password: string): Promise<void> {
  const status = q('#unlockStatus');
  status.className = 'unlock-status';
  status.textContent = 'Checking second password...';
  const payload = await postJson('/api/unlock', { password });
  shellUnlocked = true;
  status.className = 'unlock-status ok';
  status.textContent = 'Unlocked. Loading shell panes now...';
  q<HTMLInputElement>('#unlockPassword').value = '';
  if (payload.model) render({ ...payload.model, unlocked: true });
  if (Array.isArray(payload.shells)) renderShells({ shells: payload.shells });
  startShellStream();
  (document.getElementById('currentWork') || q('#shellSection')).scrollIntoView({ block: 'start', behavior: 'smooth' });
  toast(payload.message || 'Unlocked');
  await Promise.allSettled([refresh({ preserveUnlock: true }), loadSummary()]);
}

async function loadShells(showLoading = true): Promise<void> {
  const grid = q('#shells');
  if (!shellUnlocked) {
    grid.innerHTML = `<div class="unlock-cta">
      <div class="unlock-cta-lock">${icon('lock')}</div>
      <h3>Shells are locked in this browser</h3>
      <p class="muted">This Chrome profile isn't unlocked yet. Enter your second password to reveal all live tmux panes.</p>
      <form class="unlock-form" id="inlineUnlockForm">
        <input id="inlineUnlockPassword" name="password" type="password" autocomplete="one-time-code" placeholder="second password">
        <button class="primary" type="submit">${icon('unlock')}<span>Unlock shells</span></button>
      </form>
      <div class="unlock-status" id="inlineUnlockStatus"></div>
    </div>`;
    (document.getElementById('inlineUnlockPassword') as HTMLInputElement | null)?.focus();
    setStreamState('stream locked');
    return;
  }
  if (showLoading && !grid.querySelector('[data-shell-card]')) {
    grid.innerHTML = '<div class="locked-note">Loading shell previews...</div>';
  }
  const response = await fetch(shellEndpoint('/api/shells'), { cache: 'no-store', credentials: 'same-origin' });
  const payload = await response.json() as ApiPayload;
  if (!response.ok) {
    if (response.status === 403) shellUnlocked = false;
    updateUnlockState();
    grid.innerHTML = `<div class="locked-note">${escapeHtml(payload.error || 'Shell preview failed')}. Enter the second password and try again.</div>`;
    throw new Error(payload.error || 'Shell preview failed');
  }
  renderShells({ shells: payload.shells });
}

function startShellStream(): void {
  if (!shellUnlocked || shellStream) return;
  if (!('EventSource' in window)) {
    setStreamState('stream unavailable');
    return;
  }
  shellStream = new EventSource(shellEndpoint('/api/shells/stream'));
  shellStream.addEventListener('shells', (event) => {
    const payload = JSON.parse((event as MessageEvent).data) as ApiPayload;
    renderShells({ shells: payload.shells });
    setStreamState(`live ${new Date().toLocaleTimeString()}`, true);
  });
  shellStream.onerror = () => setStreamState('stream reconnecting');
}

function restartShellStream(): void {
  if (shellStream) {
    shellStream.close();
    shellStream = null;
  }
  startShellStream();
}

function copyShellOutput(name: string): Promise<void> {
  const text = shellPreviewByName(name)?.output || '';
  if (!text) throw new Error('No output to copy');
  return copyText(text);
}

function clearShellPreview(name: string): void {
  const shell = shellPreviewByName(name);
  if (!shell) return;
  clearedOutputs[name] = shell.output;
  const pre = document.querySelector<HTMLElement>(`[data-shell-card="${selectorEscape(name)}"] [data-role="output"]`);
  if (pre) pre.textContent = '';
}

async function loadAgents(): Promise<void> {
  if (!shellUnlocked) {
    latestAgents = [];
    renderAgents();
    return;
  }
  const response = await fetch('/api/agents', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) {
    latestAgents = [];
    renderAgents();
    return;
  }
  const payload = await response.json() as { agents?: Agent[] };
  latestAgents = payload.agents || [];
  renderAgents();
  applyAgentBadges();
}
