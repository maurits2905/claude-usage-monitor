#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod monitor;
mod shim;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt as AutostartExt;

#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, on_top: bool) -> Result<(), String> {
    window.set_always_on_top(on_top).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_autostart(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") {
        return Err("only GitHub URLs are allowed".into());
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn main() {
    // Shim mode: Claude Code invokes `halo --shim` for every statusline
    // refresh. Never start the GUI on that path.
    if std::env::args().any(|a| a == "--shim") {
        shim::run();
        return;
    }

    let start_hidden = std::env::args().any(|a| a == "--hidden");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .invoke_handler(tauri::generate_handler![
            monitor::get_status,
            monitor::install_shim,
            monitor::restore_shim,
            set_always_on_top,
            set_autostart,
            get_autostart,
            open_url,
            hide_window,
            quit_app,
        ])
        .setup(move |app| {
            let show = MenuItemBuilder::with_id("toggle", "Show / Hide").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Halo").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            TrayIconBuilder::with_id("halo-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Halo - Claude usage")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon() {
                    window.set_icon(icon.clone())?;
                }
            
                if start_hidden {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the widget hides it to the tray; Quit lives in the tray menu.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Halo");
}
