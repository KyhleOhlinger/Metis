// Copyright (c) 2026 Kyhle Öhlinger. Licensed under the MIT License.

mod ai_context;
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
            settings::get_planner_storage_dir,
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
