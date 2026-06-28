# LFS maintenance — quarterly prune runbook

**Owner:** repo maintainer
**Cadence:** quarterly (Jan / Apr / Jul / Oct)
**Tracked paths:** `app-tauri/src-tauri/binaries/reddit-cli-*` (see `.gitattributes`)

---

## Why LFS?

The Tauri desktop app ships a PyInstaller-bundled Python sidecar at
`app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin`. A single build
is **~220 MB** — well past GitHub's hard 100 MB per-file cap on regular Git
objects. Without LFS, `git push` would be rejected outright.

Every sidecar rebuild replaces the binary with a fresh ~220 MB blob. Because
Git is content-addressed, every historical rebuild lives forever in LFS
storage unless we explicitly prune unreachable objects.

## Budget

GitHub free tier caps each repo at:

| Resource  | Free tier | 1x Data Pack ($5/mo) |
| --------- | --------- | -------------------- |
| Storage   | 1 GB      | 50 GB                |
| Bandwidth | 1 GB / mo | 50 GB / mo           |

At ~220 MB per rebuild that's **~4 rebuilds before the free-tier storage is
exhausted** and **~4 full clones before the monthly bandwidth is blown**. We
mitigate bandwidth in CI by checking out with `lfs: false` (see
`.github/workflows/ci.yml`) — only the release workflow rebuilds the sidecar
from scratch, so the LFS object is rarely fetched.

## Quarterly prune — exact commands

Run from the repo root on your own machine (not in CI):

```bash
# 0. Sanity check — confirm every LFS object is intact before mutating anything.
git lfs fsck

# 1. Dry-run. Lists objects that *would* be pruned from your local .git/lfs/.
#    These are objects not reachable from HEAD, any branch tip, any tag, the
#    reflog, or the last 3 days of commits.
git lfs prune --dry-run

# 2. Real prune. --verify-remote re-confirms with the remote that each object
#    still exists there before deleting locally, so we never lose the only copy.
git lfs prune --verify-remote

# 3. Verify local cache size dropped.
du -sh .git/lfs
```

### What prune does NOT do

`git lfs prune` **only affects your local `.git/lfs/` cache**. It does not
delete objects from GitHub's remote LFS storage — GitHub retains every object
ever pushed, forever, unless you rewrite history. If remote storage is the
constraint:

1. Buy a Data Pack at <https://github.com/settings/billing> ($5/mo → 50 GB).
2. Or rewrite history with `git lfs migrate` to drop old sidecar blobs from
   past commits. This is destructive and forces every collaborator to re-clone.
   Do not do this without a team-wide heads-up.

## Runbook — CI fails due to LFS quota

Symptom in GitHub Actions logs:

```
Error downloading object: ...: batch response: This repository is over its data quota.
```

Triage:

1. Check <https://github.com/settings/billing> for the current storage +
   bandwidth numbers.
2. If **bandwidth** is the issue (most common): most CI jobs should already
   use `lfs: false`. Audit every `actions/checkout@v4` step in
   `.github/workflows/*.yml` and confirm. Only the release build genuinely
   needs the sidecar, and it rebuilds the sidecar rather than downloading it.
3. If **storage** is the issue: purchase a Data Pack (instant, $5/mo, 50 GB)
   OR schedule a history-rewriting migration for the next maintenance window.
4. Temporary unblock: push a commit with `[skip ci]` while the quota resets
   (bandwidth resets on the 1st of every month; storage does not auto-reset).

## See also

- `.gitattributes` — LFS filter rules
- `.github/workflows/release.yml` — rebuilds the sidecar per-platform, so
  historical sidecar blobs are never needed at build time
- <https://git-lfs.com/> — upstream docs
- <https://docs.github.com/en/billing/managing-billing-for-git-large-file-storage>
