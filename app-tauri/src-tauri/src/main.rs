// Prevent opening a console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;

use cli::ActiveJob;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ActiveJob::default())
        .invoke_handler(tauri::generate_handler![
            commands::cli_info,
            commands::list_topics,
            commands::overview_stats,
            commands::recent_activity,
            commands::discover_subs,
            commands::start_collect,
            commands::cancel_collect,
            commands::collect_status,
            commands::build_graph,
            commands::export_html,
            commands::export_report_pro,
            commands::get_findings,
            commands::ingest_file,
            commands::list_exports,
            commands::delete_topic,
            commands::reveal_in_finder,
            commands::app_data_dir,
            commands::open_url,
            commands::byok_status,
            commands::byok_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gapmap");
}
