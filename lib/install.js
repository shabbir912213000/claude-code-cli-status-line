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

function previewLines() {
  const base = defaults();
  const withoutFeature = { ...base, segments: { ...base.segments, modelWeekly: false } };
  const withFeature = { ...base, segments: { ...base.segments, modelWeekly: true } };
  return {
    without: buildLine(SAMPLE_INPUT, withoutFeature, { usage: null }),
    with: buildLine(SAMPLE_INPUT, withFeature, { usage: SAMPLE_USAGE }),
  };
}

/** Everything the user is agreeing to, shown before the opt-in prompt. */
function consentNotice(platform = process.platform) {
  const preview = previewLines();
  return [
    '',
    bold('  Optional feature: model-specific weekly limit'),
    '',
    '  Claude Code does not send the per-model weekly limit to status line scripts,',
    '  so this feature reads it from the same usage API the claude.ai usage page uses.',
    '',
    `  ${bold('What is accessed:')} your local Claude Code OAuth token, read from`,
    `    ${dim(describeSource(platform))}`,
    `  ${bold('What it is used for:')} one HTTPS request to`,
    `    ${dim('https://api.anthropic.com/api/oauth/usage')}`,
    `    to read your plan's usage percentages. At most once every 5 minutes, cached locally.`,
    `  ${bold('Where it goes:')} only to Anthropic's own API. The token is never written to`,
    '    the cache, never logged, and never sent anywhere else.',
    `  ${bold('Revoke anytime:')} rerun with --no-model-limits, or set segments.modelWeekly`,
    `    to false in ${dim(configPath())}`,
    '',
    `  ${bold('Without this feature')} your status line looks like:`,
    `    ${preview.without}`,
    '',
    `  ${bold('With this feature')} it gains the last segment:`,
    `    ${preview.with}`,
    dim('     (the trailing segment appears only for models that have their own weekly limit,'),
    dim('      and disappears automatically when you switch to a model that does not)'),
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

async function resolveModelLimits(flags) {
  if (flags.modelLimits === true) return true;
  if (flags.modelLimits === false) return false;
  if (flags.yes || !process.stdin.isTTY) return false; // safe default when unattended
  process.stdout.write(consentNotice());
  const answer = await ask(`  Enable it? ${dim('[y/N]')} `);
  return answer === 'y' || answer === 'yes';
}

async function install(flags = {}, sourceRoot = path.join(__dirname, '..')) {
  const target = runtimeDir();
  fs.mkdirSync(target, { recursive: true });
  copyRuntime(sourceRoot, target);

  const modelWeekly = await resolveModelLimits(flags);

  const config = load();
  config.segments.modelWeekly = modelWeekly;
  save(config);

  const settingsFile = settingsPath();
  const settings = readSettings(settingsFile);
  const previous = settings.statusLine?.command;
  settings.statusLine = { type: 'command', command: commandString() };
  writeSettings(settingsFile, settings);

  return { target, settingsFile, modelWeekly, previous, configFile: configPath() };
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
