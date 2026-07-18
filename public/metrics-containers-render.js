"use strict";
function renderContainers(containers) {
    const list = document.getElementById('containerList');
    if (!list)
        return;
    if (!containers.length) {
        list.innerHTML = '<div class="muted container-empty">No containers</div>';
        applyContainerPrivacy('local');
        return;
    }
    const summary = `<div class="container-health">${escapeHtml(containerOverview(containers))}</div>`;
    list.innerHTML = summary + containers.map((c) => containerRowHtml(c)).join('');
    applyContainerPrivacy('local');
}
