"use strict";
const initialModel = JSON.parse(document.getElementById('initial-model')?.textContent || '{}');
let currentModel = initialModel;
let latestShells = [];
let latestSummaryText = '';
let summaryLoading = false;
let shellsLoading = false;
let dashboardSettings = {
    tickers: [],
    panels: { machine: true, machineSensors: true, containers: true, remoteHosts: true, ciRuns: false, links: true, tickers: true, expandLists: false },
};
const SHELL_LABEL_ALIASES_KEY = 'sdShellLabelAliases';
const HOST_ALIAS_KEY = 'sdHostAlias';
const BRAND_ICON_KEY = 'sdBrandIcon';
const DEFAULT_BRAND_ICON = '/assets/shelldeck-logo.svg';
const BRAND_ICON_MAX_BYTES = 512 * 1024;
const SHELL_AUTO_TITLES_KEY = 'sdShellAutoTitles';
const SHELL_PREVIEW_CACHE_KEY = 'sdShellPreviewCache';
const HIDDEN_CLOSED_SHELLS_KEY = 'sdHiddenClosedShells';
const SHELL_PREVIEW_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SHELL_AUTO_TITLE_TTL_MS = 2 * 60 * 60 * 1000;
const SHELLBOX_TITLE_WORDS = 3;
const AUTO_FOLLOW_UP_MAX_CHARS = 280;
const autoFollowUpDrafts = {};
const autoFollowUpSentDrafts = {};
// Pull the one-liner for a given session out of the Current Work summary (lines like
// "- main: ...", "main (claude): ...", "**slot1** — ..."), to use as a per-slot title.
function sessionWorkTitle(session) {
    const cached = shellAutoTitles();
    for (const raw of latestSummaryText.split('\n')) {
        const head = raw.trim().replace(/^[\-*•\s]+/, '').replace(/\*\*/g, '');
        // Escape regex metacharacters: tmux/session names can contain them (e.g. with
        // DASHBOARD_SHOW_UNKNOWN_SESSIONS), and an unescaped name throws a SyntaxError that
        // would abort renderShellTabs/applyWorkTitles on every refresh tick.
        const safe = session.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`^${safe}\\b`, 'i').test(head))
            continue;
        const after = head.slice(session.length);
        const sep = after.match(/[:–—]|\s-\s/);
        const text = sep && sep.index !== undefined ? after.slice(sep.index + sep[0].length) : after;
        const title = text.replace(/^[\s:\-–—)]+/, '').trim();
        if (title) {
            cacheShellAutoTitle(session, title, cached);
            return title;
        }
    }
    return cached[session] || '';
}
function sessionWorkBrief(session, words = 10) {
    const title = sessionWorkTitle(session);
    if (!title)
        return '';
    return title.split(/\s+/).filter(Boolean).slice(0, words).join(' ');
}
let shellUnlocked = Boolean(initialModel.unlocked);
let selectedSession = localStorage.getItem('sdSelectedSession') || '';
let pendingImageTarget = '';
const q = (selector) => {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing element: ${selector}`);
    return element;
};
const imageFile = q('#imageFile');
function selectorEscape(value) {
    return CSS.escape(value);
}
function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
