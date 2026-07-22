# claude-code-cli-status-line

[![npm version](https://img.shields.io/npm/v/claude-code-cli-status-line.svg)](https://www.npmjs.com/package/claude-code-cli-status-line)
[![CI](https://github.com/shabbir912213000/claude-code-cli-status-line/actions/workflows/ci.yml/badge.svg)](https://github.com/shabbir912213000/claude-code-cli-status-line/actions/workflows/ci.yml)
[![node >= 18](https://img.shields.io/node/v/claude-code-cli-status-line.svg)](https://www.npmjs.com/package/claude-code-cli-status-line)
[![license MIT](https://img.shields.io/npm/l/claude-code-cli-status-line.svg)](https://github.com/shabbir912213000/claude-code-cli-status-line/blob/main/LICENSE)

A cross-platform status line for the [Claude Code](https://code.claude.com) CLI. It shows the selected model, context use, and available usage limits at a glance.

### Standard

```
Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 67% (1h 32m) | week - 30% (4d 15h)
```

### Model-specific weekly limit

```
Fable 5 (high) | ctx - 42.9k | ctx - 21% | session - 67% (1h 32m) | week - 30% (4d 15h) | fable - 26% (3d 1h)
```

### Credit-billed model

```
Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 12% (3h 40m) | week - 8% (5d 2h) | credits - $1.44
```

Percentages are colour-coded green → yellow → red as they approach a limit. Segments without data disappear, and each segment can be toggled in the configuration.

## Install

```bash
npx claude-code-cli-status-line@latest install
```

The installer enables the basic status line immediately, then asks whether to enable optional Usage API extras. Restart Claude Code, or start a new session, when it finishes. `@latest` follows npm's current `latest` tag; use an explicit version when you need a reproducible install.

To remove it:

```bash
npx claude-code-cli-status-line@latest uninstall
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
| `credits - $1.44` | Usage-credit spend (credit-billed models) | Opt-in; see below |

Segments disappear rather than showing zeros when their data isn't available — before the first API response, on plans without rate limits, or for models with no separate weekly limit.

## Usage API extras

Usage API extras add model-specific weekly limits, credit spend, and missing session or weekly limits for credit-billed models. They use the local Claude Code OAuth token for a cached request to Anthropic's usage API at most once every five minutes. The token is never written to the cache or logged.

Choose during installation, or change the setting later:

```bash
npx claude-code-cli-status-line@latest install --usage-api
npx claude-code-cli-status-line@latest install --no-usage-api
```

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
npx claude-code-cli-status-line@latest config
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

If the status line doesn't appear, run `npx claude-code-cli-status-line@latest doctor` first. It checks the Node version, whether `settings.json` is wired, and whether the Usage API is reachable.

## Requirements

- Node.js 18 or later
- Claude Code v2.1 or later for `rate_limits` in the status line payload
- A Claude.ai Pro or Max subscription for the session and weekly segments

## License

MIT
