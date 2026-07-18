// events split L280-433
q('#refreshBtn').addEventListener('click', () => refresh().catch((error: Error) => toast(error.message)));
document.getElementById('settingsBtn')?.addEventListener('click', () => openSettingsEditor());
document.getElementById('hostLabel')?.addEventListener('click', () => {
  const hostname = currentModel?.hostname || '';
  if (renameHostLabel(hostname)) toast('Dashboard name updated');
});
document.getElementById('brandIconBtn')?.addEventListener('click', (event) => {
  if (event.shiftKey) {
    resetBrandIcon();
    toast('Icon reset');
    return;
  }
  document.getElementById('brandIconInput')?.click();
});
document.getElementById('brandIconInput')?.addEventListener('change', () => {
  const input = document.getElementById('brandIconInput') as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  changeBrandIcon(file)
    .then(() => toast('Icon updated'))
    .catch((error: Error) => toast(error.message))
    .finally(() => { if (input) input.value = ''; });
});
document.getElementById('editTickersBtn')?.addEventListener('click', () => openSettingsEditor('tickers'));
document.getElementById('safeShotBtn')?.addEventListener('click', () => createSafeShot().catch((error: Error) => toast(error.message)));
document.getElementById('editLinksBtn')?.addEventListener('click', () => openLinksEditor());
document.getElementById('editRemoteHostsBtn')?.addEventListener('click', () => openRemoteHostsEditor().catch((error: Error) => toast(error.message)));
document.getElementById('refreshSummaryBtn')?.addEventListener('click', () => refreshSummaries().catch((error: Error) => toast(error.message)));
q<HTMLButtonElement>('#refreshShellsTopBtn').title = 'Refresh shells';
q('#refreshShellsTopBtn').addEventListener('click', () => loadShells().catch((error: Error) => toast(error.message)));
document.getElementById('viewToggle')?.addEventListener('click', () => setViewMode(viewMode === 'focus' ? 'grid' : 'focus'));
document.getElementById('densityToggle')?.addEventListener('click', toggleDensity);
document.getElementById('followToggle')?.addEventListener('click', () => { followOutput = !followOutput; localStorage.setItem('sdFollowOutput', followOutput ? '1' : '0'); applyPrefs(); });

// Side-panels toggle in the top bar. The side rail (Machine/Remote/Containers/Links/Unlock) is
// OPTIONAL — this always-visible button is the hint that it can be shown/hidden, and the choice
// persists per browser (sdSidebar). Injected so it needs no HTML rebuild.
const topActions = document.querySelector<HTMLElement>('.top-actions');
if (topActions && !document.getElementById('sidebarToggle')) {
  const sidebarBtn = document.createElement('button');
  sidebarBtn.id = 'sidebarToggle';
  sidebarBtn.type = 'button';
  sidebarBtn.className = 'ghost';
  sidebarBtn.innerHTML = `${icon('sidebar')}<span>Monitor</span>`;
  sidebarBtn.title = 'Show or hide the right-side monitor rail';
  sidebarBtn.addEventListener('click', toggleSidebar);
  topActions.insertAdjacentElement('afterbegin', sidebarBtn);
  applySidebar();
}

document.getElementById('refreshConversationBtn')?.addEventListener('click', () => {
  refreshSummaries().catch((error: Error) => toast(error.message));
});

const sidebarHead = document.querySelector<HTMLElement>('.sidebar-head');
if (sidebarHead && !document.getElementById('sidebarCollapseBtn')) {
  const collapseBtn = document.createElement('button');
  collapseBtn.id = 'sidebarCollapseBtn';
  collapseBtn.type = 'button';
  collapseBtn.className = 'ghost sidebar-collapse';
  collapseBtn.innerHTML = icon('chevronLeft');
  collapseBtn.addEventListener('click', toggleSidebar);
  sidebarHead.insertAdjacentElement('afterbegin', collapseBtn);
}

const workspace = document.querySelector<HTMLElement>('.workspace');
if (workspace && !document.getElementById('sidebarExpandBtn')) {
  const expandBtn = document.createElement('button');
  expandBtn.id = 'sidebarExpandBtn';
  expandBtn.type = 'button';
  expandBtn.className = 'sidebar-expand';
  expandBtn.innerHTML = icon('chevronRight');
  expandBtn.addEventListener('click', toggleSidebar);
  workspace.insertAdjacentElement('afterbegin', expandBtn);
  applySidebar();
}

// Restore all minimized shell previews button (injected)
const shellTools = document.querySelector<HTMLElement>('.shell-tools');
if (shellTools && !document.querySelector('#restoreAllPreviewsBtn')) {
  const restoreAllBtn = document.createElement('button');
  restoreAllBtn.id = 'restoreAllPreviewsBtn';
  restoreAllBtn.type = 'button';
  restoreAllBtn.title = 'Restore all minimized shell previews from the dock';
  restoreAllBtn.innerHTML = 'Restore all';
  restoreAllBtn.style.display = 'none';
  restoreAllBtn.addEventListener('click', () => {
    const fn = (window as any).restoreAllShellPreviews || (() => {
      const set = (window as any).minimizedPreviews;
      if (set) set.clear();
      document.querySelectorAll<HTMLElement>('[data-shell-card]').forEach(c => c.style.display = '');
      (window as any).renderDock?.();
    });
    fn();
  });
  shellTools.appendChild(restoreAllBtn);
}

// Legend toggle next to the live-time pill — reveals the collapsible "what each button means"
// panel (built lazily by buildLegend, which sits under the shell tabs). On mobile it stays
// collapsed until tapped, so it never crowds the small screen.
if (shellTools && !document.querySelector('#legendToggleBtn')) {
  const legendBtn = document.createElement('button');
  legendBtn.id = 'legendToggleBtn';
  legendBtn.type = 'button';
  legendBtn.title = 'What each button and control does';
  legendBtn.innerHTML = `${icon('help')}<span>Legend</span>`;
  legendBtn.addEventListener('click', () => {
    buildLegend();
    const legend = document.getElementById('legend') as HTMLDetailsElement | null;
    if (!legend) return;
    legend.open = !legend.open;
    legendBtn.classList.toggle('active', legend.open);
    if (legend.open) legend.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  document.getElementById('streamState')?.insertAdjacentElement('afterend', legendBtn);
}

// Rotating keyboard-shortcut tip on its own row above the shell tabs (not inside shell-tools,
// which floats over the tab bar on wide screens and caused overlap with card headers).
const SHELL_TIPS = [
  'Tip: Grid shows shells side-by-side — drag the ⋮⋮ grip to reorder',
  'Tip: g toggles Grid (all shells) vs Focus (one shell)',
  'Tip: r refresh · c density · f follow output',
  'Tip: [ ] cycle shells · ? lists all shortcuts',
  'Tip: unlock shells to Restart / Pull containers',
  'Tip: the Panels button (top bar) shows/hides the side rail',
];
// Live-center: no shell-tab strip / tip bar (conversation sidebar is the list).
document.getElementById('shellTipBar')?.remove();
document.querySelector('.shell-tools .shell-tip')?.remove();
const shellTabsEl = document.getElementById('shellTabs');
if (shellTabsEl) {
  shellTabsEl.innerHTML = '';
  shellTabsEl.hidden = true;
  shellTabsEl.setAttribute('aria-hidden', 'true');
}
// Keep tip strings for potential future use / keyboard help surfaces.
void SHELL_TIPS;

