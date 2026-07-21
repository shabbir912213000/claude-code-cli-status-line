'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { cachePath, entryPath } = require('./paths');
const { readToken } = require('./credentials');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

function readCache(file = cachePath()) {
  try {
    const stat = fs.statSync(file);
    const ageMs = Date.now() - stat.mtimeMs;
    if (stat.size === 0) return { data: null, ageMs, exists: true };
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')), ageMs, exists: true };
  } catch {
    return { data: null, ageMs: Infinity, exists: false };
  }
}

function writeCache(data, file = cachePath()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data === null ? '' : JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Fetch plan usage and write it to the cache. Failures write an empty file so a
 *  broken token or offline machine does not retrigger a fetch on every render. */
async function refresh({ file = cachePath(), timeoutMs = 5000 } = {}) {
  const { token } = readToken();
  if (!token) {
    writeCache(null, file);
    return { ok: false, reason: 'no-token' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': OAUTH_BETA },
      signal: controller.signal,
    });
    if (!res.ok) {
      writeCache(null, file);
      return { ok: false, reason: `http-${res.status}` };
    }
    const data = await res.json();
    writeCache(data, file);
    return { ok: true, data };
  } catch (err) {
    writeCache(null, file);
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Refresh in a detached child so rendering never blocks on the network. */
function spawnBackgroundRefresh(entry = entryPath()) {
  try {
    const child = spawn(process.execPath, [entry, '--refresh-usage'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function clamp(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function toEpochSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return 0;
}

/**
 * Find the weekly window scoped to the currently selected model.
 *
 * Preferred source is the server's `limits[]` array, whose `weekly_scoped` entries
 * carry a display name such as "Fable". Older/other plans expose fixed keys
 * (seven_day_opus, seven_day_sonnet) instead. Returns null when the selected model
 * has no scoped weekly window, which is exactly when the segment should be hidden.
 */
function findModelWeekly(usage, modelDisplayName) {
  if (!usage || !modelDisplayName) return null;
  const model = String(modelDisplayName).toLowerCase();

  for (const limit of usage.limits || []) {
    if (limit?.kind !== 'weekly_scoped') continue;
    const label = limit?.scope?.model?.display_name;
    if (!label) continue;
    if (!model.includes(String(label).toLowerCase())) continue;
    const percent = clamp(limit.percent);
    if (percent === null) continue;
    return { label: String(label).toLowerCase(), percent, resetsAt: toEpochSeconds(limit.resets_at) };
  }

  const fallbacks = [
    { key: 'seven_day_opus', match: 'opus' },
    { key: 'seven_day_sonnet', match: 'sonnet' },
  ];
  for (const { key, match } of fallbacks) {
    if (!model.includes(match)) continue;
    const percent = clamp(usage?.[key]?.utilization);
    if (percent === null) continue;
    return { label: match, percent, resetsAt: toEpochSeconds(usage[key].resets_at) };
  }
  return null;
}

/**
 * Session and weekly windows rebuilt from the usage API, shaped like the
 * stdin `rate_limits` object. Needed for credit-billed models (e.g. Fable on
 * lower tiers), where Claude Code omits `rate_limits` from stdin entirely.
 * Returns null when the API had neither window.
 */
function fallbackRateLimits(usage) {
  if (!usage) return null;
  const windows = { session: null, weekly_all: null };

  for (const limit of Array.isArray(usage.limits) ? usage.limits : []) {
    if (limit?.kind in windows && windows[limit.kind] === null && clamp(limit.percent) !== null) {
      windows[limit.kind] = { used_percentage: clamp(limit.percent), resets_at: toEpochSeconds(limit.resets_at) };
    }
  }
  const legacy = [['session', usage.five_hour], ['weekly_all', usage.seven_day]];
  for (const [kind, entry] of legacy) {
    if (windows[kind] === null && clamp(entry?.utilization) !== null) {
      windows[kind] = { used_percentage: clamp(entry.utilization), resets_at: toEpochSeconds(entry.resets_at) };
    }
  }

  if (!windows.session && !windows.weekly_all) return null;
  return { five_hour: windows.session, seven_day: windows.weekly_all };
}

/**
 * Usage-credit spend ("extra usage"). `percent` is non-null only when the API
 * exposes a spend limit to measure against; until then callers should show the
 * plain dollar amount. Returns null when credits are disabled or absent, which
 * is exactly when the segment should be hidden.
 */
function findCredits(usage) {
  if (!usage) return null;
  const spend = usage.spend;
  const extra = usage.extra_usage;
  if (spend?.enabled !== true && extra?.is_enabled !== true) return null;

  const minor = typeof spend?.used?.amount_minor === 'number' ? spend.used.amount_minor
    : typeof extra?.used_credits === 'number' ? extra.used_credits : null;
  if (minor === null || !Number.isFinite(minor)) return null;
  const exponent = typeof spend?.used?.exponent === 'number' ? spend.used.exponent
    : typeof extra?.decimal_places === 'number' ? extra.decimal_places : 2;

  const hasLimit = spend?.limit !== null && spend?.limit !== undefined;
  return {
    usedDollars: minor / 10 ** exponent,
    percent: hasLimit ? clamp(spend.percent) ?? 0 : null,
  };
}

module.exports = {
  USAGE_URL,
  OAUTH_BETA,
  readCache,
  writeCache,
  refresh,
  spawnBackgroundRefresh,
  findModelWeekly,
  fallbackRateLimits,
  findCredits,
};
