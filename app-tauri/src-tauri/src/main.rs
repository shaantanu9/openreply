// Prevent opening a console window on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod commands;
mod db;
mod persona_cmds;
mod schedule;
mod worker;

use cli::{
    cancel_active_chat, cancel_active_job_silent, cancel_active_stream,
    ActiveChat, ActiveChatPid, ActiveCollects, ActiveEnrich, ActiveEnrichPid, ActiveGraphOps,
    ActiveJob, ActiveJobPid, ActiveStream, ActiveStreamPid, CollectCancelMarker, CollectQueue,
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
    //   3) ~/.config/openreply/.env (same path BYOK writes to)
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
            .join("openreply")
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
        .manage(CollectCancelMarker::default())
        .manage(Arc::new(ExtractionWorker::default()))
        .setup(|app| {
            // ── LetsMove-style auto-relocation ──────────────────────────
            // If macOS Gatekeeper translocated this .app (which it does
            // for any quarantined .app launched from outside /Applications),
            // prompt the user once to move it to /Applications, then
            // self-relocate + relaunch. Without this every MCP install
            // writes a randomized `/private/var/.../AppTranslocation/<UUID>`
            // path into Claude's config that goes stale the instant the
            // app quits — the user sees "openreply" in /mcp but it never
            // connects. See commands::maybe_relocate_to_applications.
            //
            // Release-builds only. Dev builds run from target/debug and
            // never hit translocation.
            #[cfg(all(target_os = "macos", not(debug_assertions)))]
            {
                if commands::maybe_relocate_to_applications() {
                    std::process::exit(0);
                }
            }

            // ── Reap orphaned PyInstaller `_MEI*` temp dirs ─────────────
            // The bundled sidecar is a PyInstaller onefile: it extracts
            // ~130 MB into a fresh `_MEIxxxxxx` temp dir on every spawn and
            // cleans up on graceful exit. Crashes / SIGKILLs (sidecar
            // lock-timeout, Claude Code reloading the MCP server, app
            // force-quit) leave the dir behind. Across sessions they pile up
            // and fill the disk, after which EVERY sidecar spawn 255-exits
            // with `Could not create temporary directory!` /
            // `decompression resulted in return code -1!` — the whole app
            // (and MCP install) looks broken on a fresh, tight-disk machine.
            // Sweep stale ones (>6 h, never a live extraction) off the boot
            // path so this can't silently recur. Runs on its own thread so a
            // slow temp dir never delays the window. See
            // cli::reap_pyinstaller_orphans.
            // Runs in a loop (hourly) — not just at boot — so a long-running
            // session can't accumulate crash-orphans either. The daemon
            // pre-warm below stops the boot `_MEI` storm at its source; this
            // is the safety net that guarantees any stragglers (LLM-job
            // fallbacks, hard crashes) get swept before they can fill the disk.
            std::thread::spawn(|| loop {
                let (n, bytes) = cli::reap_pyinstaller_orphans();
                if n > 0 {
                    eprintln!(
                        "[boot] reaped {n} orphaned _MEI dir(s), freed {:.1} MB",
                        bytes as f64 / 1_048_576.0
                    );
                }
                std::thread::sleep(std::time::Duration::from_secs(60 * 60));
            });

            // ── Pre-warm the bundled sidecar daemon ─────────────────────
            // The frontend fires ~12 sidecar calls within ~1s of mount. If
            // they all hit a COLD daemon at once they lose the lock race,
            // time out, and each falls back to a cold one-shot PyInstaller
            // spawn — the `_MEI` storm that makes the app feel frozen AND
            // fills the disk (see DAEMON_LOCK_TIMEOUT_* in cli.rs). Kick a
            // single cheap call HERE, before the webview JS runs, so the
            // daemon pays its one-time import cost up front and the boot herd
            // lands on the already-warm interpreter. Best-effort — a failure
            // just falls back to the previous (slower) behaviour.
            {
                let app_handle_warm = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let t0 = std::time::Instant::now();
                    match cli::run_cli(&app_handle_warm, vec!["info"]).await {
                        Ok(_) => eprintln!(
                            "[boot] sidecar daemon pre-warmed in {} ms",
                            t0.elapsed().as_millis()
                        ),
                        Err(e) => eprintln!(
                            "[boot] sidecar daemon pre-warm failed (non-fatal): {e}"
                        ),
                    }
                });
            }

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

            // Periodic orphan-lock sweeper. The single-flight collect slot
            // (`ActiveJob` / `ActiveJobPid`) can end up "held" with no
            // matching entry in `ActiveCollects` if a sidecar dies without
            // its `Terminated` event reaching us. Symptoms in the UI: the
            // busy modal shows "(orphan sidecar — name unavailable)" with
            // "unknown elapsed", and Queue waits forever because
            // `collect:done` never fires.
            //
            // `start_collect` already auto-reaps before each new collect
            // call, but the user can sit on a screen looking at a stale
            // "Collecting now: …" status bar without ever triggering a new
            // collect — this loop catches that case. Every 8s, if the slot
            // is held but the topic map is empty, kill the slot and emit
            // `collect:orphan:reaped` so the status bar / modal can update.
            // Boot-time: `ActiveJob` defaults to empty so this is a no-op
            // on the first tick — the tick exists to catch in-session
            // orphans, not boot state.
            let app_handle_sweeper = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::{Emitter, Manager};
                // Two-tick confirmation: only reap if we observe the
                // orphan condition twice in a row, ~20 s apart. Defensive
                // belt against a brief race between `run_collect_inner`
                // inserting the topic into `ActiveCollects` and
                // `run_cli_streaming` setting the slot. The root cause
                // (premature map removal) was fixed elsewhere, but a
                // short-lived empty-map window can still appear during a
                // queue drain transition.
                let mut prev_orphan = false;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(20)).await;
                    // A held slot is an orphan only if NO fresh streaming job is
                    // registered in `ActiveCollects`. `run_cli_streaming` records
                    // a start timestamp for the in-flight job and clears it on
                    // exit, so a healthy long-running job (multi-minute `reply
                    // find` with LLM scoring) keeps a fresh entry and is never
                    // reaped. We still reclaim a slot whose entry has gone stale
                    // (> 30 min ⇒ a process that died without a `Terminated`
                    // event) so the mutual-exclusion guard can't strand the user.
                    // Previously this checked plain `is_empty()`, but the map was
                    // never populated after the Gap Map decoupling, so EVERY job
                    // looked orphaned and got killed after ~40s ("Collect -1").
                    const STALE_SECS: u64 = 30 * 60;
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let no_fresh_job = match app_handle_sweeper
                        .try_state::<ActiveCollects>()
                    {
                        Some(s) => s
                            .0
                            .lock()
                            .ok()
                            .map(|g| g.values().all(|&started| now.saturating_sub(started) > STALE_SECS))
                            .unwrap_or(true),
                        None => true,
                    };
                    if !no_fresh_job {
                        prev_orphan = false;
                        continue;
                    }
                    let slot_held = {
                        let mut held = false;
                        if let Some(s) = app_handle_sweeper.try_state::<ActiveJob>() {
                            if s.0.lock().ok().map(|g| g.is_some()).unwrap_or(false) {
                                held = true;
                            }
                        }
                        if !held {
                            if let Some(s) = app_handle_sweeper.try_state::<ActiveJobPid>() {
                                if s.0.lock().ok().map(|g| g.is_some()).unwrap_or(false) {
                                    held = true;
                                }
                            }
                        }
                        held
                    };
                    let curr_orphan = slot_held;
                    if curr_orphan && prev_orphan {
                        // Silent kill — sweeper-triggered reaps shouldn't
                        // mark the next collect's exit as "cancelled by
                        // user", since this is a maintenance action.
                        let killed = cancel_active_job_silent(&app_handle_sweeper);
                        let _ = app_handle_sweeper.emit(
                            "collect:orphan:reaped",
                            serde_json::json!({
                                "trigger": "sweeper",
                                "killed": killed,
                            }),
                        );
                        prev_orphan = false;
                    } else {
                        prev_orphan = curr_orphan;
                    }
                }
            });

            // Auto-start the extraction worker on boot IFF any topic already
            // has ≥ ENRICH_THRESHOLD posts. This gates Phase-B (async
            // findings extraction) on having enough signal. On fresh
            // installs the worker stays asleep until a collect crosses the
            // threshold; main.js re-triggers the start via
            // `api.startExtractionWorker()` on `openreply:changed` kind=collect.
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
                let db_path = dir.join("openreply.db");
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
            // OpenReply
            commands::reply_platforms,
            commands::agent_list,
            commands::agent_get,
            commands::agent_create,
            commands::agent_parse_url,
            commands::agent_use,
            commands::agent_knowledge,
            commands::agent_chat,
            commands::agent_refresh,
            commands::agent_refresh_stream,
            commands::agent_learn,
            commands::agent_learn_status,
            commands::agent_corpus,
            commands::account_track,
            commands::account_list,
            commands::account_untrack,
            commands::account_fetch,
            commands::agent_corpus_check,
            commands::agent_autopilot,
            commands::agent_autopilot_set,
            commands::agent_autopilot_run,
            commands::agent_build_graph,
            commands::agent_graph,
            commands::agent_brain,
            commands::agent_brain_relink,
            commands::agent_teach_video,
            commands::reply_find,
            commands::reply_find_stream,
            commands::reply_list,
            commands::reply_source_counts,
            commands::reply_draft,
            commands::reply_set_status,
            commands::reply_save_draft,
            commands::reply_drafts,
            commands::reply_approve,
            commands::reply_queue,
            commands::reply_snooze,
            commands::reply_post_due,
            commands::reply_growth_plan,
            commands::reply_growth_get,
            commands::notify_get,
            commands::notify_set,
            commands::notify_test,
            commands::bot_poll_once,
            commands::content_generate,
            commands::content_list,
            commands::content_update,
            commands::content_publish_x,
            commands::content_publish_x_reply,
            commands::publish_status,
            commands::publish_set_x_creds,
            commands::content_delete,
            commands::agent_delete,
            commands::agent_update,
            commands::agent_personas,
            commands::agent_link_persona,
            commands::agent_unlink_persona,
            commands::reply_rules,
            commands::alerts_list,
            commands::alerts_add,
            commands::alerts_delete,
            commands::geo_list,
            commands::geo_add,
            commands::geo_set,
            commands::geo_delete,
            commands::geo_check,
            commands::geo_check_all,
            commands::geo_history,
            commands::analytics_summary,
            commands::reddit_account_status,
            commands::sub_discover,
            commands::sub_list,
            commands::sub_intel,
            commands::sub_track,
            commands::sub_check,
            commands::agent_goal_set,
            commands::agent_playbook_get,
            commands::agent_evolve,
            commands::agent_ideas,
            commands::agent_digest,
            commands::agent_digest_quick,
            commands::agent_digest_search,
            commands::agent_task_list,
            commands::agent_task_create,
            commands::agent_task_update,
            commands::agent_task_delete,
            commands::agent_idea_draft,
            commands::agent_idea_status,
            commands::feeds_list,
            commands::feeds_validate,
            commands::feeds_add,
            commands::feeds_remove,
            commands::feeds_enable,
            commands::creds_list,
            commands::creds_import_browser,
            commands::creds_save_manual,
            commands::creds_verify,
            commands::creds_delete,
            commands::creds_toggle,
            commands::creds_preview,
            commands::app_reset_preview,
            commands::app_hard_reset,
            commands::app_relaunch,
            commands::export_prefs_get,
            commands::export_prefs_set,
            commands::reveal_in_finder,
            commands::app_data_dir,
            commands::health_check,
            commands::open_url,
            commands::byok_status,
            commands::byok_set,
            commands::device_signature,
            commands::check_app_version,
            commands::test_llm,
            commands::list_ollama_models,
            commands::list_provider_models,
            // Paper research (Papers tab, BibTeX/RIS export, Unpaywall OA lookup)
            // Intent layer (per-topic deliverable routing)
            commands::ollama_start_service,
            commands::ollama_stop_service,
            commands::close_splash,
            commands::db_mtime,
            commands::palace_stats,
            commands::palace_model_status,
            commands::palace_reindex,
            commands::schedule_install,
            commands::schedule_uninstall,
            commands::schedule_status,
            // Dual-Mode Pivot — Product Mode
            // Lifecycle pivot — Kano categorization
            // Runtime snapshot — Task Manager backing
            // Page explainer — eye-icon "why this page exists"
            // Audience personas (2026-05-03) — cluster real authors per topic
            // Iterate / Autoresearch (2026-05-03 Phase 4)
            // Deliberation (2026-05-03 Phase 3) — 5-persona debate
            // Launch & GTM (2026-05-02)
            // Discovery framework expansion (2026-05-01_04) — OST + RICE +
            // MoSCoW + Empathy Maps + Four Risks + Value Curve.
            // Discovery framework expansion v2 (2026-05-01_05) — TAM/SAM/SOM,
            // Porter's Five Forces, 2x2 positioning map, cost model,
            // customer interviews (Mom Test), Sean Ellis PMF survey,
            // Van Westendorp / NPS / MaxDiff, PERT estimation, PRD export.
            commands::cost_model_get,
            // Persistent topic AI chat conversations (ChatGPT-style history)
            commands::chat_conv_list,
            commands::chat_conv_get,
            commands::chat_conv_save,
            commands::chat_conv_rename,
            commands::chat_conv_delete,
            // MCP ↔ App integration (one-click connect to any MCP client)
            commands::mcp_clients,
            commands::mcp_status,
            commands::mcp_install,
            commands::mcp_config_snippet,
            commands::mcp_uninstall,
            // CLI symlink — expose bundled openreply-cli at /usr/local/bin/openreply
            commands::cli_symlink_status,
            commands::install_cli_symlink,
            commands::uninstall_cli_symlink,
            // ── AG-C: global-competitors (T2.5) + finding feedback (T2.4) ──
            // ── AG-E: prompt overrides (T3.7) ──────────────────────────
            // ── AG-E: saved views (T3.1) ───────────────────────────────
            // ── AG-D: CSV ingest ───────────────────────────────────────
            // ── Incremental enrichment: extraction worker supervisor ──
            worker::start_extraction_worker,
            worker::stop_extraction_worker,
            worker::extraction_worker_status,
            worker::mark_topic_active,
            worker::enqueue_extraction,
            worker::retry_extraction_failures,
            // ── Task 8: saturation v1 + coverage gaps panel ──
            // ── Task 9.5: extraction prefs + daily token spend ──
            commands::extraction_prefs_get,
            commands::extraction_prefs_set,
            commands::today_token_spend,
            // ── Video ingest: yt-dlp + faster-whisper (docs/video-ingest.md) ──
            // ── Persona agents (Phase 1 — 2026-05-12) ──
            persona_cmds::persona_agent_list,
            persona_cmds::persona_agent_create,
            persona_cmds::persona_agent_update,
            persona_cmds::persona_agent_delete,
            persona_cmds::persona_agent_memories,
            persona_cmds::persona_agent_chat,
            persona_cmds::persona_agent_ingest,
            // Phase 5 — surgical teach-from-video (2026-05-12)
            persona_cmds::persona_agent_teach_video,
            // Phase 2b — graph + conclusions
            persona_cmds::persona_agent_graph,
            persona_cmds::persona_agent_backfill,
            persona_cmds::persona_agent_conclude,
            persona_cmds::persona_agent_conclusions,
            // Phase 3b — cross-persona memory share
            persona_cmds::persona_agent_share,
            // Phase 4a — persona-of-personas (ingest peer conclusions)
            persona_cmds::persona_agent_ingest_peers,
            // Phase 4c — share-rejection log (lens contradictions)
            persona_cmds::persona_agent_rejections,
            // ── Minimal X-account worktree (MVP) ──
            commands::x_account_add,
            commands::x_account_import_browser,
            commands::x_account_list,
            commands::x_account_profile,
            commands::x_account_fetch_posts,
            commands::x_account_fetch_thread,
            commands::x_account_save_to_library,
            commands::x_account_remove,
        ])
        .build(tauri::generate_context!())
        .expect("error while building openreply");

    // On app exit (window closed, Cmd-Q, process signal), terminate every
    // tracked Python child so we don't orphan collect/chat/stream processes.
    // This fires for BOTH paths:
    //   - prod (PyInstaller sidecar, CommandChild::kill)
    //   - dev  (raw tokio pid → SIGTERM)
    // Without this the user's Activity Monitor fills up with zombie
    // `openreply` / `python -m openreply.cli.main` processes every
    // time they quit mid-collect, and the fetches table keeps an
    // `ended_at=NULL` row that the UI reads as "still running".
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            // Use the silent variant on shutdown — there's no UI left to
            // read a "cancelled by user" label, and we don't want stale
            // marker state surviving into a fast-relaunch scenario.
            let _ = cancel_active_job_silent(app_handle);
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
