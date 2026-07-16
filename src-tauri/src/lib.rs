// Copyright (c) 2026 Kyhle Öhlinger. Licensed under the MIT License.

mod ai_context;
mod agent_run_log;
mod conversion;
mod menu;
mod search;
mod security;
mod settings;
mod shell;
mod spellcheck;
mod state;
mod types;
mod vault_fs;
mod watcher;

use tauri::Manager;

pub use state::{CurrentVault, WatcherState};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(WatcherState(std::sync::Mutex::new(std::collections::HashMap::new())))
        .manage(CurrentVault(std::sync::Mutex::new(std::collections::HashMap::new())))
        .setup(|app| {
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            if app.get_webview_window("main").is_none() {
                tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                    .title("Metis")
                    .inner_size(1400.0, 900.0)
                    .min_inner_size(580.0, 480.0)
                    .resizable(true)
                    .decorations(true)
                    .on_navigation(shell::allow_in_app_webview_navigation)
                    .build()?;
            }

            Ok(())
        })
        .on_menu_event(menu::handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            shell::pick_folder,
            shell::reveal_in_finder,
            shell::open_url,
            shell::open_vault_window,
            vault_fs::open_vault,
            conversion::convert_vault_to_metis,
            settings::load_personas,
            settings::save_personas,
            settings::load_settings,
            settings::save_settings,
            settings::get_app_version,
            settings::get_planner_storage_dir,
            agent_run_log::load_agent_run_log,
            agent_run_log::append_agent_run_log,
            agent_run_log::clear_agent_run_log,
            ai_context::get_file_summaries,
            ai_context::get_files_content,
            ai_context::get_folder_md_contents,
            vault_fs::save_note,
            vault_fs::get_file_content,
            vault_fs::read_vault_image_base64,
            vault_fs::get_file_contents_batch,
            vault_fs::create_vault,
            vault_fs::create_note,
            vault_fs::create_folder,
            vault_fs::delete_path,
            vault_fs::rename_path,
            vault_fs::move_path,
            vault_fs::save_asset,
            shell::set_vault_default_image_dir,
            shell::copy_files_to_folder,
            shell::pick_save_path,
            shell::write_export_bytes,
            vault_fs::agent_write_note,
            watcher::set_vault_watch,
            search::search_vault,
            search::replace_in_vault,
            spellcheck::check_spelling,
            spellcheck::suggest_spelling,
            spellcheck::list_dictionaries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Metis");
}
