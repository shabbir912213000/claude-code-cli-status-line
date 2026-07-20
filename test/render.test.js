'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildLine, formatTokens, formatCountdown, totalContextTokens } = require('../lib/render');
const { defaults } = require('../lib/config');

const NOW = 1_700_000_000;
const plain = (input, config, deps = {}) => buildLine(input, config, { now: NOW, colorsOn: false, ...deps });

function baseConfig(overrides = {}) {
  const config = defaults();
  return { ...config, ...overrides, segments: { ...config.segments, ...(overrides.segments || {}) } };
}

const SESSION = {
  model: { display_name: 'Fable 5' },
  effort: { level: 'high' },
  context_window: { used_percentage: 5, current_usage: { input_tokens: 19400 } },
  rate_limits: {
    five_hour: { used_percentage: 67, resets_at: NOW + 5520 },
    seven_day: { used_percentage: 30, resets_at: NOW + 399900 },
  },
};

test('renders the reference line', () => {
  assert.strictEqual(
    plain(SESSION, baseConfig()),
    'Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 67% (1h 32m) | week - 30% (4d 15h)',
  );
});

test('weekly countdown switches to hours below one day', () => {
  const input = {
    ...SESSION,
    rate_limits: {
      five_hour: { used_percentage: 67, resets_at: NOW + 7800 },
      seven_day: { used_percentage: 30, resets_at: NOW + 64500 },
    },
  };
  assert.match(plain(input, baseConfig()), /session - 67% \(2h 10m\) \| week - 30% \(17h 55m\)$/);
});

test('formatTokens uses one decimal and k/M suffixes', () => {
  assert.strictEqual(formatTokens(19400), '19.4k');
  assert.strictEqual(formatTokens(0), '0.0k');
  assert.strictEqual(formatTokens(1_500_000), '1.5M');
});

test('formatCountdown covers day, hour, minute and elapsed cases', () => {
  assert.strictEqual(formatCountdown(NOW + 399900, NOW), '4d 15h');
  assert.strictEqual(formatCountdown(NOW + 64500, NOW), '17h 55m');
  assert.strictEqual(formatCountdown(NOW + 900, NOW), '15m');
  assert.strictEqual(formatCountdown(NOW - 10, NOW), '');
  assert.strictEqual(formatCountdown(0, NOW), '');
});

test('context tokens sum cache and output tokens, falling back to total_input_tokens', () => {
  assert.strictEqual(totalContextTokens({
    context_window: {
      current_usage: {
        input_tokens: 8500, output_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 4700,
      },
    },
  }), 19400);
  assert.strictEqual(totalContextTokens({ context_window: { total_input_tokens: 1234, current_usage: null } }), 1234);
  assert.strictEqual(totalContextTokens({}), 0);
});

test('missing rate limits drop those segments instead of showing zeros', () => {
  const line = plain({ model: { display_name: 'Fable 5' } }, baseConfig());
  assert.strictEqual(line, 'Fable 5 | ctx - 0.0k | ctx - 0%');
  assert.ok(!line.includes('session'));
  assert.ok(!line.includes('week'));
});

test('malformed input still renders a line', () => {
  assert.doesNotThrow(() => plain({}, baseConfig()));
  assert.doesNotThrow(() => plain({ model: null, rate_limits: null }, baseConfig()));
});

test('model-scoped weekly segment appears only for the matching model', () => {
  const usage = {
    limits: [{
      kind: 'weekly_scoped',
      percent: 26,
      resets_at: new Date((NOW + 262800) * 1000).toISOString(),
      scope: { model: { display_name: 'Fable' } },
    }],
  };
  const config = baseConfig({ segments: { modelWeekly: true } });

  const fable = plain(SESSION, config, { usage });
  assert.ok(fable.endsWith('| fable - 26% (3d 1h)'), fable);

  const opus = plain({ ...SESSION, model: { display_name: 'Opus 4.8' } }, config, { usage });
  assert.ok(!opus.includes('fable'), opus);
  assert.ok(opus.endsWith('week - 30% (4d 15h)'), opus);
});

test('model-scoped segment stays hidden when the feature is off', () => {
  const usage = { limits: [{ kind: 'weekly_scoped', percent: 26, scope: { model: { display_name: 'Fable' } } }] };
  assert.ok(!plain(SESSION, baseConfig(), { usage }).includes('fable'));
});

test('colors apply thresholds and can be disabled', () => {
  const hot = {
    ...SESSION,
    rate_limits: {
      five_hour: { used_percentage: 85, resets_at: NOW + 600 },
      seven_day: { used_percentage: 55, resets_at: NOW + 600 },
    },
  };
  const colored = buildLine(hot, baseConfig(), { now: NOW, colorsOn: true });
  assert.ok(colored.includes('[31m85%'), 'danger threshold is red');
  assert.ok(colored.includes('[33m55%'), 'warn threshold is yellow');
  assert.ok(!plain(hot, baseConfig()).includes('['), 'colorsOn:false emits no escapes');
});

test('segments can be toggled off via config', () => {
  const config = baseConfig({ segments: { contextTokens: false, effort: false } });
  const line = plain(SESSION, config);
  assert.ok(!line.includes('19.4k'));
  assert.ok(!line.includes('(high)'));
  assert.ok(line.startsWith('Fable 5 | ctx - 5%'));
});

test('reset countdowns can be disabled', () => {
  const line = plain(SESSION, baseConfig({ resetCountdown: false }));
  assert.strictEqual(line, 'Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 67% | week - 30%');
});
