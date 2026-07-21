'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { findModelWeekly, fallbackRateLimits, findCredits } = require('../lib/usage');
const { extractToken } = require('../lib/credentials');
const { commandString, isVersionManaged } = require('../lib/install');
const { deepMerge, defaults } = require('../lib/config');

// Shape returned by the real usage endpoint, trimmed to the fields that matter.
const USAGE = {
  five_hour: { utilization: 23, resets_at: '2026-07-19T22:00:00.437689+00:00' },
  seven_day: { utilization: 17, resets_at: '2026-07-22T20:00:00.437709+00:00' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    { kind: 'session', percent: 23, resets_at: '2026-07-19T22:00:00.437689+00:00', scope: null },
    { kind: 'weekly_all', percent: 17, resets_at: '2026-07-22T20:00:00.437709+00:00', scope: null },
    {
      kind: 'weekly_scoped',
      percent: 26,
      resets_at: '2026-07-22T20:00:00.437991+00:00',
      scope: { model: { id: null, display_name: 'Fable' } },
    },
  ],
};

test('finds the weekly window scoped to the selected model', () => {
  const found = findModelWeekly(USAGE, 'Fable 5');
  assert.strictEqual(found.label, 'fable');
  assert.strictEqual(found.percent, 26);
  assert.strictEqual(found.resetsAt, Math.floor(Date.parse('2026-07-22T20:00:00.437991+00:00') / 1000));
});

test('returns null for models without a scoped window', () => {
  assert.strictEqual(findModelWeekly(USAGE, 'Opus 4.8'), null);
  assert.strictEqual(findModelWeekly(USAGE, 'Sonnet 5'), null);
  assert.strictEqual(findModelWeekly(USAGE, 'Haiku 4.5'), null);
});

test('entries with a null scope never throw', () => {
  assert.doesNotThrow(() => findModelWeekly(USAGE, 'Fable 5'));
  assert.strictEqual(findModelWeekly({ limits: [{ kind: 'weekly_scoped', percent: 5, scope: null }] }, 'Fable'), null);
});

test('falls back to fixed per-model keys when limits[] is absent', () => {
  const legacy = { seven_day_opus: { utilization: 44, resets_at: 1_700_000_000 } };
  const found = findModelWeekly(legacy, 'Opus 4.8');
  assert.strictEqual(found.label, 'opus');
  assert.strictEqual(found.percent, 44);
  assert.strictEqual(findModelWeekly(legacy, 'Fable 5'), null);
});

test('handles absent or malformed usage payloads', () => {
  assert.strictEqual(findModelWeekly(null, 'Fable 5'), null);
  assert.strictEqual(findModelWeekly({}, 'Fable 5'), null);
  assert.strictEqual(findModelWeekly(USAGE, null), null);
  assert.strictEqual(findModelWeekly({ limits: 'nonsense' }, 'Fable'), null);
});

test('percentages are clamped into 0-100', () => {
  const weird = { limits: [{ kind: 'weekly_scoped', percent: 250, scope: { model: { display_name: 'Fable' } } }] };
  assert.strictEqual(findModelWeekly(weird, 'Fable 5').percent, 100);
});

test('token extraction reads claudeAiOauth.accessToken', () => {
  assert.strictEqual(extractToken(JSON.stringify({ claudeAiOauth: { accessToken: 'sk-test' } })), 'sk-test');
  assert.strictEqual(extractToken('not json'), null);
  assert.strictEqual(extractToken(JSON.stringify({ claudeAiOauth: {} })), null);
  assert.strictEqual(extractToken(''), null);
});

test('settings command quotes paths and uses forward slashes for Windows shells', () => {
  const cmd = commandString('C:\\Users\\me\\.claude\\claude-code-cli-status-line\\statusline.js', 'C:\\Program Files\\nodejs\\node.exe');
  assert.strictEqual(cmd, '"C:/Program Files/nodejs/node.exe" "C:/Users/me/.claude/claude-code-cli-status-line/statusline.js"');
  assert.ok(!cmd.includes('\\'), 'no backslashes survive for Git Bash');
});

test('version-manager node paths are detected so they are not pinned', () => {
  assert.ok(isVersionManaged('/Users/me/.local/state/fnm_multishells/85384_123/bin/node'));
  assert.ok(isVersionManaged('/Users/me/.local/share/fnm/node-versions/v24.18.0/installation/bin/node'));
  assert.ok(isVersionManaged('/Users/me/.nvm/versions/node/v20.11.0/bin/node'));
  assert.ok(isVersionManaged('/Users/me/.volta/tools/image/node/20.11.0/bin/node'));
  assert.ok(!isVersionManaged('/usr/local/bin/node'));
  assert.ok(!isVersionManaged('/usr/bin/node'));
  assert.ok(!isVersionManaged('C:\\Program Files\\nodejs\\node.exe'));
});

test('fallback rate limits rebuild session/weekly from limits[]', () => {
  const out = fallbackRateLimits(USAGE);
  assert.strictEqual(out.five_hour.used_percentage, 23);
  assert.strictEqual(out.seven_day.used_percentage, 17);
  assert.strictEqual(out.five_hour.resets_at, Math.floor(Date.parse('2026-07-19T22:00:00.437689+00:00') / 1000));
});

test('fallback rate limits use legacy five_hour/seven_day keys when limits[] is absent', () => {
  const legacy = {
    five_hour: { utilization: 8, resets_at: 1_700_000_000 },
    seven_day: { utilization: 41, resets_at: 1_700_100_000 },
  };
  const out = fallbackRateLimits(legacy);
  assert.strictEqual(out.five_hour.used_percentage, 8);
  assert.strictEqual(out.seven_day.resets_at, 1_700_100_000);
  assert.strictEqual(fallbackRateLimits(null), null);
  assert.strictEqual(fallbackRateLimits({}), null);
});

test('credits read spend, preferring amount_minor with its exponent', () => {
  const usage = { spend: { enabled: true, used: { amount_minor: 144, currency: 'USD', exponent: 2 }, limit: null, percent: 0 } };
  assert.deepStrictEqual(findCredits(usage), { usedDollars: 1.44, percent: null });
});

test('credits expose a percent only when a spend limit exists', () => {
  const capped = { spend: { enabled: true, used: { amount_minor: 340, exponent: 2 }, limit: { amount_minor: 1000 }, percent: 34 } };
  assert.deepStrictEqual(findCredits(capped), { usedDollars: 3.4, percent: 34 });
});

test('credits fall back to extra_usage and hide when disabled or absent', () => {
  const extra = { extra_usage: { is_enabled: true, used_credits: 17.0, decimal_places: 2 } };
  assert.deepStrictEqual(findCredits(extra), { usedDollars: 0.17, percent: null });
  assert.strictEqual(findCredits({ spend: { enabled: false }, extra_usage: { is_enabled: false } }), null);
  assert.strictEqual(findCredits({ spend: { enabled: true } }), null, 'enabled but no amount yet');
  assert.strictEqual(findCredits(null), null);
  assert.strictEqual(findCredits({}), null);
});

test('config merge keeps defaults for unspecified keys', () => {
  const merged = deepMerge(defaults(), { segments: { modelWeekly: true }, thresholds: { danger: 90 } });
  assert.strictEqual(merged.segments.modelWeekly, true);
  assert.strictEqual(merged.segments.session, true, 'untouched segment keeps its default');
  assert.strictEqual(merged.thresholds.danger, 90);
  assert.strictEqual(merged.thresholds.warn, 50, 'untouched threshold keeps its default');
});
