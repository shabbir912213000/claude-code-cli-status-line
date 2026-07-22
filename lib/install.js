'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  claudeConfigDir, runtimeDir, settingsPath, configPath, cachePath, entryPath,
} = require('./paths');
const { load, save } = require('./config');

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

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    const finish = (answer = '') => {
      if (answered) return;
      answered = true;
      if (!process.stdin.isTTY) process.stdout.write('\n');
      rl.close();
      resolve(answer.trim().toLowerCase());
    };
    rl.question(question, finish);
    rl.once('close', () => finish());
  });
}

async function resolveUsageApi(flags) {
  if (flags.usageApi === true) return true;
  if (flags.usageApi === false) return false;
  if (flags.yes) return false;
  const answer = await ask('Enable Usage API extras for model limits and credit spend? [y/N] ');
  return answer === 'y' || answer === 'yes';
}

function setUsageApi(enabled) {
  const config = load();
  config.usageApi = enabled;
  save(config);
}

async function install(sourceRoot = path.join(__dirname, '..')) {
  const target = runtimeDir();
  fs.mkdirSync(target, { recursive: true });
  copyRuntime(sourceRoot, target);

  setUsageApi(false);

  const settingsFile = settingsPath();
  const settings = readSettings(settingsFile);
  const previous = settings.statusLine?.command;
  settings.statusLine = { type: 'command', command: commandString() };
  writeSettings(settingsFile, settings);

  return { target, settingsFile, previous, configFile: configPath() };
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
  resolveUsageApi,
  setUsageApi,
  readSettings,
  writeSettings,
  isVersionManaged,
  resolveNodeBinary,
};
