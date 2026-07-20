'use strict';

const fs = require('fs');
const path = require('path');
const { configPath } = require('./paths');

// Defaults reproduce the reference line:
//   Fable 5 (high) | ctx - 19.4k | ctx - 5% | session - 67% (1h 32m) | week - 30% (4d 15h)
const DEFAULTS = {
  segments: {
    model: true,
    effort: true,
    contextTokens: true,
    contextPercent: true,
    session: true,
    week: true,
    // Requires reading the local OAuth token to call the usage API.
    // Off unless the user opts in during install.
    modelWeekly: false,
  },
  resetCountdown: true,
  separator: ' | ',
  // Percent thresholds for the green -> yellow -> red ramp.
  thresholds: { warn: 50, danger: 80 },
  colors: {
    model: ['bold', 'cyan'],
    effort: ['magenta'],
    tokens: ['blue'],
    label: ['dim'],
    separator: ['dim'],
    countdown: ['dim'],
    ok: ['green'],
    warn: ['yellow'],
    danger: ['red'],
  },
  labels: {
    contextTokens: 'ctx - ',
    contextPercent: 'ctx - ',
    session: 'session - ',
    week: 'week - ',
  },
  // Minutes between usage-API refreshes (model-specific weekly limit only).
  usageCacheMinutes: 5,
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base?.[key])
      ? deepMerge(base[key], value)
      : value;
  }
  return out;
}

function defaults() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function load(file = configPath()) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return deepMerge(defaults(), JSON.parse(raw));
  } catch {
    // Missing or unparsable config must never break the status line.
    return defaults();
  }
}

function save(config, file = configPath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

module.exports = { DEFAULTS, defaults, deepMerge, load, save };
