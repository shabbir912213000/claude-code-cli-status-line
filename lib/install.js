'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  claudeConfigDir, runtimeDir, settingsPath, configPath, cachePath, entryPath,
} = require('./paths');
const { defaults, load, save } = require('./config');
const { describeSource } = require('./credentials');
const { makePainter, colorEnabled } = require('./colors');
const { buildLine } = require('./render');

const paint = makePainter(colorEnabled());
const bold = (s) => paint(s, 'bold');
const dim = (s) => paint(s, 'dim');

/** Claude Code parses settings.json itself; keep unrelated keys untouched. */
function readSettings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function copyRuntime(sourceRoot, targetDir) {
  fs.mkdirSync(path.join(targetDir, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, 'statusline.js'), path.join(targetDir, 'statusline.js'));
  for (const file of fs.readdirSync(path.join(sourceRoot, 'lib'))) {
    if (!file.endsWith('.js')) continue;
    fs.copyFileSync(path.join(sourceRoot, 'lib', file), path.join(targetDir, 'lib', file));
  }
}

// Paths owned by a version manager disappear on the next Node upgrade, which would
// silently break the status line. When we detect one, prefer a bare `node` that
// resolves through PATH instead of pinning the current version's absolute path.
const VERSION_MANAGER_HINTS = [
  'fnm_multishells', 'node-versions', '/.nvm/', '/.volta/', '/.asdf/', 'nodenv', '/n/versions/',
];

function isVersionManaged(execPath = process.execPath) {
  return VERSION_MANAGER_HINTS.some((hint) => execPath.includes(hint));
}

function bareNodeResolves() {
  const { execFileSync } = require('child_process');
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(finder, ['node'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function resolveNodeBinary(execPath = process.execPath) {
  return isVersionManaged(execPath) && bareNodeResolves() ? 'node' : execPath;
}

/**
 * Build the settings.json command string.
 *
 * Windows note: Claude Code may run the command through Git Bash, where backslashes
 * are eaten as escape characters, so paths are always emitted with forward slashes.
 */
function commandString(entry = entryPath(), node = resolveNodeBinary()) {
  const script = entry.replace(/\\/g, '/');
  const binary = node.replace(/\\/g, '/');
  return `"${binary}" "${script}"`;
}

const SAMPLE_INPUT = {
  model: { display_name: 'Fable 5' },
  effort: { level: 'high' },
  context_window: { used_percentage: 5, current_usage: { input_tokens: 19400 } },
  rate_limits: {
    five_hour: { used_percentage: 67, resets_at: Math.floor(Date.now() / 1000) + 5520 },
    seven_day: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 399900 },
  },
};

const SAMPLE_USAGE = {
  limits: [{
    kind: 'weekly_scoped',
    percent: 26,
    resets_at: new Date(Date.now() + 262800000).toISOString(),
    scope: { model: { display_name: 'Fable' } },
  }],
};

// Credit-billed model: Claude Code sends no rate_limits at all, and the plan
// windows plus the credit spend come from the usage API instead.
const SAMPLE_CREDIT_INPUT = {
  model: { display_name: 'Fable 5' },
  effort: { level: 'high' },
  context_window: { used_percentage: 5, current_usage: { input_tokens: 19400 } },
};

const SAMPLE_CREDIT_USAGE = {
  five_hour: { utilization: 8, resets_at: new Date(Date.now() + 15900000).toISOString() },
  seven_day: { utilization: 41, resets_at: new Date(Date.now() + 104400000).toISOString() },
  spend: { enabled: true, used: { amount_minor: 144, currency: 'USD', exponent: 2 }, limit: null, percent: 0 },
};

function previewLines() {
  const base = defaults();
  const off = { ...base, usageApi: false };
  const on = { ...base, usageApi: true };
  return {
    without: buildLine(SAMPLE_INPUT, off, { usage: null }),
    with: buildLine(SAMPLE_INPUT, on, { usage: SAMPLE_USAGE }),
    withoutCredit: buildLine(SAMPLE_CREDIT_INPUT, off, { usage: null }),
    withCredit: buildLine(SAMPLE_CREDIT_INPUT, on, { usage: SAMPLE_CREDIT_USAGE }),
  };
}

/** Everything the user is agreeing to, shown before the opt-in prompt. */
function consentNotice(platform = process.platform) {
  const preview = previewLines();
  return [
    '',
    bold('  Optional feature: usage API extras'),
    '',
    '  Claude Code does not send every usage number to status line scripts, so these',
    '  extras read them from the same usage API the claude.ai usage page uses:',
    '    - the weekly limit scoped to the selected model (when your plan has one)',
    '    - usage-credit spend, for models billed to usage credits',
    '    - session/weekly usage for credit-billed models, which otherwise get none',
    '',
    `  ${bold('What is accessed:')} your local Claude Code OAuth token, read from`,
    `    ${dim(describeSource(platform))}`,
    `  ${bold('What it is used for:')} one HTTPS request to`,
    `    ${dim('https://api.anthropic.com/api/oauth/usage')}`,
    `    to read your plan's usage numbers. At most once every 5 minutes, cached locally.`,
    `  ${bold('Where it goes:')} only to Anthropic's own API. The token is never written to`,
    '    the cache, never logged, and never sent anywhere else.',
    `  ${bold('Revoke anytime:')} rerun with --no-usage-api, or set usageApi`,
    `    to false in ${dim(configPath())}`,
    '',
    `  ${bold('Without this feature')} your status line looks like:`,
    `    ${preview.without}`,
    `  ${dim('  and, for a model billed to usage credits, loses its usage segments entirely:')}`,
    `    ${preview.withoutCredit}`,
    '',
    `  ${bold('With this feature')} it gains the model-scoped weekly limit:`,
    `    ${preview.with}`,
    `  ${dim('  and credit-billed models keep their usage and show credit spend:')}`,
    `    ${preview.withCredit}`,
    dim('     (each extra segment appears only when your plan actually has that data,'),
    dim('      and disappears automatically when it does not apply to the selected model)'),
    '',
  ].join('\n');
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function resolveUsageApi(flags) {
  if (flags.usageApi === true) return true;
  if (flags.usageApi === false) return false;
  if (flags.yes || !process.stdin.isTTY) return false; // safe default when unattended
  process.stdout.write(consentNotice());
  const answer = await ask(`  Enable it? ${dim('[y/N]')} `);
  return answer === 'y' || answer === 'yes';
}

async function install(flags = {}, sourceRoot = path.join(__dirname, '..')) {
  const target = runtimeDir();
  fs.mkdirSync(target, { recursive: true });
  copyRuntime(sourceRoot, target);

  const usageApi = await resolveUsageApi(flags);

  const config = load();
  config.usageApi = usageApi;
  save(config);

  const settingsFile = settingsPath();
  const settings = readSettings(settingsFile);
  const previous = settings.statusLine?.command;
  settings.statusLine = { type: 'command', command: commandString() };
  writeSettings(settingsFile, settings);

  return { target, settingsFile, usageApi, previous, configFile: configPath() };
}

function uninstall() {
  const settingsFile = settingsPath();
  const settings = readSettings(settingsFile);
  const removed = Boolean(settings.statusLine);
  delete settings.statusLine;
  writeSettings(settingsFile, settings);

  for (const file of [cachePath()]) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
  try { fs.rmSync(runtimeDir(), { recursive: true, force: true }); } catch { /* ignore */ }

  return { removed, settingsFile, configDir: claudeConfigDir() };
}

module.exports = {
  install,
  uninstall,
  commandString,
  consentNotice,
  previewLines,
  readSettings,
  writeSettings,
  isVersionManaged,
  resolveNodeBinary,
};
