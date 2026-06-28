# Video ingest — make the entry point findable

**Date:** 2026-04-21
**Type:** UX

## Summary

The Video URL entry point shipped in Pass 4 was hidden behind a single header button on the Ingest screen. Surfacing it in four more places so users can actually discover it.

## Changes

- **Sidebar link.** New `<a href="#/ingest-video" data-route="/ingest-video">` with a `video` icon, placed directly below the `Ingest` link in the Workspace section. (`app-tauri/index.html`)
- **Dashboard quick-action tile.** Added **Ingest video** and **Ingest files** buttons to the topics-section header on Home, next to the existing `+ New topic` button. (`app-tauri/src/screens/home.js`)
- **Topic page Actions tab.** New `<div class="settings-card">Ingest a video</div>` alongside the existing `Ingest local file` card. Clicking passes the current topic as a query param so the Video screen arrives with the topic pre-selected. (`app-tauri/src/screens/topic.js`)
- **Pre-select topic from URL.** `ingest_video.js` now reads `#/ingest-video?topic=<name>` and auto-selects that topic in the dropdown. (`app-tauri/src/screens/ingest_video.js`)
- **Route matcher allows query string.** `main.js` route regex updated to `^\/ingest-video(?:\?.*)?\/?$` so the topic-prefill query doesn't trip the matcher. (`app-tauri/src/main.js`)
- **Keyboard shortcut `⌘⇧V`.** New case in `wireKeyboard` jumps to `#/ingest-video` from anywhere. Documented in the shortcut-help modal. (`app-tauri/src/main.js`)
- **Tab strip title + icon.** `titleForHash` returns `"Ingest Video"` and `iconForHash` returns `"video"` for the `/ingest-video` route. Also split the generic rest-of-hash resolver on `?` so query strings don't bleed into the tab title. (`app-tauri/src/lib/tabs.js`)

## Files Modified

- `app-tauri/index.html`
- `app-tauri/src/main.js`
- `app-tauri/src/screens/home.js`
- `app-tauri/src/screens/topic.js`
- `app-tauri/src/screens/ingest_video.js`
- `app-tauri/src/lib/tabs.js`

## Files Created

- `changelogs/2026-04-21_21_video-ingest-entry-points.md`

## Where to add a video now

From any screen:

| Path | Accessible from |
|---|---|
| Sidebar → **Ingest Video** | Anywhere |
| Home → **Ingest video** button | Dashboard |
| Ingest page → **Video URL →** header button | `#/ingest` |
| Topic → Actions tab → **Ingest a video** card (topic pre-filled) | Any topic page |
| Onboarding Step 4 (new users) | `#/welcome` |
| `⌘⇧V` keyboard shortcut | Anywhere |

All six routes lead to `#/ingest-video`, which renders the URL input + preview card + model picker + topic selector + Transcribe button.

## Verification

- `node --check` on every modified JS file — syntax clean.
- The existing `#/ingest-video` screen and its Rust bindings are unchanged; this change is purely adding more ways to reach the existing route.
