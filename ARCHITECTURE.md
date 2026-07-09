# ARCHITECTURE.md - Halo

Status: CURRENT (2026-07-09, v0.2.0). Rewritten for the desktop-widget pivot;
the earlier local-web-dashboard iteration (v0.1) was removed.

## 1. Purpose

Compact open-source desktop widget showing official Claude usage limits
(5-hour session, weekly, dynamic per-model buckets such as Opus/Fable) with
reset countdowns, 70/90% warning states, a pace projection, and a mascot
status indicator. Windows first, macOS via CI.

## 2. Stack

- Tauri v2 (Rust backend, system WebView) - ~8 MB installer, tray icon,
  frameless transparent always-on-top-able window.
- Frontend: vanilla HTML/CSS/JS in `ui/`, no bundler, `withGlobalTauri`.
- Rust deps: tauri, tauri-plugin-opener/-autostart/-window-state, serde_json, dirs.
- No runtime dependencies for end users (no Node/Python).

## 3. Structure

```
ui/                     widget UI (index.html, styles.css, app.js; demo mode in browser)
src-tauri/src/main.rs   GUI entry, tray, window events, small commands
src-tauri/src/shim.rs   `halo --shim` statusline shim mode (no GUI)
src-tauri/src/monitor.rs settings.json install/restore + status/history reading
src-tauri/tauri.conf.json  window config (336x544, transparent, frameless), CSP
src-tauri/capabilities/ minimal core permissions (drag, hide/show/focus)
.github/workflows/release.yml  tag-triggered Windows+macOS release builds
```

## 4. Data flow

1. Claude Code (>= 2.1) pipes statusline JSON (model, cost, `rate_limits`)
   to its configured statusline command on every refresh.
2. `halo --shim` tees the payload to `~/.claude/usage-monitor/latest.json`
   (atomic tmp+rename), appends a throttled (60 s) utilization sample to
   `history.jsonl` (pruned at 512 KB), then pipes stdin to the user's original
   statusline command and passes its stdout through unchanged.
3. The widget polls the `get_status` Tauri command every 15 s: latest payload,
   age, 24 h of history samples.
4. Frontend renders rings/buckets defensively (unknown bucket keys render as
   generic meters; utilization accepted as 0-1 or 0-100; resets as ISO or epoch).
5. Pace projection: linear slope over the last 45 min of samples vs reset time.

## 5. Shim install/restore (the only thing Halo writes outside its own dir)

`install_shim` backs up `~/.claude/settings.json` to
`settings.json.backup-halo-<epoch-ms>`, stores the previous statusline command
in `~/.claude/usage-monitor/shim-config.json`, and sets
`statusLine.command = "<path-to-halo.exe>" --shim`. Detects and migrates the
legacy v0.1 Node shim (keeps its stored original command). `restore_shim`
reverses it. The shim never breaks the statusline: every step is
failure-tolerant and it always executes the original command.

## 6. Security / privacy

- No credentials read; no Anthropic endpoints called; nothing leaves the machine.
- Only network call: optional daily `GET api.github.com/repos/<repo>/releases/latest`
  (frontend fetch, CSP-restricted to api.github.com; toggleable).
- `open_url` command only accepts `https://github.com/` URLs.
- CSP locked to self + ipc + api.github.com.

## 7. Update strategy

Notify-only: footer pill when a newer GitHub release tag exists, click opens
the release page. Deliberately no silent auto-update (unsigned binaries +
a tool that edits settings.json should update only on user action).

## 8. State / storage

- `~/.claude/usage-monitor/`: latest.json, history.jsonl, shim-config.json.
- localStorage: theme, pin, update-check prefs and cache.
- Window position: tauri-plugin-window-state.

## 9. Release

Push tag `v*` -> GitHub Actions builds NSIS (Windows) + DMG (macOS arm64+x64)
as a draft release. Version lives in package.json + tauri.conf.json + Cargo.toml.

## 10. Testing

Manual: browser demo mode covers UI states (`?state=...`); shim tested by
piping synthetic statusline JSON. TBD: Rust unit tests for monitor.rs
(settings edit round-trip) and shim parsing.

## 11. Known risks

- `rate_limits` statusline payload is undocumented; shape changes degrade to
  the waiting state (analytics-free) rather than breaking.
- Unsigned binaries: Windows SmartScreen / macOS Gatekeeper warnings until
  code signing is added (documented in README; candidate for later).

## 12-18. Observability, i18n, etc.

Not applicable / TBD. Roadmap candidates: signed builds, per-model transcript
analytics view, notifications on threshold crossings, winget/homebrew packaging.

## Contributor guardrails

- Shim path (`shim.rs`) must stay panic-free and silent; changes require
  re-testing with piped JSON before commit.
- Never widen the CSP or add endpoints beyond api.github.com.
- Never remove the settings.json backup step.
