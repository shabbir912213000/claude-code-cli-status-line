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

module.exports = {
  USAGE_URL,
  OAUTH_BETA,
  readCache,
  writeCache,
  refresh,
  spawnBackgroundRefresh,
  findModelWeekly,
};
