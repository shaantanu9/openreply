# Download links → GitHub releases

**Status:** ✅ Working out of the box. The items below are mostly "leave it
alone" confirmations + optional hardening. No code changes needed.

## How it works (so you know what NOT to break)

- Every "Download" button → `/api/download`.
- That route calls the GitHub Releases API for **`myind-ai/gapmap`**, finds the
  **latest** release, picks the right asset for the visitor's OS, and 302-redirects.
- Asset matching is by filename suffix (stable across versions):
  - `mac-arm` → `…macOS-Apple-Silicon.dmg`
  - `mac-intel` → `…macOS-Intel.dmg`
  - `windows` → `…Windows-Installer.exe`  ·  `windows-msi` → `…Windows.msi`
  - `linux` → `…Linux.AppImage`  ·  `linux-deb` → `…Linux.deb`
- The `/download` page lists all four platforms + shows the live version badge.

## ✅ Must-be-true checklist (all currently satisfied)

- [x] **`NEXT_PUBLIC_APP_DOWNLOAD_URL` is BLANK** in `.env` and in Vercel.
      → If you set it to a single URL, every download becomes that one fixed
      file/version for everyone. Keep it empty so the per-device "latest" logic runs.
- [x] **The `myind-ai/gapmap` repo's Releases are public.** (Repo can stay
      private; only the *Releases* + their assets need to be downloadable. They are —
      the site fetches them with no auth.)
- [x] **The latest release is published, not a Draft or Pre-release.** GitHub's
      `/releases/latest` API ignores drafts and prereleases. If a new build only
      shows as a draft, the site keeps serving the previous version until you hit
      **Publish release**.
- [x] **Asset filenames keep the `...-<Platform>.<ext>` naming** the release CI
      already produces. If the CI ever renames assets (e.g. drops "Apple-Silicon"),
      update the suffix map in `src/lib/releases.ts` → `ASSET_SUFFIX`.

## ⚙️ Optional (recommended for high traffic)

- [ ] **Add `GITHUB_TOKEN` in Vercel** (Project → Settings → Environment
      Variables, server-side, *not* `NEXT_PUBLIC`). Raises the GitHub API limit
      from 60 → 5,000 req/hour. Not required — responses are cached 15 min — but
      nice insurance. Classic token needs **no scopes** for public release reads;
      fine-grained needs read-only **Contents**.
- [ ] **Deploy to production** (`vercel --prod`) — ask first; this overwrites the
      live site. Then smoke-test below.

## 🔎 Post-deploy smoke test (1 min)

Open these on the live domain — each should download the right file:

- `https://<your-domain>/api/download`               → your OS's build
- `https://<your-domain>/api/download?platform=mac-intel`  → Intel `.dmg`
- `https://<your-domain>/api/download?platform=windows`    → `.exe`
- `https://<your-domain>/api/download?platform=linux`      → `.AppImage`
- `https://<your-domain>/download`                   → 4 cards + "Latest: vX.Y.Z" badge

## When you cut a new app release (e.g. v0.1.19)

Nothing to do on the website. As soon as the GitHub release is **Published**
(not draft), the site serves it automatically within ~15 min (cache TTL), or
instantly on the next cold render.
