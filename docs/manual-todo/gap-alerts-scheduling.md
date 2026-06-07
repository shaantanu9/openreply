# Gap Alerts — scheduling the periodic check (manual)

The alerts engine (`gapmap research gap-alerts --action check`) evaluates every
enabled alert and records fired events. The app/CLI provides a "Check now"
button, but for *unattended* monitoring it must run on a schedule. This is the
only non-automatable part — pick one:

## macOS — launchd (recommended)

- [ ] Create `~/Library/LaunchAgents/ai.myind.gapmap.alerts.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.myind.gapmap.alerts</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string><string>-c</string>
    <string>cd /ABSOLUTE/PATH/TO/reddit-myind && uv run gapmap research gap-alerts --action check</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/gapmap-alerts.log</string>
  <key>StandardErrorPath</key><string>/tmp/gapmap-alerts.err</string>
</dict></plist>
```

- [ ] `launchctl load ~/Library/LaunchAgents/ai.myind.gapmap.alerts.plist`
- [ ] Verify next morning: `cat /tmp/gapmap-alerts.log`

## Linux — cron

- [ ] `crontab -e` → `0 9 * * * cd /path/to/reddit-myind && uv run gapmap research gap-alerts --action check >> /tmp/gapmap-alerts.log 2>&1`

## Windows — Task Scheduler

- [ ] Create a Basic Task, daily 9:00, action: `uv run gapmap research gap-alerts --action check` (Start in = repo path).

## Notes

- Velocity-based alerts (spike/new) need fresh collection to be meaningful —
  schedule a `gapmap research collect` before the alert check if you want the
  windows to reflect new data.
- A future enhancement is to wire `check_alerts` into the in-app jobs queue
  (`mcp/jobs.py`) so the long-lived Tauri process runs it without external cron.
  Tracked as P-future in `docs/IMPLEMENTATION_FLOW.md`.
