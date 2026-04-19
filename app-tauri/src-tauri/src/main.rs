// Prevent opening a console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;

use cli::{ActiveChat, ActiveChatPid, ActiveJob, ActiveJobPid};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ActiveJob::default())
        .manage(ActiveChat::default())
        .manage(ActiveJobPid::default())
        .manage(ActiveChatPid::default())
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
            commands::enrich_graph,
            commands::export_html,
            commands::export_graph_json,
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
            commands::run_query,
            commands::start_chat,
            commands::cancel_chat,
            commands::chat_status,
            commands::test_llm,
            commands::list_ollama_models,
            commands::run_solutions_pipeline,
            commands::run_temporal_gaps,
            commands::quick_extract_gaps,
            commands::ollama_start_service,
            commands::ollama_stop_service,
            commands::close_splash,
            commands::db_mtime,
        ])
        .run(tauri::generate_context!())
        .expect("error while running gapmap");
}
