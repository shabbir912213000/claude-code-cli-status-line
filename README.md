# claude-code-cli-status-line

A cross-platform status line for the [Claude Code](https://code.claude.com) CLI. One line, at a glance:

```
Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 67% (1h 32m) | week - 30% (4d 15h)
```

Percentages are colour-coded green → yellow → red as you approach a limit, and every limit shows how long until it resets.

## Install

```bash
npx claude-code-cli-status-line install
```

Then restart Claude Code, or start a new session.

The installer copies a small runtime into your Claude config directory and points `statusLine` in `settings.json` at it. It deliberately does **not** run through `npx` on every refresh — the status line re-renders constantly, and `npx` startup would make it lag.

To remove it:

```bash
npx claude-code-cli-status-line uninstall
```

## What each segment shows

| Segment | Source | Notes |
| --- | --- | --- |
| `Fable 5 (high)` | Selected model and reasoning effort | Effort is hidden for models that don't support it |
| `ctx - 19.4k` | Context tokens in use | Input + output + cache-read + cache-creation |
| `ctx - 5%` | Share of the context window used | |
| `session - 67% (1h 32m)` | 5-hour rate limit and reset countdown | Claude.ai Pro/Max only |
| `week - 30% (4d 15h)` | 7-day rate limit and reset countdown | Claude.ai Pro/Max only |
| `fable - 26% (3d 1h)` | Model-specific weekly limit | Opt-in; see below |

Segments disappear rather than showing zeros when their data isn't available — before the first API response, on plans without rate limits, or for models with no separate weekly limit.

## The model-specific weekly limit (opt-in)

Some plans have a separate weekly limit for a particular model, shown on the claude.ai usage page. Claude Code **does not** pass that number to status line scripts — it sends only the 5-hour and 7-day windows — so this feature reads it from the same usage API the usage page uses.

That requires your local Claude Code OAuth token, so it is **off by default** and the installer explains exactly what it does before enabling it:

```bash
npx claude-code-cli-status-line install --model-limits    # enable
npx claude-code-cli-status-line install --no-model-limits # disable
```

- **What is accessed:** your Claude Code OAuth token, from the macOS Keychain, or `~/.claude/.credentials.json` on Linux and Windows.
- **What it is used for:** one HTTPS request to `https://api.anthropic.com/api/oauth/usage`, at most once every 5 minutes, cached locally.
- **Where it goes:** only to Anthropic's own API. The token is never written to the cache, never logged, and never sent anywhere else.
- **How it renders:** the segment appears only when the selected model has its own weekly window, and vanishes when you switch to a model that doesn't.

The refresh runs in a detached background process, so the status line never blocks on the network.

## Platform support

Verified on macOS, Linux, and Windows. The package detects the platform and reads credentials from the right place:

| Platform | Credential storage |
| --- | --- |
| macOS | Encrypted Keychain, via the `security` CLI |
| Linux | `~/.claude/.credentials.json` (mode `0600`) |
| Windows | `%USERPROFILE%\.claude\.credentials.json` |

`CLAUDE_CONFIG_DIR` is honoured everywhere, and `CLAUDE_CODE_OAUTH_TOKEN` is used when set (useful over SSH or in CI). On Windows the `settings.json` command is written with forward slashes so it survives Git Bash, which otherwise eats backslashes as escape characters.

## Configuration

Config lives at `<claude-config-dir>/claude-code-cli-status-line/config.json`. Show it with:

```bash
npx claude-code-cli-status-line config
```

Defaults match the line at the top of this README. Notable keys:

```jsonc
{
  "segments": {          // turn individual segments on or off
    "model": true,
    "effort": true,
    "contextTokens": true,
    "contextPercent": true,
    "session": true,
    "week": true,
    "modelWeekly": false // the opt-in feature above
  },
  "resetCountdown": true,           // the "(1h 32m)" suffixes
  "separator": " | ",
  "thresholds": { "warn": 50, "danger": 80 },  // percent → yellow, → red
  "usageCacheMinutes": 5,
  "colors": { "model": ["bold", "cyan"], "ok": ["green"] },
  "labels": { "session": "session - " }
}
```

Set `NO_COLOR=1` to render without ANSI colours.

## Commands

| Command | What it does |
| --- | --- |
| `install` | Install and wire into `settings.json` |
| `uninstall` | Remove the status line and its runtime |
| `preview` | Print a sample line using your config |
| `doctor` | Diagnose install, credentials, and API reachability |
| `config` | Print the active config and its path |

If the status line doesn't appear, run `doctor` first — it checks the Node version, whether `settings.json` is wired, and whether the usage API is reachable.

## Requirements

- Node.js 18 or later
- Claude Code v2.1 or later for `rate_limits` in the status line payload
- A Claude.ai Pro or Max subscription for the session and weekly segments

## License

MIT
