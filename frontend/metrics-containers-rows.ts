function containerRowHtml(c: ContainerInfo, extraClass = '', host = ''): string {
  const chips = containerStatChipsHtml(c);
  const statsHtml = chips ? `<div class="ci-stats">${chips}</div>` : '';
  const age = containerAge(c);
  const ageHtml = age ? `<span class="container-age" title="${escapeHtml(c.status)}">${escapeHtml(age)}</span>` : '';
  const desc = containerDescription(c);
  const descHtml = desc
    ? `<div class="ci-desc" data-edit-desc="${escapeHtml(c.name)}" title="${escapeHtml(desc)} — click to edit">${escapeHtml(desc)}</div>`
    : `<div class="ci-desc ci-desc-empty" data-edit-desc="${escapeHtml(c.name)}" title="Add a description">+ description</div>`;
  return `<div class="container-item ${extraClass} state-${containerState(c.status, c.alert)}">`
    + `<div class="ci-row1"><b>${escapeHtml(c.name)}</b><small class="ci-engine">${escapeHtml(c.engine)}</small>${containerActionsHtml(c, host)}</div>`
    + `<div class="ci-image-line"><div class="ci-image" title="${escapeHtml(c.image)}">${escapeHtml(c.image)}</div>${containerVersionBadgeHtml(c)}</div>`
    + descHtml
    + containerAlertHtml(c)
    + containerBuiltHtml(c)
    + `<div class="ci-row2"><em>${escapeHtml(c.status)}</em>${ageHtml}</div>`
    + statsHtml + `</div>`;
}

// Denser 2-line row for the remote host cards: status dot + name + cpu/mem on top, image + age
// below. Full status lives in the dot/age tooltips. Keeps long lists short and tidy.
function compactContainerRowHtml(c: ContainerInfo, host: string): string {
  const state = containerState(c.status, c.alert);
  const age = containerAge(c);
  // Same CPU/mem pills as the local panel (intensity bar + %-of-limit), kept on one line.
  const chips = containerStatChipsHtml(c);
  const rightHtml = chips ? `<span class="ci-cpu">${chips}</span>` : '';
  const badge = age || c.status.split(/[\s(]/)[0];
  const badgeHtml = badge ? `<span class="container-age" title="${escapeHtml(c.status)}">${escapeHtml(badge)}</span>` : '';
  // Line 2 shows the description when there is one (image to the tooltip), else the image.
  // Compact remote rows are passive except for their explicit action buttons.
  const desc = containerDescription(c);
  const subText = desc || c.image;
  const subTitle = desc ? `${desc}\n${c.image}` : c.image;
  const subClass = desc ? 'ci-image has-desc' : 'ci-image';
  const versionHtml = containerVersionBadgeHtml(c);
  const badges = versionHtml || badgeHtml ? `<span class="ci-badges">${versionHtml}${badgeHtml}</span>` : '';
  const builtHtml = containerBuiltHtml(c);
  return `<div class="container-item remote-container compact state-${state}">`
    + `<div class="ci-top"><span class="ci-dot" title="${escapeHtml(c.status)}"></span><b>${escapeHtml(c.name)}</b>${rightHtml}${containerActionsHtml(c, host)}</div>`
    + `<div class="ci-bot"><span class="${subClass}" title="${escapeHtml(subTitle)}">${escapeHtml(subText)}</span>${badges}</div>`
    + containerAlertHtml(c)
    + builtHtml
    + `</div>`;
}

const SENSOR_LABEL_ALIASES_KEY = 'sdSensorLabelAliases';
let latestMachineMetrics: MachineMetrics | null = null;
let remoteHostsLoaded = false;
let remoteHostsLoading = false;
let ghRunsLoaded = false;
let ghRunsLoading = false;
type ContainerPrivacyScope = 'local' | 'remote';
const CONTAINER_PRIVACY_KEY = 'sdContainerPrivacy';

