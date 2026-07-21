# claude-code-cli-status-line

[![npm version](https://img.shields.io/npm/v/claude-code-cli-status-line.svg)](https://www.npmjs.com/package/claude-code-cli-status-line)
[![CI](https://github.com/shabbir912213000/claude-code-cli-status-line/actions/workflows/ci.yml/badge.svg)](https://github.com/shabbir912213000/claude-code-cli-status-line/actions/workflows/ci.yml)
[![node >= 18](https://img.shields.io/node/v/claude-code-cli-status-line.svg)](https://www.npmjs.com/package/claude-code-cli-status-line)
[![license MIT](https://img.shields.io/npm/l/claude-code-cli-status-line.svg)](https://github.com/shabbir912213000/claude-code-cli-status-line/blob/main/LICENSE)

A cross-platform status line for the [Claude Code](https://code.claude.com) CLI. One line, at a glance:

```
Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 67% (1h 32m) | week - 30% (4d 15h)
```

Percentages are colour-coded green → yellow → red as you approach a limit, and every limit shows how long until it resets.

The line adapts to your model, plan, and config. A few of the views you might see:

With the opt-in [usage API extras](#usage-api-extras-opt-in), plans with a model-scoped weekly limit get an extra segment:

```
Fable 5 (high) | ctx - 42.9k | ctx - 21% | session - 67% (1h 32m) | week - 30% (4d 15h) | fable - 26% (3d 1h)
```

Models billed to usage credits show spend instead — as plain dollars, or as a percentage when your account exposes a spend limit:

```
Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 12% (3h 40m) | week - 8% (5d 2h) | credits - $1.44
Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 12% (3h 40m) | week - 8% (5d 2h) | credits - 34% ($3.40)
```

Models without a reasoning-effort setting drop the `(high)`, and segments with no data simply disappear — no zeros, no placeholders:

```
Haiku 4.5 | ctx - 128.3k | ctx - 64% | session - 82% (47m) | week - 71% (1d 3h)
```

Every segment can also be toggled individually in the [config](#configuration), down to a minimal line:

```
Fable 5 | ctx - 5%
```

## Install

```bash
npm install -g claude-code-cli-status-line
claude-code-cli-status-line install
```

Then restart Claude Code, or start a new session.

Prefer not to install globally? Every command in this README also works as a one-shot via `npx`, e.g. `npx claude-code-cli-status-line install`.

The installer copies a small runtime into your Claude config directory and points `statusLine` in `settings.json` at it. It deliberately does **not** run through `npx` on every refresh — the status line re-renders constantly, and `npx` startup would make it lag.

To remove it:

```bash
claude-code-cli-status-line uninstall
npm uninstall -g claude-code-cli-status-line
```

The first command removes the status line from `settings.json` and deletes the runtime; the second removes the CLI itself.

## What each segment shows

| Segment | Source | Notes |
| --- | --- | --- |
| `Fable 5 (high)` | Selected model and reasoning effort | Effort is hidden for models that don't support it |
| `ctx - 19.4k` | Context tokens in use | Input + output + cache-read + cache-creation |
| `ctx - 5%` | Share of the context window used | |
| `session - 67% (1h 32m)` | 5-hour rate limit and reset countdown | Claude.ai Pro/Max only |
| `week - 30% (4d 15h)` | 7-day rate limit and reset countdown | Claude.ai Pro/Max only |
| `fable - 26% (3d 1h)` | Model-specific weekly limit | Opt-in; see below |
| `credits - $1.44` | Usage-credit spend (credit-billed models) | Opt-in; see below |

Segments disappear rather than showing zeros when their data isn't available — before the first API response, on plans without rate limits, or for models with no separate weekly limit.

## Usage API extras (opt-in)

Claude Code doesn't send every usage number to status line scripts. Some plans have a separate weekly limit for a particular model, shown on the claude.ai usage page, that never reaches the script. And for models billed to **usage credits** (e.g. Fable on some tiers), Claude Code omits `rate_limits` from the payload entirely — the session and weekly segments would simply vanish. This opt-in feature reads all of it from the same usage API the claude.ai usage page uses:

- the weekly limit scoped to the selected model (when your plan has one), e.g. `fable - 26% (3d 1h)`
- usage-credit spend for credit-billed models, e.g. `credits - $1.44` — upgrading automatically to a percentage like `credits - 34% ($3.40)` if your account exposes a spend limit
- session/weekly usage for credit-billed models, restored from the API when stdin has none

That requires your local Claude Code OAuth token, so it is **off by default** and the installer explains exactly what it does before enabling it:

```bash
claude-code-cli-status-line install --usage-api    # enable
claude-code-cli-status-line install --no-usage-api # disable
```

- **What is accessed:** your Claude Code OAuth token, from the macOS Keychain, or `~/.claude/.credentials.json` on Linux and Windows.
- **What it is used for:** one HTTPS request to `https://api.anthropic.com/api/oauth/usage`, at most once every 5 minutes, cached locally.
- **Where it goes:** only to Anthropic's own API. The token is never written to the cache, never logged, and never sent anywhere else.
- **How it renders:** each extra segment appears only when your plan actually has that data, and vanishes when it doesn't apply to the selected model.

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
claude-code-cli-status-line config
```

Defaults match the line at the top of this README. Notable keys:

```jsonc
{
  "usageApi": false,     // master switch for the opt-in feature above
  "segments": {          // turn individual segments on or off
    "model": true,
    "effort": true,
    "contextTokens": true,
    "contextPercent": true,
    "session": true,
    "week": true,
    "modelWeekly": true, // model-scoped weekly limit (needs usageApi)
    "credits": true      // usage-credit spend (needs usageApi)
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
