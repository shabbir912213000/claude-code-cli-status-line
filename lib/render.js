'use strict';

const { colorEnabled, makePainter } = require('./colors');
const {
  readCache, findModelWeekly, fallbackRateLimits, findCredits, spawnBackgroundRefresh,
} = require('./usage');

function formatTokens(tokens) {
  const n = typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  return `${(n / 1000).toFixed(1)}k`;
}

/** "4d 15h" past a day, "17h 55m" past an hour, "42m" below that, "" once elapsed. */
function formatCountdown(resetsAtSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!resetsAtSeconds || typeof resetsAtSeconds !== 'number') return '';
  const remaining = resetsAtSeconds - nowSeconds;
  if (!Number.isFinite(remaining) || remaining <= 0) return '';
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function totalContextTokens(input) {
  const cw = input?.context_window;
  const usage = cw?.current_usage;
  if (usage) {
    const sum = (usage.input_tokens || 0)
      + (usage.cache_creation_input_tokens || 0)
      + (usage.cache_read_input_tokens || 0)
      + (usage.output_tokens || 0);
    if (sum > 0) return sum;
  }
  // current_usage is null before the first API call and right after /compact.
  return cw?.total_input_tokens || 0;
}

function round(n) {
  return Math.round(typeof n === 'number' && Number.isFinite(n) ? n : 0);
}

function buildLine(input, config, deps = {}) {
  const {
    usage = null,
    now = Math.floor(Date.now() / 1000),
    colorsOn = colorEnabled(),
  } = deps;

  const paint = makePainter(colorsOn);
  const c = config.colors;
  const seg = config.segments;
  const { warn, danger } = config.thresholds;

  const pctColor = (value) => {
    if (value >= danger) return c.danger;
    if (value >= warn) return c.warn;
    return c.ok;
  };

  const countdown = (resetsAt) => {
    if (!config.resetCountdown) return '';
    const text = formatCountdown(resetsAt, now);
    return text ? ` ${paint(`(${text})`, ...c.countdown)}` : '';
  };

  const percentSegment = (label, value, resetsAt) => {
    const rounded = round(value);
    return paint(label, ...c.label)
      + paint(`${rounded}%`, ...pctColor(rounded))
      + countdown(resetsAt);
  };

  const parts = [];

  if (seg.model) {
    const name = input?.model?.display_name || 'Claude';
    let head = paint(name, ...c.model);
    if (seg.effort && input?.effort?.level) {
      head += ` ${paint(`(${input.effort.level})`, ...c.effort)}`;
    }
    parts.push(head);
  }

  if (seg.contextTokens) {
    parts.push(
      paint(config.labels.contextTokens, ...c.label)
      + paint(formatTokens(totalContextTokens(input)), ...c.tokens),
    );
  }

  if (seg.contextPercent) {
    parts.push(percentSegment(
      config.labels.contextPercent,
      input?.context_window?.used_percentage ?? 0,
      null,
    ));
  }

  // Credit-billed models (e.g. Fable on lower tiers) get no rate_limits in
  // stdin at all; the plan windows still exist and come from the usage API.
  const stdinLimits = input?.rate_limits;
  const creditBilled = !stdinLimits?.five_hour && !stdinLimits?.seven_day;
  const limits = (creditBilled ? fallbackRateLimits(usage) : stdinLimits) || {};

  if (seg.session && limits.five_hour) {
    parts.push(percentSegment(
      config.labels.session,
      limits.five_hour.used_percentage,
      limits.five_hour.resets_at,
    ));
  }

  if (seg.week && limits.seven_day) {
    parts.push(percentSegment(
      config.labels.week,
      limits.seven_day.used_percentage,
      limits.seven_day.resets_at,
    ));
  }

  // Model-scoped weekly window. Claude Code does not pipe this to status lines, so it
  // comes from the usage API cache; it is shown only when the selected model has one.
  if (seg.modelWeekly && usage) {
    const scoped = findModelWeekly(usage, input?.model?.display_name);
    if (scoped) {
      parts.push(percentSegment(`${scoped.label} - `, scoped.percent, scoped.resetsAt));
    }
  }

  // Usage-credit spend, shown only while the selected model bills to credits.
  // Plain dollars until the API exposes a spend limit, then percent + dollars.
  if (seg.credits && creditBilled && usage) {
    const credits = findCredits(usage);
    if (credits) {
      const dollars = `$${credits.usedDollars.toFixed(2)}`;
      parts.push(credits.percent === null
        ? paint(config.labels.credits, ...c.label) + paint(dollars, ...c.tokens)
        : percentSegment(config.labels.credits, credits.percent, null)
          + ` ${paint(`(${dollars})`, ...c.countdown)}`);
    }
  }

  return parts.join(paint(config.separator, ...c.separator));
}

/** Read cache, and kick off a detached refresh when it is stale. Never blocks. */
function loadUsageForRender(config) {
  if (!config.usageApi) return null;
  const { data, ageMs } = readCache();
  const ttl = Math.max(1, config.usageCacheMinutes || 5) * 60 * 1000;
  if (ageMs > ttl) spawnBackgroundRefresh();
  return data;
}

module.exports = { buildLine, formatTokens, formatCountdown, totalContextTokens, loadUsageForRender };
