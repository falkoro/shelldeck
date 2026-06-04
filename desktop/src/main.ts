import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SERVER_URL_STORAGE_KEY } from "./config";
import "./styles.css";

type ServerCheck = {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  message: string;
};

const appRoot = document.querySelector<HTMLElement>("#app");

if (!appRoot) {
  throw new Error("Missing app root");
}

const app: HTMLElement = appRoot;
let lastUpdateMessage = "";

if (isTauriRuntime()) {
  void listen<string>("updater-status", (event) => {
    lastUpdateMessage = event.payload;
    const status = document.querySelector<HTMLElement>("[data-update-status]");
    if (status) status.textContent = lastUpdateMessage;
  });
}

start();

function start() {
  const params = new URLSearchParams(window.location.search);
  const savedUrl = readSavedUrl();

  if (params.has("settings") || !savedUrl) {
    renderSettings(savedUrl);
    return;
  }

  void connectToServer(savedUrl);
}

async function connectToServer(serverUrl: string) {
  renderConnecting(serverUrl);
  await setNativeServerUrl(serverUrl);

  const check = await checkServer(serverUrl);
  if (!check.ok) {
    renderConnectionError(serverUrl, check.message);
    return;
  }

  window.location.replace(check.finalUrl ?? serverUrl);
}

function renderSettings(currentUrl: string | null, message = "") {
  app.innerHTML = `
    <section class="panel">
      <p class="eyebrow">ShellDeck Desktop</p>
      <h1>Connect to your ShellDeck server</h1>
      <p class="copy">Enter the server URL where ShellDeck is already running. The desktop app uses that web UI and keeps the server-side login flow intact.</p>
      <form class="form" data-server-form>
        <label for="server-url">Server URL</label>
        <div class="field-row">
          <input id="server-url" name="server-url" type="url" autocomplete="url" placeholder="https://code.falkinator.org" value="${escapeHtml(currentUrl ?? "")}" required />
          <button type="submit">Save</button>
        </div>
      </form>
      <p class="hint">The URL is checked before it is saved. Cookies are stored by the desktop webview after the server login opens.</p>
      <p class="status" data-status>${escapeHtml(message || lastUpdateMessage)}</p>
    </section>
  `;

  const form = app.querySelector<HTMLFormElement>("[data-server-form]");
  const input = app.querySelector<HTMLInputElement>("#server-url");
  const status = app.querySelector<HTMLElement>("[data-status]");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input || !status) return;

    const normalized = normalizeServerUrl(input.value);
    if (!normalized) {
      status.textContent = "Enter a valid http or https URL.";
      return;
    }

    status.textContent = "Checking server...";
    const check = await checkServer(normalized);

    if (!check.ok) {
      status.textContent = check.message;
      return;
    }

    localStorage.setItem(SERVER_URL_STORAGE_KEY, normalized);
    await setNativeServerUrl(normalized);
    window.location.replace(check.finalUrl ?? normalized);
  });
}

function renderConnecting(serverUrl: string) {
  app.innerHTML = `
    <section class="panel panel-compact">
      <p class="eyebrow">ShellDeck Desktop</p>
      <h1>Opening ShellDeck</h1>
      <p class="copy">Checking ${escapeHtml(serverUrl)} before loading the dashboard.</p>
      <p class="status" data-update-status>${escapeHtml(lastUpdateMessage)}</p>
    </section>
  `;
}

function renderConnectionError(serverUrl: string, message: string) {
  app.innerHTML = `
    <section class="panel">
      <p class="eyebrow">Connection</p>
      <h1>ShellDeck is not reachable</h1>
      <p class="copy">${escapeHtml(message)}</p>
      <p class="server-pill">${escapeHtml(serverUrl)}</p>
      <div class="actions">
        <button type="button" data-retry>Retry</button>
        <button type="button" class="secondary" data-edit>Edit server URL</button>
      </div>
      <p class="hint">If the server moved, update the URL. If it is starting up, retry once it is online.</p>
      <p class="status" data-update-status>${escapeHtml(lastUpdateMessage)}</p>
    </section>
  `;

  app.querySelector("[data-retry]")?.addEventListener("click", () => {
    void connectToServer(serverUrl);
  });

  app.querySelector("[data-edit]")?.addEventListener("click", () => {
    renderSettings(serverUrl);
  });
}

async function checkServer(serverUrl: string): Promise<ServerCheck> {
  if (!isTauriRuntime()) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      message: "Run this screen inside ShellDeck Desktop to validate and save a server URL."
    };
  }

  try {
    return await invoke<ServerCheck>("check_server_url", { url: serverUrl });
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function setNativeServerUrl(serverUrl: string | null) {
  if (!isTauriRuntime()) return;
  await invoke("set_server_url", { url: serverUrl });
}

function readSavedUrl() {
  return normalizeServerUrl(localStorage.getItem(SERVER_URL_STORAGE_KEY) ?? "");
}

function normalizeServerUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char] ?? char;
  });
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}
