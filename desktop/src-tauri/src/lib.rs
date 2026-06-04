use std::{
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager, State, Url, WebviewWindow,
};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
struct AppState {
    server_url: Mutex<Option<String>>,
    local_app_url: Mutex<Option<Url>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerCheck {
    ok: bool,
    status: Option<u16>,
    final_url: Option<String>,
    message: String,
}

#[tauri::command]
async fn check_server_url(url: String) -> Result<ServerCheck, String> {
    let parsed = parse_server_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("ShellDeck Desktop/0.1")
        .build()
        .map_err(|error| format!("Could not prepare the connection check: {error}"))?;

    let response = match client.head(parsed.clone()).send().await {
        Ok(response) if response.status() != reqwest::StatusCode::METHOD_NOT_ALLOWED => response,
        _ => client
            .get(parsed)
            .send()
            .await
            .map_err(|error| format!("Could not reach the ShellDeck server: {error}"))?,
    };

    let status = response.status();
    let final_url = response.url().to_string();

    if status.as_u16() < 500 {
        return Ok(ServerCheck {
            ok: true,
            status: Some(status.as_u16()),
            final_url: Some(final_url),
            message: "Server is reachable.".to_string(),
        });
    }

    Ok(ServerCheck {
        ok: false,
        status: Some(status.as_u16()),
        final_url: Some(final_url),
        message: format!("The server responded with HTTP {status}."),
    })
}

#[tauri::command]
fn set_server_url(state: State<'_, AppState>, url: Option<String>) -> Result<(), String> {
    let mut server_url = state
        .server_url
        .lock()
        .map_err(|_| "Could not lock the server URL state.".to_string())?;

    *server_url = url.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    });

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                focus_window(&window);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![check_server_url, set_server_url])
        .setup(|app| {
            remember_local_app_url(app);
            build_tray(app)?;
            schedule_update_checks(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ShellDeck desktop");
}

fn build_tray(app: &App) -> tauri::Result<()> {
    let show_hide = MenuItem::with_id(app, "show_hide", "Show/Hide", true, None::<&str>)?;
    let open_browser = MenuItem::with_id(app, "open_browser", "Open in browser", true, None::<&str>)?;
    let check_updates = MenuItem::with_id(app, "check_updates", "Check for updates", true, None::<&str>)?;
    let switch_server = MenuItem::with_id(app, "switch_server", "Switch server", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_hide,
            &open_browser,
            &check_updates,
            &switch_server,
            &separator,
            &quit,
        ],
    )?;

    TrayIconBuilder::new()
        .tooltip("ShellDeck")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show_hide" => toggle_window(app),
            "open_browser" => open_server_in_browser(app),
            "check_updates" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    check_for_updates(app, true).await;
                });
            }
            "switch_server" => switch_server(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn remember_local_app_url(app: &App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(url) = window.url() else {
        return;
    };
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut local_app_url) = state.local_app_url.lock() {
            *local_app_url = Some(url);
        }
    }
}

fn schedule_update_checks(app: AppHandle) {
    let first_check = app.clone();
    tauri::async_runtime::spawn(async move {
        check_for_updates(first_check, false).await;
    });

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
            check_for_updates(app.clone(), false).await;
        }
    });
}

async fn check_for_updates(app: AppHandle, manual: bool) {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            emit_update_status(&app, format!("Updater is not available: {error}"), manual);
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            emit_update_status(&app, "Installing a ShellDeck update...".to_string(), true);
            let mut downloaded = 0;
            let result = update
                .download_and_install(
                    |chunk_length, content_length| {
                        downloaded += chunk_length;
                        if let Some(content_length) = content_length {
                            let _ = app.emit(
                                "updater-status",
                                format!("Downloaded {downloaded} of {content_length} bytes."),
                            );
                        }
                    },
                    || {
                        let _ = app.emit("updater-status", "Update download finished.");
                    },
                )
                .await;

            match result {
                Ok(_) => {
                    let _ = app.emit("updater-status", "Update installed. Relaunching ShellDeck.");
                    app.restart();
                }
                Err(error) => {
                    emit_update_status(&app, format!("Could not install the update: {error}"), true);
                }
            }
        }
        Ok(None) => emit_update_status(&app, "ShellDeck is up to date.".to_string(), manual),
        Err(error) => emit_update_status(&app, format!("Could not check for updates: {error}"), manual),
    }
}

fn emit_update_status(app: &AppHandle, message: String, should_emit: bool) {
    if should_emit {
        let _ = app.emit("updater-status", message);
    }
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => focus_window(&window),
    }
}

fn open_server_in_browser(app: &AppHandle) {
    if let Some(url) = current_server_url(app) {
        let _ = open::that(url);
    }
}

fn switch_server(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Some(mut url) = local_app_url(app) else {
        focus_window(&window);
        return;
    };

    url.set_query(Some("settings=1"));
    let _ = window.navigate(url);
    focus_window(&window);
}

fn current_server_url(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<AppState>()?;
    let server_url = state.server_url.lock().ok()?.clone();
    if server_url.is_some() {
        return server_url;
    }

    app.get_webview_window("main")
        .and_then(|window| window.url().ok())
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.to_string())
}

fn local_app_url(app: &AppHandle) -> Option<Url> {
    app.try_state::<AppState>()?
        .local_app_url
        .lock()
        .ok()?
        .clone()
}

fn focus_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn parse_server_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value.trim()).map_err(|error| format!("Invalid server URL: {error}"))?;

    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        _ => Err("Server URL must start with http:// or https://.".to_string()),
    }
}

