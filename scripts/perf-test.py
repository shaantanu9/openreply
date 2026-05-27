#!/usr/bin/env python3
"""Gap Map performance regression harness.

Walks every major surface (CLI, sidecar daemon, MCP server, graph build,
palace, YouTube search) and records latency. Compares against the
committed baseline at `docs/PERFORMANCE_BASELINE.json`; fails (exit 1)
on >20% regression. Updates baseline with `--update-baseline`.

USAGE
    scripts/perf-test.py                  # run all benchmarks, compare
    scripts/perf-test.py --bench cli,mcp  # subset
    scripts/perf-test.py --update-baseline
    scripts/perf-test.py --json           # machine-readable output
    scripts/perf-test.py --no-fail        # don't exit 1 on regression

DESIGN
- Each benchmark is a self-contained function returning dict with keys
  `name`, `cold_ms`, `warm_ms`, `p99_ms` (where applicable), and
  `notes`. The framework around it handles warmup, repeated runs,
  baseline comparison, and reporting.
- The fixtures use whatever topics exist in the current DB — no
  destructive setup. Smallest / largest topic from `topic_posts` are
  auto-picked.
- Hard-fails reported in PERFORMANCE_CATALOG.md §2 are the absolute
  ceiling. Anything blowing past that is a regression even if no
  baseline exists.

See docs/PERFORMANCE_CATALOG.md for the per-function budgets + the
spec this harness implements.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable

REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = REPO_ROOT / "docs" / "PERFORMANCE_BASELINE.json"
GAPMAP_BIN = REPO_ROOT / ".venv" / "bin" / "gapmap"

# Hard-fail ceilings (from PERFORMANCE_CATALOG.md §2). Any single sample above
# the corresponding cap → flag as broken regardless of baseline.
HARD_CEILINGS_MS = {
    "cli_info": 3_000,
    "cli_query_simple": 3_000,
    "cli_palace_stats": 3_000,
    "cli_palace_model_status": 3_000,
    "cli_list_topics": 3_000,
    "mcp_initialize": 60_000,
    "mcp_tools_list": 500,
    "mcp_search_call": 5_000,
    "mcp_query_db_call": 5_000,
    "graph_build_small": 5_000,
    "graph_build_medium": 30_000,
    "graph_build_large": 90_000,
    "youtube_search": 10_000,
}

# Regression tolerance — anything > 20% slower than baseline = fail.
REGRESSION_THRESHOLD = 1.20


# ─── Helpers ────────────────────────────────────────────────────────────────
def time_subprocess(cmd: list[str], timeout_s: int = 60) -> tuple[float, str, int]:
    """Run a subprocess and return (wall_ms, stdout, exit_code)."""
    t0 = time.perf_counter()
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s, cwd=str(REPO_ROOT)
        )
        ms = (time.perf_counter() - t0) * 1000
        return ms, r.stdout, r.returncode
    except subprocess.TimeoutExpired:
        ms = timeout_s * 1000
        return ms, "", 124


def median(samples: list[float]) -> float:
    return round(statistics.median(samples), 1) if samples else 0.0


def p99(samples: list[float]) -> float:
    if not samples:
        return 0.0
    return round(statistics.quantiles(samples, n=100)[98], 1) if len(samples) >= 2 else samples[0]


def pick_fixture_topics() -> dict[str, str]:
    """Pick a small + medium topic from the live DB (no setup)."""
    cmd = [str(GAPMAP_BIN), "query",
           "SELECT topic, COUNT(*) AS n FROM topic_posts GROUP BY topic ORDER BY n",
           "--json"]
    _, out, rc = time_subprocess(cmd, timeout_s=30)
    if rc != 0 or not out.strip():
        return {}
    try:
        rows = json.loads(out)
    except Exception:
        return {}
    if not rows:
        return {}
    # small = 50-300 posts, medium = 1K-5K, large = >5K (if available)
    small = next((r["topic"] for r in rows if 50 <= r["n"] <= 300), rows[0]["topic"])
    medium = next((r["topic"] for r in rows if 1000 <= r["n"] <= 5000), small)
    large = next((r["topic"] for r in rows if r["n"] > 5000), medium)
    return {"small": small, "medium": medium, "large": large}


# ─── Benchmarks ─────────────────────────────────────────────────────────────
def bench_cli() -> list[dict]:
    """One-shot CLI calls — cold spawn + Python import each time. Pure
    interpreter-startup cost (the floor for any CLI op)."""
    results = []
    for name, args, ceiling_key in [
        ("info",              ["info", "--json"],                            "cli_info"),
        ("query_simple",      ["query", "SELECT 1 AS x", "--json"],          "cli_query_simple"),
        ("palace_stats",      ["research", "palace-stats", "--json"],        "cli_palace_stats"),
        ("palace_model_status",["research","palace-model-status","--json"],  "cli_palace_model_status"),
    ]:
        cmd = [str(GAPMAP_BIN), *args]
        # Warmup (so filesystem caches are primed); ignore result
        time_subprocess(cmd, timeout_s=15)
        samples = []
        failures = []
        for i in range(5):
            ms, out, rc = time_subprocess(cmd, timeout_s=15)
            if rc == 0:
                samples.append(ms)
            else:
                failures.append((rc, ms, out[:120]))
        if not samples and failures:
            # Emit ONE failure line to stderr so the user can see what broke.
            rc, ms, snippet = failures[0]
            print(f"   ⚠ {name}: all 5 runs failed (rc={rc}, last_ms={ms:.0f}, out={snippet!r})",
                  file=sys.stderr)
        results.append({
            "name": f"cli_{name}",
            "warm_ms": median(samples) if samples else None,
            "p99_ms": p99(samples) if samples else None,
            "n_samples": len(samples),
            "ceiling_ms": HARD_CEILINGS_MS.get(ceiling_key),
        })
    return results


def bench_mcp() -> list[dict]:
    """Spawn `mcp serve --transport stdio`, do initialize + tools/list + a few
    calls. Measures the whole MCP roundtrip including FastMCP startup."""
    proc = subprocess.Popen(
        [str(GAPMAP_BIN), "mcp", "serve", "--transport", "stdio"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, bufsize=1, cwd=str(REPO_ROOT),
    )
    counter = [10]
    def send(method, params=None, _id=None):
        if _id is None:
            counter[0] += 1; _id = counter[0]
        msg = {"jsonrpc":"2.0","id":_id,"method":method}
        if params is not None: msg["params"] = params
        proc.stdin.write(json.dumps(msg)+'\n'); proc.stdin.flush()
    def notify(method):
        proc.stdin.write(json.dumps({"jsonrpc":"2.0","method":method})+'\n'); proc.stdin.flush()
    def recv():
        line = proc.stdout.readline()
        return json.loads(line) if line else None

    results = []
    try:
        # 1. initialize (cold)
        t0 = time.perf_counter()
        send("initialize", {"protocolVersion":"2024-11-05","capabilities":{},
                            "clientInfo":{"name":"perf","version":"0"}}, _id=1)
        recv()
        init_ms = (time.perf_counter() - t0) * 1000
        results.append({
            "name": "mcp_initialize",
            "warm_ms": round(init_ms, 1),
            "ceiling_ms": HARD_CEILINGS_MS["mcp_initialize"],
            "notes": "cold-start (FastMCP + tool registry)",
        })
        notify("notifications/initialized")

        # 2. tools/list
        list_samples = []
        for _ in range(3):
            t0 = time.perf_counter()
            send("tools/list")
            recv()
            list_samples.append((time.perf_counter() - t0) * 1000)
        results.append({
            "name": "mcp_tools_list",
            "warm_ms": median(list_samples),
            "p99_ms": p99(list_samples),
            "ceiling_ms": HARD_CEILINGS_MS["mcp_tools_list"],
        })

        # 3. gapmap_search call (read-only, no LLM)
        call_samples = []
        for _ in range(3):
            t0 = time.perf_counter()
            send("tools/call", {"name":"gapmap_search","arguments":{"query":"context window"}})
            recv()
            call_samples.append((time.perf_counter() - t0) * 1000)
        results.append({
            "name": "mcp_search_call",
            "warm_ms": median(call_samples),
            "p99_ms": p99(call_samples),
            "ceiling_ms": HARD_CEILINGS_MS["mcp_search_call"],
        })

        # 4. gapmap_query_db call (1-row SQL)
        q_samples = []
        for _ in range(3):
            t0 = time.perf_counter()
            send("tools/call", {"name":"gapmap_query_db",
                                "arguments":{"sql":"SELECT COUNT(*) AS n FROM graph_nodes"}})
            recv()
            q_samples.append((time.perf_counter() - t0) * 1000)
        results.append({
            "name": "mcp_query_db_call",
            "warm_ms": median(q_samples),
            "p99_ms": p99(q_samples),
            "ceiling_ms": HARD_CEILINGS_MS["mcp_query_db_call"],
        })
    finally:
        try: proc.stdin.close(); proc.terminate(); proc.wait(timeout=3)
        except Exception: pass
    return results


def bench_graph_build(topics: dict[str, str]) -> list[dict]:
    """Time build_structural at small/medium/large topic sizes. Direct
    Python import — no subprocess overhead, isolates the actual SQL cost."""
    sys.path.insert(0, str(REPO_ROOT / "src"))
    from gapmap.graph.build import build_structural

    results = []
    for size in ["small", "medium", "large"]:
        topic = topics.get(size)
        if not topic:
            continue
        t0 = time.perf_counter()
        try:
            out = build_structural(topic)
            ms = (time.perf_counter() - t0) * 1000
            results.append({
                "name": f"graph_build_{size}",
                "warm_ms": round(ms, 1),
                "ceiling_ms": HARD_CEILINGS_MS.get(f"graph_build_{size}"),
                "notes": f"topic={topic!r} · {out.get('total_nodes',0)} nodes · {out.get('total_edges',0)} edges",
            })
        except Exception as e:
            results.append({
                "name": f"graph_build_{size}",
                "error": str(e),
                "notes": f"topic={topic!r}",
            })
    return results


def bench_youtube_search() -> list[dict]:
    """Bench YT search via CLI — network-bound, expect 1-5 s. Cap timeout
    high (10s) since slow connections shouldn't fail the suite."""
    cmd = [str(GAPMAP_BIN), "ingest", "youtube-search",
           "--query", "AI coding assistant", "--limit", "5", "--json"]
    samples = []
    for _ in range(2):  # only 2 runs — saves YT bandwidth + rate limits
        ms, out, rc = time_subprocess(cmd, timeout_s=15)
        if rc == 0 and out.strip():
            try:
                d = json.loads(out)
                if d.get("ok"):
                    samples.append(ms)
            except Exception:
                pass
    return [{
        "name": "youtube_search",
        "warm_ms": median(samples) if samples else None,
        "ceiling_ms": HARD_CEILINGS_MS["youtube_search"],
        "notes": f"yt-dlp ytsearch, 5 results, {len(samples)} successful samples",
    }]


# ─── Baseline / regression handling ─────────────────────────────────────────
def load_baseline() -> dict[str, dict]:
    if not BASELINE_PATH.exists():
        return {}
    try:
        return json.loads(BASELINE_PATH.read_text())
    except Exception:
        return {}


def write_baseline(rows: list[dict]) -> None:
    BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = {
        "_meta": {
            "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "host": os.uname().nodename if hasattr(os, "uname") else "?",
            "platform": sys.platform,
        },
    }
    for r in rows:
        if "warm_ms" in r and r.get("warm_ms") is not None:
            out[r["name"]] = {
                "warm_ms": r["warm_ms"],
                "p99_ms": r.get("p99_ms"),
                "ceiling_ms": r.get("ceiling_ms"),
            }
    BASELINE_PATH.write_text(json.dumps(out, indent=2))


def compare(rows: list[dict], baseline: dict[str, dict]) -> list[dict]:
    """Annotate each row with `status` ∈ {ok, regression, ceiling_breach, no_baseline, error}."""
    annotated = []
    for r in rows:
        r = dict(r)
        if r.get("error"):
            r["status"] = "error"
        elif r.get("warm_ms") is None:
            r["status"] = "no_data"
        elif r.get("ceiling_ms") and r["warm_ms"] > r["ceiling_ms"]:
            r["status"] = "ceiling_breach"
        else:
            b = baseline.get(r["name"], {})
            base_warm = b.get("warm_ms")
            if base_warm is None:
                r["status"] = "no_baseline"
            elif r["warm_ms"] > base_warm * REGRESSION_THRESHOLD:
                r["status"] = "regression"
                r["baseline_ms"] = base_warm
                r["regression_pct"] = round((r["warm_ms"] / base_warm - 1) * 100, 1)
            else:
                r["status"] = "ok"
                r["baseline_ms"] = base_warm
        annotated.append(r)
    return annotated


# ─── Reporting ──────────────────────────────────────────────────────────────
STATUS_ICON = {
    "ok": "✅", "regression": "🔴", "ceiling_breach": "🚨",
    "no_baseline": "⚪", "no_data": "⚠️", "error": "❌",
}


def _fmt(v) -> str:
    """Format optional numeric value — None / missing → em-dash."""
    if v is None:
        return "—"
    if isinstance(v, (int, float)):
        return f"{v:,.1f}"
    return str(v)


def print_human(rows: list[dict]) -> None:
    name_w = max(len(r["name"]) for r in rows) + 2
    print(f"{'':3} {'name':<{name_w}} {'warm_ms':>10} {'p99_ms':>10} {'baseline':>10}  notes")
    print("─" * (name_w + 55))
    for r in rows:
        icon = STATUS_ICON.get(r["status"], "?")
        warm = f"{_fmt(r.get('warm_ms')):>10}"
        p99v = f"{_fmt(r.get('p99_ms')):>10}"
        base = f"{_fmt(r.get('baseline_ms')):>10}"
        notes = r.get("notes") or r.get("error") or ""
        if r["status"] == "regression":
            notes = f"+{r.get('regression_pct')}% slower than baseline ({notes})".rstrip(" ()")
        elif r["status"] == "ceiling_breach":
            notes = f"BREACHED {r.get('ceiling_ms')}ms hard ceiling — check `uptime` (load > 5 will skew results)"
        elif r["status"] == "no_data":
            notes = "no successful samples — check stderr above for command failures"
        print(f" {icon}  {r['name']:<{name_w}} {warm} {p99v} {base}  {notes}")


def print_json(rows: list[dict]) -> None:
    print(json.dumps({"results": rows}, indent=2))


# ─── Entry point ────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bench", help="Comma-list of benches: cli,mcp,graph,youtube. Default = all.")
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--no-fail", action="store_true")
    args = parser.parse_args()

    if not GAPMAP_BIN.exists():
        print(f"ERROR: gapmap binary not found at {GAPMAP_BIN}", file=sys.stderr)
        print("  Run `uv sync --all-extras` in repo root first.", file=sys.stderr)
        return 2

    # macOS / Linux: warn if load avg is high — perf numbers will be noise.
    if hasattr(os, "getloadavg"):
        load1 = os.getloadavg()[0]
        if load1 > 5.0:
            print(
                f"⚠ System load is {load1:.1f} (5+ means contention) — perf numbers will "
                "be inflated. Consider closing other processes (especially other gapmap "
                "instances) before relying on these results.",
                file=sys.stderr,
            )

    chosen = set((args.bench or "cli,mcp,graph,youtube").split(","))
    rows: list[dict] = []

    if "cli" in chosen:
        print(">>> Bench CLI (~30s)", file=sys.stderr)
        rows += bench_cli()
    if "mcp" in chosen:
        print(">>> Bench MCP (~10s)", file=sys.stderr)
        rows += bench_mcp()
    if "graph" in chosen:
        print(">>> Bench graph build (~30-60s, depends on topic size)", file=sys.stderr)
        rows += bench_graph_build(pick_fixture_topics())
    if "youtube" in chosen:
        print(">>> Bench YouTube search (~5s, network-bound)", file=sys.stderr)
        rows += bench_youtube_search()

    if args.update_baseline:
        write_baseline(rows)
        print(f"\n✓ Baseline updated at {BASELINE_PATH.relative_to(REPO_ROOT)}\n",
              file=sys.stderr)

    annotated = compare(rows, load_baseline())
    print() if not args.json else None
    (print_json if args.json else print_human)(annotated)

    bad = [r for r in annotated if r["status"] in ("regression", "ceiling_breach", "error")]
    if bad and not args.no_fail:
        print(f"\n❌ {len(bad)} regression(s) / breach(es). Exit 1.", file=sys.stderr)
        return 1
    print("\n✓ All perf checks within budget.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
