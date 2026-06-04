use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};

// ── Native application menu ───────────────────────────────────────────────────

/// Build the full native menu for the application window.
///
/// Custom items emit a `menu-event` Tauri event with a string payload so the
/// frontend hook can handle them without any extra IPC round-trips.
/// Predefined items (Undo, Copy, Minimize, etc.) are handled natively by the
/// OS / webview and do not need frontend wiring.
pub fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // ── macOS: app-name menu (always the first menu on macOS) ─────────────────
    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "Metis")
        .item(&PredefinedMenuItem::about(
            app,
            None,
            Some(AboutMetadata {
                name: Some("Metis".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                short_version: None,
                authors: Some(vec!["Kyhle Öhlinger".into()]),
                comments: Some("A local-first, AI-augmented personal knowledge ecosystem.".into()),
                copyright: Some("© 2026 Kyhle Öhlinger".into()),
                license: Some("MIT".into()),
                website: Some("https://ohlinger.co".into()),
                website_label: Some("ohlinger.co".into()),
                credits: None,
                icon: None,
            }),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    // ── File ──────────────────────────────────────────────────────────────────
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_note", "New Note")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new_folder", "New Folder")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open_vault", "Open Vault…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new_vault", "New Vault…")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("daily_note", "Open Daily Note")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("reveal_in_finder", "Reveal in Finder")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // ── Edit ──────────────────────────────────────────────────────────────────
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // ── View ──────────────────────────────────────────────────────────────────
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+\\")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_panel", "Toggle Panel")
                .accelerator("CmdOrCtrl+Shift+\\")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("source_mode", "Source Mode")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("visual_mode", "Visual Mode")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // ── Window ────────────────────────────────────────────────────────────────
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;

    // ── Help ──────────────────────────────────────────────────────────────────
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(
            &MenuItemBuilder::with_id("open_docs", "Metis Documentation")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open_github", "GitHub — Kyhle Öhlinger")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_website", "Website — ohlinger.co")
                .build(app)?,
        )
        .build()?;

    // Assemble — macOS prepends the app-name menu automatically
    #[cfg(target_os = "macos")]
    return MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build();

    #[cfg(not(target_os = "macos"))]
    MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

/// Handle custom menu item clicks (predefined items are OS-native).
pub fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    match id {
        "open_github" => {
            let _ = open::that("https://github.com/kyhleOhlinger");
            return;
        }
        "open_website" => {
            let _ = open::that("https://ohlinger.co");
            return;
        }
        "open_docs" => {
            if let Some(win) = app.get_webview_window("metis-help") {
                let _ = win.set_focus();
            } else {
                let _ = tauri::WebviewWindowBuilder::new(
                    app,
                    "metis-help",
                    tauri::WebviewUrl::App("help.html".into()),
                )
                .title("Metis — Help")
                .inner_size(960.0, 720.0)
                .min_inner_size(600.0, 480.0)
                .resizable(true)
                .build();
            }
            return;
        }
        _ => {}
    }

    let action = match id {
        "new_note" => Some("new-note"),
        "new_folder" => Some("new-folder"),
        "open_vault" => Some("open-vault"),
        "new_vault" => Some("new-vault"),
        "save" => Some("save"),
        "daily_note" => Some("daily-note"),
        "reveal_in_finder" => Some("reveal-in-finder"),
        "toggle_sidebar" => Some("toggle-sidebar"),
        "toggle_panel" => Some("toggle-panel"),
        "source_mode" => Some("source-mode"),
        "visual_mode" => Some("visual-mode"),
        _ => None,
    };
    if let Some(action) = action {
        let _ = app.emit("menu-event", action);
    }
}
