// Prevent opening a console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;
mod db;
mod schedule;
mod worker;

use cli::{
    cancel_active_chat, cancel_active_job, cancel_active_stream,
    ActiveChat, ActiveChatPid, ActiveCollects, ActiveGraphOps, ActiveJob, ActiveJobPid,
    ActiveStream, ActiveStreamPid,
};
use std::sync::Arc;
use tauri::RunEvent;
use worker::ExtractionWorker;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ActiveJob::default())
        .manage(ActiveChat::default())
        .manage(ActiveJobPid::default())
        .manage(ActiveChatPid::default())
        .manage(ActiveStream::default())
        .manage(ActiveStreamPid::default())
        .manage(ActiveGraphOps::default())
        .manage(ActiveCollects::default())
        .manage(Arc::new(ExtractionWorker::default()))
        .invoke_handler(tauri::generate_handler![
            commands::cli_info,
            commands::list_topics,
            commands::active_collects,
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
            commands::health_check,
            commands::open_url,
            commands::byok_status,
            commands::byok_set,
            commands::run_query,
            commands::start_chat,
            commands::cancel_chat,
            commands::chat_status,
            commands::test_llm,
            commands::list_ollama_models,
            commands::list_provider_models,
            commands::synthesize_insights,
            commands::synthesize_insights_chunked,
            commands::run_gap_discovery,
            commands::list_experiments,
            commands::persona_view,
            commands::hypothesis_create,
            commands::hypothesis_update_status,
            commands::hypothesis_list,
            commands::hypothesis_delete,
            commands::hypothesis_stats,
            commands::monitor_run_topic,
            commands::monitor_tick,
            commands::monitor_deltas,
            commands::top_opportunities,
            commands::search_findings_global,
            commands::related_topics_for,
            commands::export_brief,
            commands::competitor_matrix,
            commands::link_research,
            commands::research_links,
            commands::run_solutions_pipeline,
            commands::run_temporal_gaps,
            commands::run_sentiment_by_source,
            commands::run_concepts,
            // Paper research (Papers tab, BibTeX/RIS export, Unpaywall OA lookup)
            commands::papers_list,
            commands::papers_export,
            commands::oa_lookup,
            // Intent layer (per-topic deliverable routing)
            commands::list_intents,
            commands::topic_intent_get,
            commands::topic_intent_set,
            commands::quick_extract_gaps,
            commands::run_reddit_search,
            commands::start_stream,
            commands::cancel_stream,
            commands::stream_status,
            commands::ollama_start_service,
            commands::ollama_stop_service,
            commands::close_splash,
            commands::db_mtime,
            commands::semantic_search,
            commands::related_posts,
            commands::reindex_palace,
            commands::palace_stats,
            commands::palace_model_status,
            commands::palace_warmup,
            commands::diff_findings,
            commands::analyze_paper,
            commands::analyze_papers_bulk,
            commands::paper_analyses_get,
            commands::schedule_install,
            commands::schedule_uninstall,
            commands::schedule_status,
            commands::schedule_enable_topic,
            commands::schedule_mark_seen,
            commands::clean_corpus,
            commands::merge_duplicate_topics,
            commands::find_existing_topic,
            commands::restore_topic,
            commands::list_trash,
            commands::purge_deleted_topics,
            // Dual-Mode Pivot — Product Mode
            commands::product_create,
            commands::product_list,
            commands::product_get,
            commands::product_update,
            commands::product_add_competitor,
            commands::product_remove_competitor,
            commands::product_delete,
            commands::product_sweep,
            commands::product_signals,
            commands::product_signal_action,
            commands::product_digest,
            commands::product_dashboard,
            commands::product_convert_topic,
            // MCP ↔ App integration (one-click connect to any MCP client)
            commands::mcp_clients,
            commands::mcp_status,
            commands::mcp_install,
            commands::mcp_uninstall,
            // ── AG-C: global-competitors (T2.5) + finding feedback (T2.4) ──
            commands::global_competitors,
            commands::feedback_record,
            // ── AG-E: prompt overrides (T3.7) ──────────────────────────
            commands::prompt_list,
            commands::prompt_get,
            commands::prompt_set,
            commands::prompt_clear,
            // ── AG-E: saved views (T3.1) ───────────────────────────────
            commands::saved_views,
            commands::saved_view_create,
            commands::saved_view_update,
            commands::saved_view_delete,
            // ── AG-D: CSV ingest ───────────────────────────────────────
            commands::ingest_csv_file,
            // ── Incremental enrichment: extraction worker supervisor ──
            worker::start_extraction_worker,
            worker::stop_extraction_worker,
            worker::extraction_worker_status,
            worker::mark_topic_active,
            worker::enqueue_extraction,
        ])
        .build(tauri::generate_context!())
        .expect("error while building gapmap");

    // On app exit (window closed, Cmd-Q, process signal), terminate every
    // tracked Python child so we don't orphan collect/chat/stream processes.
    // This fires for BOTH paths:
    //   - prod (PyInstaller sidecar, CommandChild::kill)
    //   - dev  (raw tokio pid → SIGTERM)
    // Without this the user's Activity Monitor fills up with zombie
    // `reddit-cli` / `python -m reddit_research.cli.main` processes every
    // time they quit mid-collect, and the fetches table keeps an
    // `ended_at=NULL` row that the UI reads as "still running".
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            let _ = cancel_active_job(app_handle);
            let _ = cancel_active_chat(app_handle);
            let _ = cancel_active_stream(app_handle);
            // Extraction worker has its own state slot (not ActiveJob) so it's
            // NOT reaped by cancel_active_job. Fire SIGTERM explicitly so the
            // long-lived Python process exits cleanly instead of being
            // orphaned and re-summoned on next boot as a zombie.
            worker::stop_worker_blocking(app_handle);
        }
    });
}
