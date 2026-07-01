# Dismiss-reason learning + Restore for skipped opportunities

**Date:** 2026-07-01
**Type:** Feature

## Summary

Skipping an opportunity used to be a dead end: it only hard-suppressed that one
exact post from future finds and fed the playbook distiller nothing but a count
(`dismissed=7`). The agent couldn't see *what* you skipped or *why*, so it never
generalized — pure memorization, not learning.

This change turns a skip into a real learning signal, keeps skip one-click, and
makes the learning visible and correctable in the Dismissed view:

1. **Skip stays instant** — one click, no prompt, no blocking LLM call.
2. **The agent learns why** — a lazy, batched LLM pass infers a short,
   *generalizable* reason for each skip ("Price-shopping threads have no buying
   intent"), stored on the feedback row. Runs when the Dismissed tab opens,
   capped per call so cost is bounded.
3. **The Dismissed view shows it** — each dismissed card now renders the post's
   own text plus the learned reason, with an "agent learned" / "your correction"
   badge.
4. **You can correct it** — the reason is an editable field; saving it records
   `reason_source='user'` (the strongest signal) and triggers a playbook
   re-distill.
5. **Proper feedback loop** — learned reasons + real engaged/dismissed examples
   now feed the playbook distiller (not just counts), and a learned-preference
   layer **re-ranks future finds**: communities/authors you repeatedly skip get a
   bounded score penalty (verified −0.26 for a 2×-dismissed sub), ones you engage
   get a bonus. User-corrected dismissals count double.
6. **Restore** — a dismissed card has an "↩ Restore" button that clears the
   dismissal (so it's no longer suppressed or teaching "avoid") and moves the
   opportunity back to `new`.

## Changes

- Skip → `dismissed` feedback now also stores `sub`/`author` and reserves
  `reason`/`reason_source` (filled lazily, not on the click).
- New learning functions: `infer_dismiss_reason`, `learn_pending_dismissals`,
  `set_dismiss_reason`, `un_dismiss`, `dismissed_reasons`, `learned_examples`,
  `learned_preferences`, `preference_delta`.
- `find_opportunities` applies `preference_delta` to each candidate's fused score
  and re-sorts, so learned taste bends the ranking (not just an exact-post block).
- `list_opportunities` enriches skipped rows with `dismiss_reason` +
  `dismiss_reason_source`.
- `evolve_playbook` feeds actual engaged/dismissed examples and their reasons
  (user-corrected flagged) into the distill prompt instead of bare counts.
- New CLI: `reply learn-dismissals`, `reply set-dismiss-reason`, `reply restore`.
- New Tauri commands + registration: `reply_learn_dismissals`,
  `reply_set_dismiss_reason`, `reply_restore`.
- Dismissed-view UX: learned-reason block (editable) + Restore button + a
  once-per-entry "learn from your skips" trigger.

## Files Created

- `changelogs/2026-07-01_07_dismiss-reason-learning-and-restore.md`

## Files Modified

- `src/openreply/reply/schema.py` — `reply_feedback` gains `sub`, `author`,
  `reason`, `reason_source` (create + forward-compat `add_column`).
- `src/openreply/reply/feedback.py` — capture sub/author on dismissal; preserve
  existing reason across re-signals; add the 8 learning functions above.
- `src/openreply/reply/opportunity.py` — load `learned_preferences` in
  `find_opportunities`, apply `preference_delta` + re-sort; enrich skipped rows
  in `list_opportunities`.
- `src/openreply/reply/playbook.py` — `evolve_playbook` distills from real
  examples/reasons, not just counts.
- `src/openreply/cli/reply_cmds.py` — import `feedback`; add `learn-dismissals`,
  `set-dismiss-reason`, `restore` commands.
- `app-tauri/src-tauri/src/commands.rs` — 3 new commands.
- `app-tauri/src-tauri/src/main.rs` — register the 3 commands.
- `app-tauri/src/or/api.js` — `replyLearnDismissals`, `replySetDismissReason`,
  `replyRestore` wrappers.
- `app-tauri/src/or/dynamic.js` — Dismissed-view learning block, Restore button,
  save-reason handler, learn-on-open trigger, `_learnedOnce` state.
