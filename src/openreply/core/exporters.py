"""Export query results to JSON / CSV. Parquet is opt-in (needs pandas + pyarrow)."""
from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Iterable


def export_rows(
    rows: Iterable[dict[str, Any]],
    out_path: Path | str | None,
    fmt: str = "json",
) -> str:
    """Write rows. If out_path is None, returns serialized string (JSON/CSV)."""
    rows = list(rows)
    fmt = fmt.lower()

    if fmt == "json":
        payload = json.dumps(rows, default=str, ensure_ascii=False, indent=2)
        if out_path:
            Path(out_path).write_text(payload, encoding="utf-8")
            return str(out_path)
        return payload

    if fmt == "csv":
        if not rows:
            if out_path:
                Path(out_path).write_text("", encoding="utf-8")
                return str(out_path)
            return ""
        fieldnames = list(rows[0].keys())
        if out_path:
            with open(out_path, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fieldnames)
                w.writeheader()
                w.writerows(rows)
            return str(out_path)
        import io

        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)
        return buf.getvalue()

    if fmt == "parquet":
        try:
            import pandas as pd  # type: ignore[import-not-found]
        except ImportError as e:
            raise RuntimeError(
                "parquet export needs `pip install pandas pyarrow`"
            ) from e
        if not out_path:
            raise ValueError("parquet requires --out <path>")
        pd.DataFrame(rows).to_parquet(out_path, index=False)
        return str(out_path)

    raise ValueError(f"Unknown format: {fmt}. Use json, csv, or parquet.")
