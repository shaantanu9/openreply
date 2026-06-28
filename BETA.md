# OpenReply — Beta tester guide

Thanks for testing OpenReply. This page is the only thing you need — install,
first-launch, the five most useful features, and how to send feedback.

> **5-minute goal:** install the app, run one topic, look at the gap map.
> Everything else is optional.

---

## 1. Install (2 minutes) — **use the .zip on macOS 26.5+ (Tahoe)**

> **⚠️ macOS 26.5+ (Tahoe) blocks drag-installs from DMGs unless the app
> is signed with Apple Developer ID + notarized.** We're working on
> Developer ID — until then, **use `OpenReply_0.1.0_aarch64.zip` instead
> of the DMG.** Same .app inside; the ZIP path bypasses Tahoe's
> DMG-specific restrictions.

### Path A — ZIP (Tahoe-safe, recommended for beta)

1. Download the file you were sent. It's named `OpenReply_0.1.0_aarch64.zip`
   (about 60 MB compressed).
2. Double-click the `.zip` — macOS Archive Utility extracts it, producing
   `OpenReply.app` next to it.
3. **Drag `OpenReply.app` to `/Applications`.** This drag works because the
   files came out of a ZIP, not a DMG.
4. Open Finder → Applications → **right-click `OpenReply.app` → Open**.
   macOS warns "developer cannot be verified" — click **Open**. This
   one-time approval persists; subsequent launches are normal double-click.
5. App launches with the 5-step wizard.

### Path B — DMG (only on macOS 15 / Sequoia or older)

1. Download `OpenReply_0.1.0_aarch64.dmg` (~159 MB).
2. Double-click the DMG → Finder window opens with **OpenReply.app** and an
   **Applications** shortcut.
3. **Drag `OpenReply.app` onto Applications.** Eject the DMG.
4. Open `Applications` → right-click `OpenReply.app` → Open → Open in the
   dialog.

If you're on Tahoe (macOS 26.x) and the DMG drag silently produces a
broken .app (empty / 0-byte binaries inside `Contents/MacOS/`), switch to
the .zip from Path A — that's the symptom of Tahoe's signing enforcement.

### macOS Gatekeeper warning (one-time)

The first time you open OpenReply, macOS will warn you because the app isn't
notarized by Apple (we'll fix that for the public release):

> *"OpenReply" cannot be opened because the developer cannot be verified.*

To bypass:

- **Right-click** (or Control-click) on OpenReply.app → choose **Open**
- In the dialog, click **Open** again

After this one time, double-click launches normally.

If the dialog doesn't offer Open, this Terminal command also works:

```bash
xattr -d com.apple.quarantine /Applications/Gap\ Map.app
```

Then double-click as usual.

---

## 2. First launch — the 5-step wizard

When OpenReply opens for the first time you'll see a wizard:

1. **What is OpenReply** — a one-screen overview. Next →
2. **Your profile** — your name (used in exports). Next →
3. **Connect sources** — *all optional*. You can:
   - Add an **LLM API key** (Anthropic / OpenAI / Groq / DeepSeek / Mistral /
     Google / OpenRouter / NVIDIA), OR
   - Install **Ollama** for free local LLM, OR
   - Skip entirely — OpenReply works without an LLM, just with fewer auto-
     extracted insights.
   - (Optional) Connect **Reddit OAuth** for higher rate limits. Public-JSON
     fallback works without it.
   Next →
4. **Video transcription** — only relevant if you'll ingest podcasts/YouTube.
   Skip if not. Next →
5. **Your first topic** — type any product idea or research area
   (e.g. `meditation apps`, `AI coding assistants`, `resume builders`).
   **Continue** kicks off a collect.

You land on the topic collect screen. OpenReply starts fetching from Reddit,
Hacker News, arXiv, GitHub, and the App Store. **Takes 1–3 minutes** the
first time. Watch the progress in the top bar.

> **No activation key needed.** The beta runs with the licence gate off.

---

## 3. The five most useful things to try

After your first collect finishes, click into the topic. The screen has tabs
across the top. The five worth trying first:

### a. **Insights** — extracted painpoints + workarounds
Auto-summarised pains people have, the workarounds they're currently using,
and what they wish existed. **Needs an LLM** (key or Ollama) to populate.

### b. **Map** — the gap map graph
Pain → workaround → product nodes connected by shared evidence. Click a
node to see the posts that surfaced it. Pinch-zoom, drag to pan.

### c. **Audience** — real Reddit/HN authors clustered into personas
Each cluster has citation-backed quotes. Click a persona to see who they
actually are and what they said.

### d. **Sources** — every post OpenReply collected
SQL-queryable, sortable, filterable. Click a row to read the original.

### e. **Search** (left sidebar → Search)
Across all topics you've created. Try a vague phrase like
"writing tools that respect long form" — OpenReply returns posts, gaps, and
related papers.

### Other sidebar items worth knowing

| Item | What it does |
|---|---|
| **Dashboard** | Home — recently collected topics, momentum, what's new |
| **Topics** | List of every topic you've created |
| **Products** | Track YOUR product (or competitors) and their reception |
| **Ingest** | Drop a CSV / PDF / VTT file into a topic |
| **Ingest Video** | Paste a YouTube / Vimeo URL → on-device Whisper transcribes |
| **Reports** | Export topics as DOCX / PDF / PPTX |
| **Audience / Empathy / Interviews / PMF / Pricing** | Discovery framework tools |
| **Playbook** | Built-in 10-phase product-development workflow |
| **Personas (Agents)** | Single-purpose research agents that learn over time |
| **Settings** | BYOK keys, MCP install, CLI install, all toggles |

You won't need most of these on day one. Explore as questions come up.

---

## 4. Optional power-user setups

### Install the `openreply` CLI in your terminal

Settings → **Command line tool** → **Install command line tool**. macOS
prompts for your password (admin needed to write to `/usr/local/bin`). After
that, `openreply` works from any terminal:

```bash
openreply research collect --topic "AI coding assistants"
openreply query "SELECT count(*) FROM posts"
openreply research search-all --query "vibe coding"
```

Full reference: run `openreply --help` or see `CLI_REFERENCE.md` in the repo.

### Install OpenReply as an MCP server in Claude Code / Cursor / Claude Desktop

This is the **big one for AI-coding workflows.** Once installed, 147
`openreply_*` tools appear inside your MCP client — you can ask Claude to
search your corpus, find painpoints, build personas, etc. from inside any
conversation.

From the app's Settings → MCP → **Connect to Claude Code** (or your client).
Restart your MCP client. The `mcp__openreply__*` tools appear automatically.

If your client isn't auto-detected, run the install manually:

```bash
openreply mcp install --client claude-code        # ~/.claude.json
openreply mcp install --client cursor             # ~/.cursor/mcp.json
openreply mcp install --client claude-desktop     # macOS Claude Desktop config
openreply mcp install --client windsurf
openreply mcp install --client cline              # Cline VSCode extension
```

### Add a (free) LLM key for the auto-insights

Settings → BYOK → pick a provider. Cheapest options:
- **Groq** — free tier, fast (Llama 3.3 70B)
- **OpenRouter** — pay-as-you-go, every major model
- **Anthropic** — Claude Haiku is cheap and excellent
- **NVIDIA NIM** — Llama 3.3 70B free with API key
- **Ollama (local)** — totally free, runs on your Mac

Without a key, OpenReply still collects + searches + builds the graph from
text signals. With a key, you also get Insights, Audience, Empathy maps,
synthesized launch briefs, etc.

### Add Reddit OAuth (higher rate limit)

Settings → Reddit credentials → Create Reddit app. Public JSON works at
60 req/min; OAuth gets you 100 req/min and richer post metadata. Five-minute
one-time setup.

---

## 5. Known limitations (beta)

| Limitation | Severity | Workaround |
|---|---|---|
| Gatekeeper warning on first launch (DMG is ad-hoc signed, not notarized) | Annoying | Right-click → Open the first time only |
| LLM key is optional, but Insights / Audience / Empathy maps are richer with one | Cosmetic | Add a free Groq or NVIDIA key |
| Some sources need long-running collects (~3-5 min on a fresh topic) | Slow | Let it finish; subsequent collects are incremental |
| MCP tools are 147 — Claude/Cursor may take a beat to enumerate them on first connect | Cosmetic | Wait ~30s after restart |
| Activation flow exists but is currently disabled | Informational | When we monetise, paid users will get an activation key. Beta users don't need one. |
| Email confirmation, password reset, magic links aren't wired yet | Informational | Resend SMTP runbook is queued for setup |

---

## 6. Reset OpenReply (if something gets stuck)

If the app gets into a weird state (especially after an upgrade), nuke the
local state and start fresh:

```bash
# Quit the app first (Cmd-Q)
rm -rf "$HOME/Library/WebKit/com.shantanu.openreply"          # browser localStorage
defaults delete com.shantanu.openreply 2>/dev/null            # native prefs
# (Data + DB at ~/Library/Application Support/com.shantanu.openreply/openreply/
#  is preserved — topics, posts, graph all survive.)
```

Re-open OpenReply → fresh 5-step wizard, your topics and collected data
intact.

To **also** wipe collected data (start completely over):

```bash
rm -rf "$HOME/Library/Application Support/com.shantanu.openreply"
```

---

## 7. Send feedback

You're a beta tester — your bug reports and "this is weird" comments are
the most valuable thing right now. Three ways:

- **In-app:** Settings → **Send feedback** opens a pre-filled email with
  your app version + OS so we have context.
- **GitHub Issues:** https://github.com/shaantanu98/reddit-myind/issues —
  best for repeatable bugs (paste the steps).
- **DM directly:** Whoever sent you the DMG. Screenshots welcome.

When you report:

- One issue per report (it's easier to ack/fix that way)
- Tell us what you did, what you expected, what actually happened
- If the app crashed, attach the file at
  `~/Library/Logs/OpenReply/<latest>.log` (the app will eventually have a
  one-click "Export logs" button — for now, find it in Finder).

---

## 8. What's next (roadmap glimpse)

| When | What |
|---|---|
| Right now (beta) | Five-step onboarding, all sidebar features, MCP + CLI install one-click, license gate off |
| ~ next week | Resend SMTP for confirmation / password reset, real Apple-notarized DMG, in-app updater |
| Once we monetise | Activation keys, Lemon Squeezy checkout, coupon codes, dashboard with billing |

The infrastructure for the "next week" + "monetise" rows is already built —
just gated behind flags. We're holding it back so beta testing isn't
gummed up by account flows.

---

## 9. Quick reference card

```
DMG installer location:    Your inbox / wherever the team sent it
App location:              /Applications/OpenReply.app
Data directory:            ~/Library/Application Support/com.shantanu.openreply/openreply/
                             ├─ openreply.db            (SQLite — posts, graph, findings)
                             └─ exports/             (markdown / docx / pptx outputs)
CLI binary (after install): /usr/local/bin/openreply
MCP config files written:  ~/.claude.json
                            ~/Library/Application Support/Claude/claude_desktop_config.json
                            ~/.cursor/mcp.json
                            (and Windsurf / Cline equivalents)
```

```
Reset onboarding:          rm -rf ~/Library/WebKit/com.shantanu.openreply
Full wipe (incl. data):    rm -rf ~/Library/Application\ Support/com.shantanu.openreply
View logs:                 ~/Library/Logs/Gap\ Map/
```

Thanks for testing. Tell us what breaks.
