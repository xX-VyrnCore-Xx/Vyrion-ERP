//! The system tray icon (Windows): the app can stay in the background when its window is
//! closed, and the tray menu offers quick actions and a real "quit" that ends the process.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

/// The front end listens for these (see `src/app/tray.ts`).
pub const EVENT_NAVIGATE: &str = "tray-navigate";
pub const EVENT_SYNC: &str = "tray-sync";

/// The tray is only built where the app ships with one.
pub fn supported() -> bool {
    cfg!(windows)
}

/// Brings the main window back from the tray or from behind other windows.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Ends the application for good. The database is flushed first so the next start finds
/// everything in the main file and nothing waits in the write-ahead log.
pub fn quit(app: &AppHandle) {
    flush_database(app);
    // Close the tray icon and every window so nothing keeps the process alive.
    let _ = app.remove_tray_by_id("main");
    for (_, window) in app.webview_windows() {
        let _ = window.destroy();
    }
    terminate_process_tree();
    // Fallback (other systems, or if the helper could not run).
    app.exit(0);
    std::process::exit(0);
}

/// Windows: ends this process together with every child (the WebView2 helper processes
/// can outlive a plain exit and show up in the task manager). Returns only if it failed.
fn terminate_process_tree() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &std::process::id().to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

pub fn flush_database(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state.db.checkpoint();
    }
}

fn go(app: &AppHandle, route: &str) {
    show_main_window(app);
    let _ = app.emit(EVENT_NAVIGATE, route.to_string());
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("open", "Apri Vyrion ERP")?,
            &PredefinedMenuItem::separator(app)?,
            &item("overview", "Panoramica e avvisi")?,
            &item("new-invoice", "Nuova fattura")?,
            &item("new-party", "Nuova anagrafica")?,
            &item("sync", "Sincronizza ora")?,
            &item("settings", "Impostazioni, dati e backup")?,
            &PredefinedMenuItem::separator(app)?,
            &item("hide", "Nascondi nella barra")?,
            &item("quit", "Esci definitivamente")?,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Vyrion ERP")
        .menu(&menu)
        // A left click brings the window back; the menu is on the right click.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "overview" => go(app, ""),
            "new-invoice" => go(app, "d/invoice/new"),
            "new-party" => go(app, "e/party/new"),
            "settings" => go(app, "settings"),
            "sync" => {
                show_main_window(app);
                let _ = app.emit(EVENT_SYNC, ());
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
