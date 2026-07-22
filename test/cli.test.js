'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const PROMPT = 'Enable Usage API extras for model limits and credit spend? [y/N]';

function runCli(configDir, args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, NO_COLOR: '1' },
    input,
    encoding: 'utf8',
  });
}

function makeConfigDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'status-line-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, '.claude');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('install wires the basic status line before offering Usage API extras', (t) => {
  const configDir = makeConfigDir(t);
  const result = runCli(configDir, ['install'], 'n\n');

  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\u2713 Status line installed\.\n\n/);
  assert.ok(result.stdout.includes(PROMPT));
  assert.ok(result.stdout.indexOf('\u2713 Status line installed.') < result.stdout.indexOf(PROMPT));
  assert.match(result.stdout, /Usage API extras: disabled\nRestart Claude Code, or start a new session, to see it\.\n$/);
  assert.ok(!result.stdout.includes('runtime  '));
  assert.ok(!result.stdout.includes('Preview:'));

  const settings = readJson(path.join(configDir, 'settings.json'));
  assert.strictEqual(settings.statusLine.type, 'command');
  assert.ok(fs.existsSync(path.join(configDir, 'claude-code-cli-status-line', 'statusline.js')));
  assert.strictEqual(readJson(path.join(configDir, 'claude-code-cli-status-line', 'config.json')).usageApi, false);
});

test('accepting the prompt enables Usage API extras', (t) => {
  const configDir = makeConfigDir(t);
  const result = runCli(configDir, ['install'], 'yes\n');

  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(PROMPT));
  assert.match(result.stdout, /Usage API extras: enabled\nRestart Claude Code, or start a new session, to see it\.\n$/);
  assert.strictEqual(readJson(path.join(configDir, 'claude-code-cli-status-line', 'config.json')).usageApi, true);
});

test('install flags choose the Usage API state without prompting', (t) => {
  const configDir = makeConfigDir(t);
  const enabled = runCli(configDir, ['install', '--usage-api']);
  assert.strictEqual(enabled.status, 0, enabled.stderr);
  assert.ok(!enabled.stdout.includes(PROMPT));
  assert.match(enabled.stdout, /Usage API extras: enabled/);

  const disabled = runCli(configDir, ['install', '--no-usage-api']);
  assert.strictEqual(disabled.status, 0, disabled.stderr);
  assert.ok(!disabled.stdout.includes(PROMPT));
  assert.match(disabled.stdout, /Usage API extras: disabled/);
});

test('installation failure is concise and skips the Usage API prompt', (t) => {
  const configDir = makeConfigDir(t);
  fs.mkdirSync(path.dirname(configDir), { recursive: true });
  fs.writeFileSync(configDir, 'not a directory');

  const result = runCli(configDir, ['install'], 'yes\n');

  assert.notStrictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  assert.ok(!result.stderr.includes(PROMPT));
  assert.match(result.stderr, /^error: .+\n$/);
});

test('uninstall removes the status-line wiring and runtime', (t) => {
  const configDir = makeConfigDir(t);
  const installed = runCli(configDir, ['install', '--no-usage-api']);
  assert.strictEqual(installed.status, 0, installed.stderr);

  const result = runCli(configDir, ['uninstall']);

  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(readJson(path.join(configDir, 'settings.json')), {});
  assert.ok(!fs.existsSync(path.join(configDir, 'claude-code-cli-status-line')));
});
