# Graph HTML escape fix

## What was broken

- Exported graph HTML could fail to load because the JavaScript `esc()` helper had an invalid key for the double-quote entity (`&quot;`) in one generated file.
- When that syntax error appears, the browser stops parsing the script, so D3 graph rendering never starts.

## What we corrected

### 1) Fixed the generated HTML file

- File: `/Users/shantanubombatkar/Downloads/demo_grapgh.html`
- Corrected the invalid object key in `esc()`:
  - from `""":"&quot;`
  - to a valid double-quote key

### 2) Applied the same fix in app graph creation code

- File: `src/reddit_research/graph/export.py`
- Updated exporter template JavaScript to use a safer map-based escape strategy:
  - Added `ESC_MAP`
  - Assigned double-quote entity using bracket notation (`ESC_MAP['"'] = "&quot;"`)
  - `esc()` now resolves replacements through `ESC_MAP[c]`

This prevents fragile inline quoting from reintroducing syntax issues in future exported graph HTML files.
