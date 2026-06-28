# Cross-platform packaging — Windows / Linux / macOS

**Status (2026-04-21):** ship macOS-only for now. Windows + Linux are well-scoped but deferred. This doc captures everything we need to do when we turn them on, so future-me doesn't re-research it.

---

## Current state (what works today)

- **Target:** macOS only (Apple Silicon, `aarch64-apple-darwin`)
- **Output:** `.dmg` disk image via Tauri's built-in DMG bundler
- **Sidecar:** `app-tauri/src-tauri/binaries/reddit-cli-aarch64-apple-darwin` — a PyInstaller bundle of the Python CLI
- **Build command:** from `app-tauri/`, `npm run tauri build` produces `src-tauri/target/release/bundle/dmg/OpenReply_0.1.0_aarch64.dmg`
- **Signing:** ad-hoc (`codesign --force --deep --sign -` in the build script). Users right-click → Open first time; macOS shows "cannot be opened" + warning

**Files involved:**
- `app-tauri/src-tauri/tauri.conf.json` — bundle target list
- `app-tauri/src-tauri/Cargo.toml` — Rust crate + Tauri dependency
- `reddit-cli.spec` (repo root) — PyInstaller spec for the sidecar
- `scripts/build-pyinstaller.sh` — wraps the pyinstaller call + codesign + copy to `app-tauri/src-tauri/binaries/`
- `.github/` — currently empty for release workflows

---

## Why this is macOS-only today

1. **Sidecar is a PyInstaller bundle.** PyInstaller does **not cross-compile**. A macOS PyInstaller run produces a Mach-O binary that cannot run on Windows or Linux. Each OS needs its own PyInstaller run on its own kind of host.
2. **Tauri's bundler is OS-native.** macOS DMG bundling uses `hdiutil` (macOS only); Windows uses WiX/NSIS (Windows only); Linux uses `dpkg`/`rpmbuild` (Linux only). Tauri can produce any of these, but **only on a host of that OS**.
3. **Code-signing tooling is OS-specific.** `codesign` + notarization are macOS-only. Windows signtool is Windows-only.

**Net effect:** building a Windows `.exe` or Linux `.deb` from a Mac is not possible without either (a) a Windows/Linux VM, (b) a CI runner on that OS, or (c) a self-hosted Windows/Linux machine.

---

## The three realistic paths when we turn Windows on

### Path A — GitHub Actions (recommended, lowest setup)

Push to a branch, a GitHub-hosted runner for each OS builds in parallel, release artifacts land as GitHub Releases.

**Setup:** 80-line workflow YAML + tauri.conf.json edits. One-hour task.

**Cost:**
- **Public repo:** free forever. No minute cap, any OS.
- **Private repo, Free plan:** 2,000 Linux-equivalent minutes/month. Windows = 2×, macOS = 10×.
- **Private, Pro:** 3,000 min/month.

**Per-build minute estimate** (this app):

| Step | Windows | macOS |
|---|---|---|
| Checkout + node + python install | 2 | 2 |
| PyInstaller sidecar | 3-5 | 3-5 |
| Rust + Tauri compile | 8-12 | 6-10 |
| Package + sign | 1-2 | 1-2 |
| **Per-OS total** | **~15-20 min** | **~12-18 min** |

Billed cost on **private** repo:
- Windows 15 min × 2 multiplier = **30 Linux-equiv min**
- macOS 15 min × 10 multiplier = **150 Linux-equiv min**
- Full 2-OS build = ~**180 Linux-equiv min**
- Free 2000 min allowance = **~11 full builds/month** before overage kicks in

Overage pricing: $0.008/min Linux, $0.016/min Windows, $0.08/min macOS. A full build over the cap ~= $1.50.

**With `actions/cache@v4`** on Rust `target/`, npm cache, and Python venv, subsequent builds drop to 6-10 min each.

### Path B — Self-hosted Windows/Linux box

If a physical/spare machine is available, self-hosted runners are **free even for private repos**. One-time setup:
1. Install Rust + Node + Python + WiX Toolset on the Windows machine.
2. Run GitHub's runner installer, register with the repo.
3. Workflow uses `runs-on: [self-hosted, windows-x64]`.

**Pros:** zero ongoing cost, unlimited builds, can keep caches warm indefinitely.
**Cons:** machine has to stay on + you maintain it.

### Path C — On-demand cloud Windows VM

Azure, AWS, or Hetzner spot instance for an hour, run `pyinstaller` + `tauri build` on it, upload the `.exe` back, tear it down.

**Cost:** ~$1-2 per build.
**Pros:** no CI setup.
**Cons:** manual, doesn't scale.

**Recommendation when we're ready: start with A, public repo (or a public release-only mirror), zero cost.**

---

## Code-signing — the part everyone forgets

Without signing, both Windows and macOS show big scary warnings on first launch. Users can bypass but it kills trust for public distribution.

### macOS

| Level | Cost | User experience |
|---|---|---|
| **Ad-hoc** (`codesign --sign -`, what we do now) | $0 | "Cannot be opened because Apple cannot check it for malicious software." Right-click → Open works. |
| **Developer ID Application cert + notarization** | $99/yr (Apple Developer membership) | App opens cleanly, no warnings. Required for public distribution. |
| **Mac App Store** | $99/yr + App Store review | Sandboxing required, different cert. Not applicable for Tauri dev apps. |

**Notarization flow:** `xcrun notarytool submit ... --wait` → Apple signs a "ticket" → `xcrun stapler staple` embeds the ticket in the DMG. Takes 5-15 min via Apple's service, runs once per build. Needs Developer ID cert + App-Specific Password.

### Windows

| Level | Cost | User experience |
|---|---|---|
| **Unsigned** | $0 | "Windows protected your PC — app is from an unknown publisher." Click More info → Run anyway. |
| **Standard code-signing cert (OV)** | $200-400/yr | SmartScreen warning initially; **reputation builds** after ~100s of installs; eventually clean. |
| **EV code-signing cert** | $300-600/yr + hardware token | SmartScreen clean from install #1. Required if you're shipping to non-technical users. |

Certificate issuers: DigiCert, Sectigo, GoDaddy, SSL.com. Lead time 1-7 days for EV (they phone-verify your business).

**Sign flow:** `signtool sign /f cert.pfx /p PASSWORD /t http://timestamp.digicert.com /v MyApp.exe` + `MyApp.msi`. Integrates into the GitHub Actions workflow by base64-encoding the .pfx as a secret.

### Linux

No signing required. `.deb` / `.rpm` / `.AppImage` install freely; AppImage has optional `zsyncmake` for delta updates.

### Summary of the 2026 total yearly cost to ship signed builds

- Apple Developer: **$99/yr**
- Windows EV cert: **~$350/yr** (cheaper OV is fine for tech-savvy users at ~$200/yr)
- Linux: **$0**
- GitHub Actions on public repo: **$0**
- **Grand total: ~$450/yr** to have clean installers on all three OSes

For MVP / beta / internal: skip both certs, document the "right-click → Open" + "More info → Run anyway" workarounds in the README. That's the $0 path.

---

## What we'd need to change in the codebase (when ready)

### 1. `app-tauri/src-tauri/tauri.conf.json`

Add Windows + Linux bundle targets:

```jsonc
{
  "bundle": {
    "active": true,
    "targets": ["app", "dmg", "nsis", "msi", "deb", "appimage"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/icon.icns", "icons/icon.ico"],
    "windows": {
      "certificateThumbprint": null,  // fill when EV cert available
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com",
      "webviewInstallMode": { "type": "embedBootstrapper" },
      "nsis": {
        "installMode": "perUser",
        "displayLanguageSelector": false
      }
    },
    "macOS": {
      "signingIdentity": null,   // fill with Developer ID when subscribed
      "providerShortName": null,
      "entitlements": "Entitlements.plist"
    },
    "linux": {
      "deb": { "depends": [] },
      "appimage": { "bundleMediaFramework": true }
    }
  }
}
```

An `icons/icon.ico` needs to exist — generate from the existing PNG via ImageMagick or an online tool, commit to `src-tauri/icons/`.

### 2. `app-tauri/src-tauri/binaries/`

Add sidecars for each target triple:

```
binaries/
  reddit-cli-aarch64-apple-darwin      ← exists today (macOS arm64)
  reddit-cli-x86_64-apple-darwin       ← needed if supporting Intel Macs
  reddit-cli-x86_64-pc-windows-msvc.exe ← needed for Windows
  reddit-cli-x86_64-unknown-linux-gnu  ← needed for Linux
  reddit-cli-aarch64-unknown-linux-gnu ← needed for Linux arm64 (e.g. RPi, AWS Graviton)
```

Tauri auto-picks the matching triple based on the build target. The CI job for each OS runs `pyinstaller reddit-cli.spec`, then renames and copies the output into this directory.

### 3. `reddit-cli.spec`

Likely works as-is — PyInstaller specs are OS-independent. Two known potential tweaks on Windows:
- `hidden_imports` might need `pywin32` adds (only if we ever call a Windows API)
- `playwright` or similar browser-automation deps would need per-OS driver binaries (we don't currently use any)

### 4. `.github/workflows/build.yml` (new file)

Template:

```yaml
name: Build

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14        # arm64
            target: aarch64-apple-darwin
            sidecar-ext: ''
          - os: macos-13        # x86_64
            target: x86_64-apple-darwin
            sidecar-ext: ''
          - os: windows-2022
            target: x86_64-pc-windows-msvc
            sidecar-ext: '.exe'
          - os: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            sidecar-ext: ''

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm, cache-dependency-path: app-tauri/package-lock.json }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: ${{ matrix.target }} }
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: 'app-tauri/src-tauri' }

      # Linux extra deps (WebKit, etc.)
      - if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential \
            curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev \
            librsvg2-dev

      # Build the Python sidecar for THIS os/arch
      - name: Build sidecar
        run: |
          python -m pip install --upgrade pip
          pip install -e '.[sources,ingest-rich]' pyinstaller
          pyinstaller reddit-cli.spec --distpath dist --workpath build-pyinstaller

      - name: Stage sidecar for Tauri
        shell: bash
        run: |
          mkdir -p app-tauri/src-tauri/binaries
          cp dist/reddit-cli/reddit-cli${{ matrix.sidecar-ext }} \
             "app-tauri/src-tauri/binaries/reddit-cli-${{ matrix.target }}${{ matrix.sidecar-ext }}"
          # macOS: re-codesign ad-hoc so it's verifiable
          if [ "${{ runner.os }}" = "macOS" ]; then
            codesign --force --deep --sign - \
              "app-tauri/src-tauri/binaries/reddit-cli-${{ matrix.target }}"
          fi

      - name: Install npm deps
        working-directory: app-tauri
        run: npm ci

      - name: Build Tauri app
        working-directory: app-tauri
        run: npm run tauri build -- --target ${{ matrix.target }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: openreply-${{ matrix.target }}
          path: |
            app-tauri/src-tauri/target/${{ matrix.target }}/release/bundle/**/*.dmg
            app-tauri/src-tauri/target/${{ matrix.target }}/release/bundle/**/*.msi
            app-tauri/src-tauri/target/${{ matrix.target }}/release/bundle/**/*.exe
            app-tauri/src-tauri/target/${{ matrix.target }}/release/bundle/**/*.deb
            app-tauri/src-tauri/target/${{ matrix.target }}/release/bundle/**/*.AppImage

  release:
    needs: build
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/')
    steps:
      - uses: actions/download-artifact@v4
        with: { path: dist }
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/**/*
          draft: true
          generate_release_notes: true
```

### 5. `scripts/dev.sh`

Doesn't need changes — it only runs on the dev host. CI does its own build invocation.

### 6. `README.md`

Add installation instructions per platform:
- macOS: drag .dmg → Applications, right-click → Open first time
- Windows: run .exe installer, click "More info → Run anyway" on SmartScreen
- Linux: `sudo dpkg -i openreply_0.1.0_amd64.deb` or chmod+x the AppImage

---

## Other cross-platform gotchas specific to OpenReply

- **Data dir paths** — we already use Tauri's `$APPDATA` variable via `app.path().app_data_dir()`. This resolves to `~/Library/Application Support/...` on macOS, `%APPDATA%\...` on Windows, `~/.config/...` on Linux. No code change needed.
- **Sidecar invocation** — Rust uses `app.shell().sidecar("reddit-cli")` which auto-resolves to the `-<triple>` suffix. No code change.
- **Dev bypass** — `scripts/dev.sh` sets `REDDIT_MYIND_DEV_PYTHON=$(pwd)/.venv/bin/python`. Path works cross-platform; on Windows the venv is at `.venv\Scripts\python.exe` — doctor script needs a Windows branch. Trivial.
- **Ollama** — Mac/Linux uses Unix socket; Windows uses named pipe. Ollama SDK handles both. No change needed.
- **ChromaDB palace** — SQLite files are cross-platform. ChromaDB uses fsync; slightly slower on Windows but works.
- **Markdownify / feedparser / httpx** — all pure-Python, cross-platform.
- **opendataloader-pdf** — needs Java 11+ at runtime. Linux/macOS users can `brew`/`apt` install; Windows users need a JDK install (the lib already falls back to `pypdf` when Java is absent, so Windows users without Java just get slightly lower-quality PDF extraction — not a blocker).

---

## Checklist — when we turn Windows/Linux on

- [ ] Decide: public repo for free Actions, or keep private and accept ~11 builds/month free?
- [ ] Decide: skip code-signing for v1 (document the right-click workaround) or pay $99 + $350/yr?
- [ ] Add `icons/icon.ico` (convert from existing PNG)
- [ ] Update `tauri.conf.json` with `nsis`, `msi`, `deb`, `appimage` targets + per-OS blocks
- [ ] Create `.github/workflows/build.yml` (template above)
- [ ] Test the workflow manually via `workflow_dispatch`
- [ ] Tag `v0.1.0` to cut first multi-OS release
- [ ] Write platform-specific install instructions in README

---

## Appendix — Quick Windows sidecar build without CI

If you ever have a Windows machine and want to produce ONE `.exe` sidecar manually (no Tauri build, just the Python part) to drop into the repo:

```powershell
# Windows PowerShell, on the Windows machine, in the repo root
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -e '.[sources,ingest-rich]' pyinstaller
pyinstaller reddit-cli.spec
# Output is in dist\reddit-cli\reddit-cli.exe
copy dist\reddit-cli\reddit-cli.exe app-tauri\src-tauri\binaries\reddit-cli-x86_64-pc-windows-msvc.exe
```

Commit that binary via Git LFS (same way the macOS one is tracked). Then a Tauri build on any machine that has Windows cross-targets installed in Rust can produce the Windows installer — though that's usually still easier via CI.

---

## References

- [Tauri bundle docs](https://tauri.app/v2/guides/distribution/) — official targets + signing
- [PyInstaller platforms](https://pyinstaller.org/en/stable/operating-mode.html#making-windows-apps-obfuscation-resistant) — why no cross-compile
- [GitHub Actions pricing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) — authoritative minute costs
- [macOS notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution) — Apple's notarytool guide
- [Windows signing](https://learn.microsoft.com/en-us/windows/msix/package/signing-package-overview) — signtool + SmartScreen
