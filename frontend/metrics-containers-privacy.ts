function containerPrivacyState(): Record<ContainerPrivacyScope, boolean> {
  const saved = storageJson<Partial<Record<ContainerPrivacyScope, boolean>> | null>(CONTAINER_PRIVACY_KEY, null);
  return { local: Boolean(saved?.local), remote: Boolean(saved?.remote) };
}

function containerPrivacyOn(scope: ContainerPrivacyScope): boolean {
  return containerPrivacyState()[scope];
}

function saveContainerPrivacy(scope: ContainerPrivacyScope, on: boolean): void {
  const state = containerPrivacyState();
  state[scope] = on;
  localStorage.setItem(CONTAINER_PRIVACY_KEY, JSON.stringify(state));
}

function containerPrivacyPanel(scope: ContainerPrivacyScope): HTMLElement | null {
  return document.getElementById(scope === 'local' ? 'containersPanel' : 'remotePanel');
}

function syncContainerPrivacyTitles(panel: HTMLElement, on: boolean): void {
  panel.querySelectorAll<HTMLElement>('[title]').forEach((el) => {
    if (el.matches('[data-container-privacy]')) return;
    if (on) {
      if (el.dataset.privacyTitle === undefined) {
        el.dataset.privacyTitle = el.getAttribute('title') || '';
      }
      el.removeAttribute('title');
    } else if (el.dataset.privacyTitle !== undefined) {
      const title = el.dataset.privacyTitle;
      if (title) el.setAttribute('title', title);
      delete el.dataset.privacyTitle;
    }
  });
}

function applyContainerPrivacy(scope: ContainerPrivacyScope): void {
  const on = containerPrivacyOn(scope) || privacyAllOn();
  const panel = containerPrivacyPanel(scope);
  panel?.classList.toggle('container-privacy-blur', on);
  if (panel) syncContainerPrivacyTitles(panel, on);
  const button = document.querySelector<HTMLButtonElement>(`[data-container-privacy="${scope}"]`);
  if (!button) return;
  button.classList.toggle('active', on);
  button.setAttribute('aria-pressed', String(on));
  button.title = on
    ? `Show ${scope === 'local' ? 'local' : 'remote'} container text`
    : `Blur ${scope === 'local' ? 'local' : 'remote'} container text`;
  button.setAttribute('aria-label', button.title);
}

function applyAllContainerPrivacy(): void {
  applyContainerPrivacy('local');
  applyContainerPrivacy('remote');
}

function toggleContainerPrivacy(rawScope: string): void {
  if (rawScope === 'all') {
    togglePrivacyAll();
    return;
  }
  if (privacyAllOn()) setPrivacyAll(false);
  const scope = rawScope === 'remote' ? 'remote' : rawScope === 'local' ? 'local' : null;
  if (!scope) return;
  const next = !containerPrivacyOn(scope);
  saveContainerPrivacy(scope, next);
  applyContainerPrivacy(scope);
  toast(next ? 'Container text blurred' : 'Container text visible');
}

(window as any).toggleContainerPrivacy = toggleContainerPrivacy;

