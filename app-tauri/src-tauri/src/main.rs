// Prevent opening a console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;
mod db;
mod schedule;
mod worker;

use cli::{
    cancel_active_chat, cancel_active_job, cancel_active_stream,
    ActiveChat, ActiveChatPid, ActiveCollects, ActiveEnrich, ActiveEnrichPid, ActiveGraphOps,
    ActiveJob, ActiveJobPid, ActiveStream, ActiveStreamPid, CollectQueue,
};
use std::sync::Arc;
use tauri::RunEvent;
use worker::ExtractionWorker;

fn load_runtime_env_files() {
    // Keep process env highest priority; dotenv files only fill missing keys.
    //
    // Search order:
    //   1) current dir .env
    //   2) parent dirs .env (up to 5 levels; catches app-tauri/.env in dev)
    //   3) ~/.config/reddit-myind/.env (same path BYOK writes to)
    let mut dir = std::env::current_dir().ok();
    let mut depth = 0usize;
    while let Some(d) = dir {
        let p = d.join(".env");
        let _ = dotenvy::from_path(&p);
        if depth >= 5 {
            break;
        }
        dir = d.parent().map(|x| x.to_path_buf());
        depth += 1;
    }
    if let Ok(home) = std::env::var("HOME") {
        let user_env = std::path::PathBuf::from(home)
            .join(".config")
            .join("reddit-myind")
            .join(".env");
        let _ = dotenvy::from_path(user_env);
    }
}

fn main() {
    load_runtime_env_files();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ActiveJob::default())
        .manage(ActiveChat::default())
        .manage(ActiveJobPid::default())
        .manage(ActiveChatPid::default())
        .manage(ActiveStream::default())
        .manage(ActiveStreamPid::default())
        .manage(ActiveEnrich::default())
        .manage(ActiveEnrichPid::default())
        .manage(ActiveGraphOps::default())
        .manage(ActiveCollects::default())
        .manage(CollectQueue::default())
        .manage(Arc::new(ExtractionWorker::default()))
        .setup(|app| {
            // Splash safety net + cold-boot webview heal.
            //
            // Two separate failure modes this guards against:
            //   1. The frontend never calls `close_splash` (throw during
            //      early boot, HMR disconnect, missing command registration
            //      after refactor). Splash stays on top forever with no way
            //      to reach the main window.
            //   2. The webview's initial URL load raced vite's startup and
            //      lost — the main window is created but displays a blank
            //      frame because the initial navigation to `devUrl` 404'd
            //      before vite bound the port. This is particularly easy
            //      to hit in dev with file-watcher-triggered rebuilds: a
            //      fresh binary launches while the old vite is mid-restart.
            //
            // For (1): force-close the splash + show the main window at T+6 s.
            // For (2): if we're still invisible OR known-blank after T+6 s,
            //   reload the main webview. Vite is definitely up by then
            //   (Next.js check: 200 on `/` within ~1 s of vite boot).
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(6)).await;
                    use tauri::Manager;
                    if let Some(splash) = app_handle.get_webview_window("splash") {
                        let _ = splash.close();
                    }
                    if let Some(main) = app_handle.get_webview_window("main") {
                        let was_hidden = !main.is_visible().unwrap_or(false);
                        if was_hidden {
                            let _ = main.show();
                            let _ = main.set_focus();
                        }
                        // Re-navigate the webview to the dev/dist URL. In dev
                        // this re-hits vite; in release it re-loads `index.html`
                        // from the bundle. Idempotent: if the page was
                        // already showing content, this just reruns main.js
                        // which is already idempotent via the route gen guard.
                        let _ = main.eval("if(!document.querySelector('.app *')){location.reload();}");
                    }
                });
            }

            // Open devtools for the main window on debug builds so any
            // JavaScript module-load failure is visible immediately instead
            // of silently leaving a blank webview. No-op in release.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(main) = app.get_webview_window("main") {
                    main.open_devtools();
                }
            }

            // Auto-start the extraction worker on boot IFF any topic already
            // has ≥ ENRICH_THRESHOLD posts. This gates Phase-B (async
            // findings extraction) on having enough signal. On fresh
            // installs the worker stays asleep until a collect crosses the
            // threshold; main.js re-triggers the start via
            // `api.startExtractionWorker()` on `gapmap:changed` kind=collect.
            //
            // Dispatched on `async_runtime::spawn` so a slow disk / locked
            // DB never stalls `setup()` — boot is non-blocking.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Resolve the DB path using the same helper Rust commands use
                // so we hit the exact file the Python sidecar writes.
                let dir = match crate::cli::data_dir(&app_handle) {
                    Ok(d) => d,
                    Err(_) => return,
                };
                let db_path = dir.join("reddit.db");
                if !db_path.exists() {
                    return;
                }
                // Native rusqlite — avoids spawning a sidecar just to count.
                // tokio::task::spawn_blocking because rusqlite is synchronous.
                let db_path_clone = db_path.clone();
                let max_count = tokio::task::spawn_blocking(move || {
                    crate::db::query_db(
                        &db_path_clone,
                        "SELECT COALESCE(MAX(c), 0) AS m FROM \
                         (SELECT count(*) AS c FROM topic_posts GROUP BY topic)",
                        None,
                    )
                })
                .await
                .ok()
                .and_then(|r| r.ok())
                .and_then(|rows| {
                    rows.first()
                        .and_then(|v| v.get("m").and_then(|m| m.as_u64()))
                })
                .unwrap_or(0);

                if max_count >= worker::ENRICH_THRESHOLD {
                    // start_worker is idempotent, so if another boot path
                    // raced ahead we'll just return Ok(()).
                    let _ = worker::start_worker(app_handle.clone()).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cli_info,
            commands::list_topics,
            commands::active_collects,
            commands::overview_stats,
            commands::recent_activity,
            commands::topic_graph_summary,
            commands::discover_subs,
            commands::canonicalize_topic,
            commands::start_collect,
            commands::cancel_collect,
            commands::collect_status,
            commands::list_collect_queue,
            commands::cancel_queued_collect,
            commands::collect_source_catalog,
            commands::build_graph,
            commands::enrich_graph,
            commands::enrich_graph_stream,
            commands::relate_graph,
            commands::clear_graph_inflight,
            commands::mem_stats,
            commands::export_html,
            commands::export_graph_json,
            commands::export_report_pro,
            commands::get_findings,
            commands::ingest_file,
            commands::ingest_folder,
            commands::list_exports,
            commands::export_prefs_get,
            commands::export_prefs_set,
            commands::delete_topic,
            commands::reveal_in_finder,
            commands::app_data_dir,
            commands::health_check,
            commands::open_url,
            commands::byok_status,
            commands::byok_set,
            commands::device_signature,
            commands::license_status,
            commands::license_activate,
            commands::license_server_check,
            commands::license_default_api_base,
            commands::license_logout,
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
            commands::paper_outline_generate,
            commands::paper_draft_generate,
            commands::experiment_plan_generate,
            commands::paper_export_with_citations,
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
            commands::paper_pdf_fetch,
            // Intent layer (per-topic deliverable routing)
            commands::list_intents,
            commands::topic_intent_get,
            commands::topic_intent_set,
            commands::quick_extract_gaps,
            commands::search_all,
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
            commands::palace_reindex,
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
            // Lifecycle pivot — Stage-Gate verdict + Kano categorization
            commands::product_gate_set,
            commands::product_gate_get,
            commands::run_kano_categorize,
            // Discovery framework expansion (2026-05-01_04) — OST + RICE +
            // MoSCoW + Empathy Maps + Four Risks + Value Curve.
            commands::ost_build,
            commands::ost_set_outcome,
            commands::ost_experiment_create,
            commands::ost_experiments_list,
            commands::ost_experiment_update,
            commands::ost_experiment_delete,
            commands::run_rice_score,
            commands::rice_set,
            commands::run_moscow_categorize,
            commands::run_empathy_build,
            commands::empathy_get,
            commands::empathy_list,
            commands::four_risks_get,
            commands::four_risks_set,
            commands::value_curve_get,
            commands::value_curve_set,
            // Discovery framework expansion v2 (2026-05-01_05) — TAM/SAM/SOM,
            // Porter's Five Forces, 2x2 positioning map, cost model,
            // customer interviews (Mom Test), Sean Ellis PMF survey,
            // Van Westendorp / NPS / MaxDiff, PERT estimation, PRD export.
            commands::tam_sam_som_get,
            commands::tam_sam_som_set,
            commands::porter_get,
            commands::porter_set,
            commands::positioning_get,
            commands::positioning_set,
            commands::cost_model_get,
            commands::cost_model_set,
            commands::interview_create,
            commands::interview_update,
            commands::interview_delete,
            commands::interview_get,
            commands::interview_list,
            commands::interview_summary,
            commands::pmf_add,
            commands::pmf_list,
            commands::pmf_score,
            commands::pmf_delete,
            commands::vw_add,
            commands::vw_aggregate,
            commands::nps_add,
            commands::nps_score,
            commands::maxdiff_add,
            commands::maxdiff_ranking,
            commands::survey_list,
            commands::survey_delete,
            commands::pert_add,
            commands::pert_update,
            commands::pert_delete,
            commands::pert_list,
            commands::pert_rollup,
            commands::prd_export,
            // Native fast-paths to bypass the Python sidecar for hot reads
            // — turns 50–2000 ms IPC into ~1 ms direct rusqlite.
            commands::topic_insights_cached,
            commands::topic_counts_bundle,
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
            worker::retry_extraction_failures,
            // ── Task 8: saturation v1 + coverage gaps panel ──
            commands::topic_saturation,
            commands::topic_coverage_gaps,
            // ── Task 9.5: extraction prefs + daily token spend ──
            commands::extraction_prefs_get,
            commands::extraction_prefs_set,
            commands::today_token_spend,
            // ── Video ingest: yt-dlp + faster-whisper (docs/video-ingest.md) ──
            commands::ingest_video_preview,
            commands::ingest_video,
            commands::whisper_list,
            commands::whisper_catalogue,
            commands::whisper_download,
            commands::whisper_delete,
            commands::whisper_set_default,
            commands::ytdlp_version,
            commands::ytdlp_update,
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
            // Same treatment for the dev-python `daemon` child kept alive by
            // run_via_dev_daemon — without this it survives the GUI exit and
            // pegs CPU until the user kills it from Activity Monitor.
            tauri::async_runtime::block_on(cli::shutdown_dev_daemon());
        }
    });
}
