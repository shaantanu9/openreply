# CI / Release Pipeline — Runbook & Source of Truth

> **Audience:** future AI sessions and the developer. Read this BEFORE touching
> anything under `.github/workflows/`, before debugging a "pipeline failing"
> report, or before doing a release. It explains the *why* behind a non-obvious
> setup so nobody "fixes" it back into a state that costs money.
>
> **Repo:** `shaantanu9/openreply` (private, personal account) · local dir
> `reddit-myind` · public release mirror `myind-ai/openreply`.
> **Last updated:** 2026-06-07

---

## TL;DR (the rules)

1. **macOS work runs on a self-hosted runner on the developer's Mac** — free and
   private. CI and the macOS release both target `runs-on: [self-hosted, macOS]`.
2. **Linux & Windows release builds are manual-only.** Their `push: tags v*`
   auto-trigger was deliberately removed. They can ONLY run on GitHub-hosted
   runners (billed), so they are run on demand during a release.
3. **The repo is private by default.** Linux/Windows releases are produced by
   temporarily flipping the repo **public** (public repos get free standard
   runners), running the 2 workflows, then flipping back to **private**.
4. **Do NOT "fix" CI by switching jobs back to `ubuntu-latest` / `macos-latest`.**
   That reintroduces the billing failure this whole setup exists to avoid.

---

## Background: why this exists

GitHub Actions started failing on every run with:

> ❌ *The job was not started because recent account payments have failed or your
> spending limit needs to be increased. Please check the 'Billing & plans'
> section in your settings.*

This is an **account-level billing block**, not a code or workflow bug. The jobs
never start — GitHub refuses to allocate a runner. It affects ALL workflows at
once because it is billing, not repo-specific.

GitHub bills hosted runners by an OS minute-multiplier:

| Runner OS | Multiplier | Notes |
|---|---|---|
| Linux (`ubuntu-*`) | **1×** | cheap |
| Windows (`windows-*`) | **2×** | |
| macOS (`macos-*`) | **10×** | where almost all the cost went |

Public repositories get **standard hosted runners for free** (any OS). Larger
runners are still billed even on public repos — we do not use those.

The fix chosen: stop renting hosted runners for the common path.

---

## Architecture

| Workflow | File | Runner | Trigger | Cost |
|---|---|---|---|---|
| CI (python / rust / js) | `ci.yml` | 🖥️ self-hosted macOS | every push to `main`/`multi-source`, PRs to `main` | **free** |
| Release — macOS | `release-mac.yml` | 🖥️ self-hosted macOS | tag `v*` push or manual | **free** |
| Release — Linux | `release-linux.yml` | ☁️ GitHub-hosted `ubuntu-22.04` | **manual only** (`workflow_dispatch`) | billed (run while public) |
| Release — Windows | `release-windows.yml` | ☁️ GitHub-hosted `windows-latest` | **manual only** (`workflow_dispatch`) | billed (run while public) |
| Release — monolithic matrix | `release.yml` | ☁️ GitHub-hosted matrix | manual only | billed — legacy escape hatch, avoid |
| Promote to public mirror | `release-promote.yml` | ☁️ GitHub-hosted `ubuntu-latest` | auto after a release build completes, or manual | billed (runs during public release window) |

### Why not self-host Linux & Windows too?

**One self-hosted runner = one OS = that machine's OS.** The developer's machine
is an Apple-Silicon Mac (arm64), so its runner can build **macOS only**. Windows
and Linux Tauri builds need real Windows / real Linux (MSVC + NSIS/WiX; webkit2gtk
+ .deb/AppImage). Self-hosting those would require separate machines/VMs. Not
worth it — instead they run on free hosted runners during a brief public window.

---

## The self-hosted runner

- Labels it must have: `self-hosted`, `macOS`, `ARM64` (the first two are what the
  workflows match on; all three are added automatically by `config.sh` on an
  arm64 Mac).
- Installed under `~/actions-runner` on the developer's Mac and run **as a service**
  (`./svc.sh install && ./svc.sh start`) so it is always online and survives reboot.

### Install / re-register

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# pick the current runner version from https://github.com/actions/runner/releases
curl -o actions-runner-osx-arm64-VERSION.tar.gz -L \
  https://github.com/actions/runner/releases/download/vVERSION/actions-runner-osx-arm64-VERSION.tar.gz
tar xzf ./actions-runner-osx-arm64-VERSION.tar.gz

# registration token is short-lived (~1h); mint a fresh one:
#   gh api -X POST /repos/shaantanu9/openreply/actions/runners/registration-token --jq .token
./config.sh --url https://github.com/shaantanu9/openreply \
  --token <REGISTRATION_TOKEN> --name shantanu-mac --unattended

./svc.sh install && ./svc.sh start
```

### Health check

```bash
# is the runner online?
gh api /repos/shaantanu9/openreply/actions/runners \
  --jq '.runners[] | {name,status,labels:[.labels[].name]}'

# service controls (run from ~/actions-runner)
./svc.sh status
./svc.sh stop
./svc.sh start
```

**If self-hosted jobs sit "queued" forever:** the runner is offline. Start the
service. Jobs queue (they do not fail) until a matching runner appears.

---

## Release procedure

### macOS (free, anytime)

Push a `v*` tag or run `release-mac.yml` manually. It builds on the self-hosted
runner. Code-signing / notarization uses the Mac's own Developer ID cert +
the repo's Apple secrets.

### Linux + Windows (the public-toggle dance)

These cost money on hosted runners, so they are run only inside a brief public
window where hosted minutes are free:

```bash
# 1. make the repo public (publishing — see warning below)
gh repo edit shaantanu9/openreply --visibility public --accept-visibility-change-consequences

# 2. dispatch the two builds for the tag
gh workflow run release-linux.yml   -f tag=vX.Y.Z
gh workflow run release-windows.yml -f tag=vX.Y.Z

# 3. WAIT until BOTH runs fully complete (do not go private mid-run, or
#    remaining jobs get billed). Watch them:
gh run watch <run-id>

# 4. make the repo private again — only after both runs finished
gh repo edit shaantanu9/openreply --visibility private --accept-visibility-change-consequences

# 5. confirm
gh repo view shaantanu9/openreply --json visibility
```

**Billing fact that makes this safe:** Actions usage is metered per-job at the
moment it runs, based on visibility *at that time*. A job that runs while public
is free, and flipping back to private does **not** retroactively bill the
completed run. The ONLY thing billed is a job executing while private.

> ⚠️ **Public = downloadable. There is no way around this.** While public,
> anyone with the URL can `git clone` or fork the repo, and forking cannot be
> disabled on a personal repo. Forks made during the window survive the flip
> back to private. Keep the window as short as possible. This is a commercial
> product — treat each public window as a real (small) IP-exposure event.

> ⚠️ **Self-hosted + public is a code-execution risk.** While the repo is public,
> untrusted PR code could be made to run on the self-hosted Mac runner. The
> release workflows are tag/dispatch-triggered (not PR-triggered), so a fork PR
> can't reach them — but for zero risk, `./svc.sh stop` the runner during the
> public window and `./svc.sh start` it after going private again.

---

## Billing visibility ("why is a dollar being charged?")

The `gh` token needs the `user` scope for billing endpoints (one-time):

```bash
gh auth refresh -h github.com -s user
gh api /users/shaantanu9/settings/billing/usage   # per-SKU / per-repo breakdown
```

Also useful (GitHub web → Settings → Billing and plans):
- **Spending limit** + "email me at X% of limit" — early warning before the next dollar.
- **Get usage report** — emails a CSV broken down per repo / workflow / SKU.

If money is being spent, it is almost certainly a **macOS hosted job** (10×) that
slipped back onto a `macos-*` runner, or a Linux/Windows release left running
while private. Check that `ci.yml` and `release-mac.yml` still say
`runs-on: [self-hosted, macOS]`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Every workflow fails "payments have failed / spending limit" | account billing block | fix card / raise limit at github.com/settings/billing — OR rely on this self-hosted setup |
| Self-hosted jobs stuck "Queued" | runner offline | `cd ~/actions-runner && ./svc.sh start`; verify with the runners API call above |
| CI suddenly billing again | a job got reverted to `ubuntu-latest`/`macos-latest` | grep workflows for hosted runners; restore `[self-hosted, macOS]` |
| Linux/Windows release didn't fire on tag | by design — auto-trigger removed | run them manually (see release procedure) |
| `release-promote` failed during a private build | it runs on hosted ubuntu | only relevant during a release; it runs fine inside the public window |
| Python job: `mkdir: /Users/runner: Permission denied` | `actions/setup-python`'s prebuilt macOS Python is **hardcoded** to install at `/Users/runner/hostedtoolcache` (the hosted-runner username); `AGENT_TOOLSDIRECTORY` is ignored on macOS | **Don't use `actions/setup-python` on the self-hosted Mac.** `ci.yml` builds a venv from the Mac's Homebrew `python3.11` and puts it on `$GITHUB_PATH`. Project requires `>=3.11`; `python@3.11` is installed via Homebrew. |
| Rust job fails ~30s in: `could not amend shell profile: '~/.tcshrc' ... Permission denied` | the non-login job shell has no `~/.cargo/bin` on PATH, so `dtolnay/rust-toolchain` can't find the installed `rustup` and re-runs `rustup-init`, which tries to edit the **root-owned** `~/.tcshrc` | `ci.yml` adds a step `echo "$HOME/.cargo/bin" >> "$GITHUB_PATH"` BEFORE the toolchain action so the existing rustup is found and the installer is skipped. |
| Run fails with **zero jobs** right after a workflow edit | a `${{ runner.* }}` / context used where it isn't allowed (e.g. workflow- or job-level `env:`) — the `runner` context is **step-level only** | move the context reference into a step (`steps.<>.env` or a `run:` step). |

---

## Rules for future AI changes (read before editing workflows)

- **Never** switch `ci.yml` or `release-mac.yml` back to GitHub-hosted runners to
  "fix" a queue/failure. Bring the self-hosted runner online instead.
- **Never** add a `push`/`pull_request` auto-trigger to `release-linux.yml` or
  `release-windows.yml`. They are intentionally manual-only.
- If you add a new job that needs macOS, target `runs-on: [self-hosted, macOS]`.
- If you add a job that genuinely needs Linux/Windows on a schedule, flag the
  billing cost to the user first — do not silently put it on a hosted runner.
- After changing any workflow, update this file and add a `changelogs/` entry.

---

## History

- **2026-06-07** — Initial setup. Moved `ci.yml` (3 jobs) and `release-mac.yml`
  to self-hosted macOS; removed `push: tags v*` auto-trigger from
  `release-linux.yml` and `release-windows.yml`. See
  `changelogs/2026-06-07_08_ci-self-hosted-macos-disable-linux-windows.md`.
