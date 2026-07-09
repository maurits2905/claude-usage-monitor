# Halo

**A small, warm desktop widget for your Claude usage limits.**

Halo sits quietly on your desktop and shows exactly how much of your Claude
5-hour session and weekly limits you have used, when they reset, and whether
you are on pace to hit them. It uses the **official rate-limit numbers Claude
Code itself publishes** - no token guessing, no API keys, no OAuth tokens, no
session cookies.

- **Accurate by construction.** Most monitors estimate limits from token
  counts (approximate) or poll private endpoints with your credentials
  (fragile). Halo reads the `rate_limits` data Claude Code sends to its own
  statusline. What Anthropic says, Halo shows.
- **Zero dependencies for users.** One small installer. No Node, no Python,
  no browser tab. The compiled binary doubles as the statusline shim.
- **Compact and calm.** A single rounded card with two usage rings, reset
  countdowns, warning states at 70% and 90%, a pace projection, and a little
  mascot whose mood tracks your usage. Light, dark, and auto themes.
- **Local-first.** Halo reads local files written by Claude Code and never
  sends anything anywhere. The only network call is an optional once-daily
  update check against the GitHub API, which you can switch off.
- **Per-model limits, automatically.** If Anthropic publishes additional
  buckets (weekly Opus, weekly Fable, extra usage), they appear as extra
  meters without an update.

## Install

Download the latest installer from
[Releases](https://github.com/maurits2905/claude-usage-monitor/releases):
Windows `.exe` (NSIS) or macOS `.dmg`.

Requirements: Claude Code 2.1+ with a Pro or Max subscription. (Older
versions do not publish rate limits to the statusline.)

Builds are not code-signed yet, so the OS will warn on first run:

- **Windows SmartScreen**: click "More info", then "Run anyway".
- **macOS Gatekeeper**: right-click the app, choose "Open", confirm.

Only download Halo from this repository's Releases page.

## Setup (once)

1. Start Halo and click **Connect**.
2. Restart Claude Code (or start a new session).
3. That's it. Data flows on every statusline refresh.

**What Connect does:** it points the `statusLine` command in
`~/.claude/settings.json` at `halo --shim`, which records the rate-limit
payload locally and then runs your previous statusline command unchanged -
your statusline looks exactly like before. A timestamped backup of
`settings.json` is written first, and **Settings -> Disconnect** restores the
original configuration.

## The widget

- **Rings** - session (5-hour) and weekly utilization with % used, % left,
  and reset countdowns.
- **Warning states** - calm terracotta on track, amber from 70%, red from
  90%. The mascot gets visibly concerned so you notice from the corner of
  your eye.
- **Pace** - Halo samples utilization once a minute and projects: "At this
  pace you hit the session limit ~14:32, before it resets."
- **Sparkline** - session utilization over the last five hours.
- **Tray** - left-click the tray icon to show/hide; the close button hides
  to tray. Pin the widget always-on-top with the pin button.
- **Settings** - theme (auto/light/dark), launch at login, daily update
  check, disconnect.

## Updating

Halo checks the GitHub Releases feed at most once a day - a single anonymous
HTTPS request, and you can switch it off in Settings.
When a newer version exists, a small pill appears in the footer ("v0.3.0
available"). Click it, download the installer for your platform, and run it
over the existing installation. Your settings, window position, and the
statusline connection are all kept; no reconnect needed.

There is deliberately no silent auto-update: a tool that edits your Claude
settings file should only change when you decide.

## Build from source

```
npm install
npm run tauri dev     # run in development
npm run tauri build   # produce installers for your platform
```

Requires Node 18+, Rust (stable), and on Windows the MSVC C++ Build Tools.
Releases for Windows and macOS are built by CI (`.github/workflows/release.yml`)
on every `v*` tag.

## Privacy

Halo reads: `~/.claude/settings.json` (statusline config),
`~/.claude/usage-monitor/*` (its own capture files). It writes only inside
`~/.claude/usage-monitor/` plus the one statusline entry in settings.json.
It sends nothing anywhere, ever, except the optional update check to
`api.github.com`.

## License

MIT
