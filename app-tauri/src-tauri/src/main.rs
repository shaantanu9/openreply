// Prevent opening a console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::cli_info,
            commands::list_topics,
            commands::overview_stats,
            commands::recent_activity,
            commands::discover_subs,
            commands::start_collect,
            commands::build_graph,
            commands::export_html,
            commands::get_findings,
            commands::app_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gapmap");
}
