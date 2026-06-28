# Data-Dir Single Source of Truth — Why / What / How

**Date:** 2026-04-21
**Status:** Shipped (this commit)
**Pairs with:** `docs/ops/mcp-lifecycle-strategy.md` — same class of cross-surface
contract problem.

---

## 1. Why — the problem

### 1.1 What the user saw

> "When using MCP, reports and all are being created at other locations.
> It should create them in the app location. All the data should be in
> one place so the app reflects the same state."

Concretely:

- Cursor opens a project at `~/code/my-project/`. User invokes
  `openreply_research_collect` via the OpenReply MCP. A new SQLite DB and
  palace folder get created at `~/code/my-project/data/`.
- Meanwhile, the desktop OpenReply app reads from
  `~/Library/Application Support/com.shantanu.openreply/reddit-myind/reddit.db`.
- The two DBs diverge. The desktop UI shows stale / empty state; the
  MCP just created findings that the UI can't see.
- User concludes: "the app is broken."

### 1.2 Root cause

`src/reddit_research/core/config.py::load_config` had this line:

```python
data_dir = Path(os.getenv("REDDIT_MYIND_DATA_DIR") or (Path.cwd() / "data")).expanduser()
```

Three call paths flow through it:

1. **Tauri desktop app** — spawns the sidecar with `REDDIT_MYIND_DATA_DIR`
   env set to its canonical app-data folder. Always lands in the right
   place.
2. **CLI run from repo root** (dev) — CWD is the repo, so CWD/data is
   gitignored and works.
3. **MCP server spawned by Cursor / Claude Code** — CWD is whatever
   folder the client was running in. **This is the bug.** Each client
   session creates a DIFFERENT DB folder based on where the user opened
   their editor.

`mcp/install.py::default_data_dir` had the same bug — when the MCP
installer wrote its token file, it landed next to wherever the CLI was
invoked. The server later looked for the token in the app's canonical
folder and didn't find it.

### 1.3 Why this matters for "single source of truth"

The desktop UI, the CLI, and the MCP server are three faces of the same
product. They MUST read + write the same SQLite file, the same palace
store, the same exports folder. Otherwise:

- Data created via one surface is invisible to the others.
- Soft-delete trash / saved views / feedback / custom prompts fragment
  across N folders.
- The user can't reason about where their data actually lives.
- Backup / migration / reset are all broken.

---

## 2. What we shipped

### 2.1 `_resolve_data_dir()` — the single source of truth

New helper in `src/reddit_research/core/config.py`. Resolution order:

1. **`REDDIT_MYIND_DATA_DIR` env var** — explicit override (Tauri sidecar
   still sets this; tests monkeypatch it).
2. **Platform app-data folder** — matches what Tauri's
   `app.path().app_data_dir()` returns on each OS:
   - **macOS:** `~/Library/Application Support/com.shantanu.openreply/reddit-myind`
   - **Linux:** `$XDG_DATA_HOME/com.shantanu.openreply/reddit-myind`
     (falls back to `~/.local/share/...`)
   - **Windows:** `%APPDATA%\com.shantanu.openreply\reddit-myind`
3. **Legacy `~/.config/reddit-myind/data`** — for installs created
   before the Tauri bundle existed.
4. **CWD `./data`** — absolute last resort, emits a `warnings.warn` so
   devs notice if they accidentally land here.

The bundle ID (`com.shantanu.openreply`) is hardcoded to match
`tauri.conf.json`. This keeps the Python side independent of Tauri IPC
— we don't need the Rust runtime to tell us where to go.

### 2.2 Every entry point goes through the resolver

- `core/config.py::load_config()` — one-line change to use
  `_resolve_data_dir()`.
- `mcp/install.py::default_data_dir()` — now delegates to
  `_resolve_data_dir`. Means the MCP installer writes the token file
  into the SAME folder the MCP server reads it from, regardless of CWD.
- `mcp/server.py::_pidfile_path()` — uses `_resolve_data_dir()` so the
  PID-file lock (Guard 1 from the zombie-fix) is always in the canonical
  folder.

### 2.3 Verified convergence

```bash
$ cd /tmp
$ python -c "
import os; os.environ.pop('REDDIT_MYIND_DATA_DIR', None)
from reddit_research.core.config import _resolve_data_dir, load_config
from reddit_research.mcp.server import _pidfile_path
from reddit_research.mcp.install import default_data_dir

print(_resolve_data_dir())
print(load_config().data_dir)
print(default_data_dir())
print(_pidfile_path())
"
/Users/x/Library/Application Support/com.shantanu.openreply/reddit-myind
/Users/x/Library/Application Support/com.shantanu.openreply/reddit-myind
/Users/x/Library/Application Support/com.shantanu.openreply/reddit-myind
/Users/x/Library/Application Support/com.shantanu.openreply/reddit-myind/mcp-server.pid
```

Four different code paths, called from `/tmp`, all land in the exact
same canonical folder.

---

## 3. How — implementation details

### 3.1 Why a pure-Python resolver (no Tauri IPC)

The Python side shouldn't need to phone the Rust side to find out where
to write data. That would mean:

- Python can't run standalone (tests, `reddit-cli ...` commands,
  batch jobs).
- A cold-start dependency cycle: Python needs dir → asks Tauri →
  Tauri spawns Python → Python asks...

Instead, both sides independently resolve to the same platform-standard
path. This is the conventional answer:

- `tauri_plugin::path::app_data_dir()` on Rust
- Hardcoded platform logic in `_canonical_app_data_dir()` on Python

If the bundle ID ever changes in `tauri.conf.json`, update the constant
in `config.py` (`_TAURI_BUNDLE_ID`). That's the only coupling.

### 3.2 Why we didn't just require the env var

We could've said "always set `REDDIT_MYIND_DATA_DIR` externally." But:

- MCP clients (Cursor, Claude Code) spawn subprocesses with whatever
  env they inherit. Users would have to set the env globally in their
  shell, which is fragile and user-hostile.
- Tests need to override the dir per-test. Forcing env is inflexible.
- The Tauri sidecar can still override when it has context; the Python
  side just has a good default when nothing overrides.

So: the env var is still honored (step 1 of resolution), but we no
longer REQUIRE it.

### 3.3 Why not XDG-compliant paths on macOS

Tauri's `app_data_dir()` on macOS uses `~/Library/Application Support/<bundle>/`
— NOT XDG paths. Even though some dotfile tools default to XDG on macOS,
following Tauri's convention means:

- The desktop app and the MCP server land in the same directory by
  default (no config needed).
- The user can "Reveal in Finder" from the app and actually find their
  data.
- Standard macOS backup / migration tools see it.

### 3.4 Migration concern — existing dev data

If you had data under `<repo>/data/` from previous dev runs, the new
resolver won't find it. Options:

- **Nothing** — the old folder sits there unused; dev can delete it.
- **One-time symlink** — `ln -s <repo>/data ~/Library/Application\ Support/com.shantanu.openreply/reddit-myind`
  if you want the old data visible.
- **Copy** — `cp -R <repo>/data/* ~/Library/Application\ Support/com.shantanu.openreply/reddit-myind/`.

Production installs never had `<repo>/data/` — they always shipped with
the Tauri sidecar setting the env. So this only affects developers.

### 3.5 The absolute-last-resort CWD fallback

Step 4 of resolution still hits `Path.cwd() / "data"` if:

- Home dir is unwritable (weird ro-filesystem CI).
- Platform isn't darwin / linux / win (BSD, anything).

We emit a `warnings.warn(...)` so devs see a yellow line if they
accidentally land here. The warning includes an explicit "set
REDDIT_MYIND_DATA_DIR to pin to a canonical location" instruction.

---

## 4. How to test

### 4.1 Smoke test — run from an arbitrary CWD

```bash
cd /tmp
PY=/path/to/reddit-myind/.venv/bin/python

# Without env override, should still resolve to app-data
unset REDDIT_MYIND_DATA_DIR
$PY -c "
from reddit_research.core.config import _resolve_data_dir, load_config
from reddit_research.mcp.install import default_data_dir
from reddit_research.mcp.server import _pidfile_path
for fn, label in [
    (_resolve_data_dir, '_resolve_data_dir'),
    (lambda: load_config().data_dir, 'load_config'),
    (default_data_dir, 'install.default_data_dir'),
    (_pidfile_path, 'server._pidfile_path'),
]:
    print(f'{label:40s} {fn()}')
"
```

Expected: every line ends with
`com.shantanu.openreply/reddit-myind` (or the pid file thereof).

### 4.2 Env override test

```bash
REDDIT_MYIND_DATA_DIR=/tmp/custom $PY -c "
from reddit_research.core.config import _resolve_data_dir
print(_resolve_data_dir())
"
# Expected: /tmp/custom
```

### 4.3 Cross-surface integration test (manual)

1. Open OpenReply desktop app → create a topic "testA".
2. From a different CWD, open Cursor. Invoke `openreply_get_corpus(topic='testA')`.
3. Should return the rows created in step 1. If it returns empty → the
   MCP is reading the wrong DB → this fix isn't applied.

### 4.4 Existing regression suite

```bash
pytest tests/test_tier_quality_pass.py tests/test_integration_tier_e2e.py -q
```

21/21 still green — tests themselves use
`REDDIT_MYIND_DATA_DIR` override in `conftest` so they're insulated.

---

## 5. How to extend

### 5.1 Exports, reports, cached files

The new resolver covers `data_dir`. Anything written under `data_dir`
(SQLite, palace, exports/, reports/, byok.json, schedule.log) is
automatically correct.

Anything written elsewhere — logs in `/var/log`, cache in
`~/Library/Caches` — is still a different story. Today none of the
Python side writes outside `data_dir`. If we add new write locations,
they should go through a helper like:

```python
def _cache_dir() -> Path:
    # Analogous to _resolve_data_dir but for caches
    ...
```

Keep each class of file in one subfolder under the canonical path.

### 5.2 Bundle-ID change

If we ever rename the app (rebrand, fork), update:

- `app-tauri/src-tauri/tauri.conf.json` — `identifier` field
- `src/reddit_research/core/config.py` — `_TAURI_BUNDLE_ID` constant

These two strings MUST match.

### 5.3 Multi-profile / multi-tenant

If a future version ships "multiple profiles" (e.g. "work vs personal
research"), pass the profile name as env:

```bash
REDDIT_MYIND_DATA_DIR="$HOME/Library/Application Support/com.shantanu.openreply/reddit-myind/profiles/work"
```

The resolver already honors the env. No code change — just a UI
affordance to pick a profile at launch and set the env for the session.

---

## 6. Env-var reference

| Var | Default | Effect |
|---|---|---|
| `REDDIT_MYIND_DATA_DIR` | auto-resolved | Force this exact folder for all file I/O |
| `REDDIT_MYIND_PROMPTS_DIR` | bundled / CWD | Override for extractor YAML files |
| `XDG_DATA_HOME` (Linux) | `~/.local/share` | Linux base for step-2 resolution |
| `APPDATA` (Windows) | `%APPDATA%` | Windows base for step-2 resolution |

---

## 7. Failure-mode playbook

### "My MCP-generated data isn't showing in the app"

- **Cause:** user is on a pre-fix build. MCP server was writing to its
  CWD's `data/` folder.
- **Fix:** update to this build.
- **Recover old data:** find the orphan folders:
  ```bash
  find ~ -name "reddit.db" -not -path "*/Library/Application*" 2>/dev/null
  ```
  Copy rows from each orphan DB into the canonical one, OR manually
  re-collect the topics that matter.

### "Dev: my test writes are landing in the wrong place"

- **Cause:** you forgot to set `REDDIT_MYIND_DATA_DIR` in your test
  fixture.
- **Fix:** use `tmp_path` fixture and set the env before importing
  `reddit_research.core.db`. Pattern:
  ```python
  @pytest.fixture
  def isolated_db(tmp_path, monkeypatch):
      monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", str(tmp_path))
      from reddit_research.core.db import get_db
      get_db.cache_clear()  # bust the thread-local
      yield get_db()
      get_db.cache_clear()
  ```

### "CI runner is dying with 'cannot create data_dir'"

- **Cause:** ephemeral Docker container with no writable HOME.
- **Fix:** set `REDDIT_MYIND_DATA_DIR=/tmp/openreply` in the CI job.

---

## 8. Follow-ups

### 8.1 Add `researcher --where` CLI command

A one-liner diagnostic:

```bash
reddit-cli where
# → data_dir: /Users/.../com.shantanu.openreply/reddit-myind
#    db     : /Users/.../reddit.db         (128 MB)
#    palace : /Users/.../palace/            (45 MB)
#    exports: /Users/.../exports/           (12 MB)
```

Then `ps aux | grep mcp` + `reddit-cli where` is a full ops probe.

### 8.2 Migration helper

`reddit-cli migrate-data-dir --from <old> --to <current>` to merge a
CWD-local `data/` folder (from a pre-fix install) into the canonical
folder. Useful for users who accumulated orphans.

### 8.3 "Reveal in Finder" shortcut

Settings → "Show my data folder" button already exists on the desktop
(wires `api.appDataDir()` + `reveal_in_finder`). Confirm it opens the
path the resolver returns — should be automatic since both resolve the
same way.

### 8.4 Add resolver tests to CI

Pytest case that verifies `_resolve_data_dir()` returns the expected
platform-specific path, from different CWDs, with and without the env
override. Sketched below; add to `tests/test_tier_quality_pass.py`:

```python
def test_resolver_honors_env(monkeypatch):
    from reddit_research.core.config import _resolve_data_dir
    monkeypatch.setenv("REDDIT_MYIND_DATA_DIR", "/tmp/custom-openreply")
    assert str(_resolve_data_dir()) == "/tmp/custom-openreply"

def test_resolver_falls_back_to_app_data(monkeypatch):
    from reddit_research.core.config import _resolve_data_dir
    import sys
    monkeypatch.delenv("REDDIT_MYIND_DATA_DIR", raising=False)
    result = str(_resolve_data_dir())
    assert "com.shantanu.openreply" in result
    assert "reddit-myind" in result
```

---

## 9. Summary table — all entry points

| Caller | CWD at spawn time | Used to land at | Now lands at |
|---|---|---|---|
| Desktop app sidecar | any | app-data (env set) | app-data (unchanged) |
| CLI from repo root | repo | `repo/data/` | **app-data** ✅ |
| CLI from elsewhere | ~/ | `~/data/` | **app-data** ✅ |
| MCP server via Cursor | user project dir | `project/data/` | **app-data** ✅ |
| MCP server via Claude Desktop | home dir | `~/data/` | **app-data** ✅ |
| MCP install token writer | wherever | `wherever/data/` | **app-data** ✅ |
| Tests | pytest rootdir | unpredictable | explicit `tmp_path` via env |

One physical folder, all logical writers converging — single source of
truth achieved.

---

*Last updated: 2026-04-21. If the bundle ID or app name changes, update
this doc + `_TAURI_BUNDLE_ID` + `tauri.conf.json` in sync.*
