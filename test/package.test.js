'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

test('packed artifact exposes an executable CLI and installs in isolation', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'status-line-package-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const cache = path.join(temp, 'npm-cache');
  const configDir = path.join(temp, '.claude');
  const env = { ...process.env, npm_config_cache: cache, NO_COLOR: '1' };

  const packed = spawnSync(npm, ['pack', '--json', '--pack-destination', temp], {
    cwd: ROOT, env, encoding: 'utf8',
  });
  assert.strictEqual(packed.status, 0, packed.stderr);

  const packResult = JSON.parse(packed.stdout);
  const metadata = Array.isArray(packResult) ? packResult[0] : Object.values(packResult)[0];
  const files = new Map(metadata.files.map((file) => [file.path, file]));
  assert.strictEqual(files.get('bin/cli.js').mode, 0o755);
  for (const required of ['statusline.js', 'lib/install.js', 'lib/render.js', 'lib/usage.js']) {
    assert.ok(files.has(required), `${required} is included`);
  }

  const tarball = path.join(temp, metadata.filename);
  const installed = spawnSync(npx, [
    '--yes', '--package', tarball, 'claude-code-cli-status-line', 'install', '--no-usage-api',
  ], {
    cwd: temp,
    env: { ...env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
  assert.strictEqual(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /^\u2713 Status line installed\./);
  assert.ok(fs.existsSync(path.join(configDir, 'claude-code-cli-status-line', 'statusline.js')));
  const settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
  assert.strictEqual(settings.statusLine.type, 'command');
});
