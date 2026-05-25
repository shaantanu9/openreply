# Gap Map — Beta tester guide

Thanks for testing Gap Map. This page is the only thing you need — install,
first-launch, the five most useful features, and how to send feedback.

> **5-minute goal:** install the app, run one topic, look at the gap map.
> Everything else is optional.

---

## 1. Install (2 minutes)

> **⚠️ Important:** You **must** drag the app to `/Applications` before
> opening it. Double-clicking Gap Map directly inside the mounted DMG
> will cause the app to crash on startup with a `SIGBUS / KERN_MEMORY_ERROR`
> — a known macOS limitation when WebKit-based apps run off a read-only
> disk image. Drag to `/Applications`, eject the DMG, then launch.

1. Download the DMG you were sent. It's named `Gap Map_0.1.0_aarch64.dmg`
   (about 159 MB).
2. Double-click the DMG. A Finder window opens with **Gap Map.app** and an
   **Applications** shortcut.
3. **DRAG `Gap Map.app` onto the `Applications` shortcut** that's in the
   DMG window. Wait ~5 seconds for the copy to finish.
4. **Eject the DMG** — right-click the "Gap Map" volume in Finder's
   sidebar → Eject (or drag the volume icon to the Trash).
5. Open `Applications` (Cmd-Shift-A in Finder) → find **Gap Map** → open
   from there.

If Gap Map crashes immediately on first launch, you almost certainly
opened it from the mounted DMG instead of from `/Applications`. See the
warning above. Re-mount, drag, eject, open from `/Applications`.

### macOS Gatekeeper warning (one-time)

The first time you open Gap Map, macOS will warn you because the app isn't
notarized by Apple (we'll fix that for the public release):

> *"Gap Map" cannot be opened because the developer cannot be verified.*

To bypass:

- **Right-click** (or Control-click) on Gap Map.app → choose **Open**
- In the dialog, click **Open** again

After this one time, double-click launches normally.

If the dialog doesn't offer Open, this Terminal command also works:

```bash
xattr -d com.apple.quarantine /Applications/Gap\ Map.app
```

Then double-click as usual.

---

## 2. First launch — the 5-step wizard

When Gap Map opens for the first time you'll see a wizard:

1. **What is Gap Map** — a one-screen overview. Next →
2. **Your profile** — your name (used in exports). Next →
3. **Connect sources** — *all optional*. You can:
   - Add an **LLM API key** (Anthropic / OpenAI / Groq / DeepSeek / Mistral /
     Google / OpenRouter / NVIDIA), OR
   - Install **Ollama** for free local LLM, OR
   - Skip entirely — Gap Map works without an LLM, just with fewer auto-
     extracted insights.
   - (Optional) Connect **Reddit OAuth** for higher rate limits. Public-JSON
     fallback works without it.
   Next →
4. **Video transcription** — only relevant if you'll ingest podcasts/YouTube.
   Skip if not. Next →
5. **Your first topic** — type any product idea or research area
   (e.g. `meditation apps`, `AI coding assistants`, `resume builders`).
   **Continue** kicks off a collect.

You land on the topic collect screen. Gap Map starts fetching from Reddit,
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

### d. **Sources** — every post Gap Map collected
SQL-queryable, sortable, filterable. Click a row to read the original.

### e. **Search** (left sidebar → Search)
Across all topics you've created. Try a vague phrase like
"writing tools that respect long form" — Gap Map returns posts, gaps, and
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

### Install the `gapmap` CLI in your terminal

Settings → **Command line tool** → **Install command line tool**. macOS
prompts for your password (admin needed to write to `/usr/local/bin`). After
that, `gapmap` works from any terminal:

```bash
gapmap research collect --topic "AI coding assistants"
gapmap query "SELECT count(*) FROM posts"
gapmap research search-all --query "vibe coding"
```

Full reference: run `gapmap --help` or see `CLI_REFERENCE.md` in the repo.

### Install Gap Map as an MCP server in Claude Code / Cursor / Claude Desktop

This is the **big one for AI-coding workflows.** Once installed, 147
`gapmap_*` tools appear inside your MCP client — you can ask Claude to
search your corpus, find painpoints, build personas, etc. from inside any
conversation.

From the app's Settings → MCP → **Connect to Claude Code** (or your client).
Restart your MCP client. The `mcp__gapmap__*` tools appear automatically.

If your client isn't auto-detected, run the install manually:

```bash
gapmap mcp install --client claude-code        # ~/.claude.json
gapmap mcp install --client cursor             # ~/.cursor/mcp.json
gapmap mcp install --client claude-desktop     # macOS Claude Desktop config
gapmap mcp install --client windsurf
gapmap mcp install --client cline              # Cline VSCode extension
```

### Add a (free) LLM key for the auto-insights

Settings → BYOK → pick a provider. Cheapest options:
- **Groq** — free tier, fast (Llama 3.3 70B)
- **OpenRouter** — pay-as-you-go, every major model
- **Anthropic** — Claude Haiku is cheap and excellent
- **NVIDIA NIM** — Llama 3.3 70B free with API key
- **Ollama (local)** — totally free, runs on your Mac

Without a key, Gap Map still collects + searches + builds the graph from
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

## 6. Reset Gap Map (if something gets stuck)

If the app gets into a weird state (especially after an upgrade), nuke the
local state and start fresh:

```bash
# Quit the app first (Cmd-Q)
rm -rf "$HOME/Library/WebKit/com.shantanu.gapmap"          # browser localStorage
defaults delete com.shantanu.gapmap 2>/dev/null            # native prefs
# (Data + DB at ~/Library/Application Support/com.shantanu.gapmap/gapmap/
#  is preserved — topics, posts, graph all survive.)
```

Re-open Gap Map → fresh 5-step wizard, your topics and collected data
intact.

To **also** wipe collected data (start completely over):

```bash
rm -rf "$HOME/Library/Application Support/com.shantanu.gapmap"
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
  `~/Library/Logs/Gap Map/<latest>.log` (the app will eventually have a
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
App location:              /Applications/Gap Map.app
Data directory:            ~/Library/Application Support/com.shantanu.gapmap/gapmap/
                             ├─ gapmap.db            (SQLite — posts, graph, findings)
                             └─ exports/             (markdown / docx / pptx outputs)
CLI binary (after install): /usr/local/bin/gapmap
MCP config files written:  ~/.claude.json
                            ~/Library/Application Support/Claude/claude_desktop_config.json
                            ~/.cursor/mcp.json
                            (and Windsurf / Cline equivalents)
```

```
Reset onboarding:          rm -rf ~/Library/WebKit/com.shantanu.gapmap
Full wipe (incl. data):    rm -rf ~/Library/Application\ Support/com.shantanu.gapmap
View logs:                 ~/Library/Logs/Gap\ Map/
```

Thanks for testing. Tell us what breaks.
