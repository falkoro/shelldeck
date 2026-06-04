const SITE_CONFIG = {
  marketingDomain: "shelldeck.app",
  browserUrl: "https://code.falkinator.org",
  downloads: {
    windows: {
      label: "Download for Windows",
      manifest: "https://dl.shelldeck.app/desktop/windows/x86_64/latest.json",
      platform: "windows-x86_64"
    },
    linux: {
      label: "Download for Linux",
      manifest: "https://dl.shelldeck.app/desktop/linux/x86_64/latest.json",
      platform: "linux-x86_64"
    }
  }
};

const status = document.querySelector("[data-download-status]");
const buttons = Array.from(document.querySelectorAll("[data-download]"));
const localPreviewHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const forceRemoteDownloads = new URLSearchParams(window.location.search).has("loadDownloads");

for (const link of document.querySelectorAll("[data-browser-link]")) {
  link.href = SITE_CONFIG.browserUrl;
}

if (localPreviewHosts.has(window.location.hostname) && !forceRemoteDownloads) {
  showLocalPreviewDownloads();
} else {
  void loadDownloads();
}

async function loadDownloads() {
  const results = await Promise.allSettled(
    buttons.map(async (button) => {
      const key = button.dataset.download;
      const config = key ? SITE_CONFIG.downloads[key] : null;
      if (!config) return null;

      const response = await fetch(config.manifest, { cache: "no-store" });
      if (!response.ok) throw new Error(`${config.label} manifest returned HTTP ${response.status}`);

      const manifest = await response.json();
      const artifact = manifest.platforms?.[config.platform];
      if (!artifact?.url) throw new Error(`${config.label} manifest has no installer URL`);

      button.href = artifact.url;
      button.textContent = `${config.label} ${manifest.version}`;
      button.removeAttribute("aria-disabled");
      return manifest.version;
    })
  );

  const versions = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);

  if (!status) return;

  if (versions.length > 0) {
    status.textContent = `Current desktop release: ${versions[0]}.`;
    return;
  }

  status.textContent = "Downloads will appear here after the first desktop release is published.";
}

function showLocalPreviewDownloads() {
  for (const button of buttons) {
    const key = button.dataset.download;
    const config = key ? SITE_CONFIG.downloads[key] : null;
    if (config) button.textContent = config.label;
  }

  if (status) {
    status.textContent = "Download manifests load from dl.shelldeck.app after the site is published.";
  }
}

console.info(`ShellDeck landing domain: ${SITE_CONFIG.marketingDomain}`);
