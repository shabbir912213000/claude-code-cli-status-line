'use strict';

const os = require('os');
const path = require('path');

const RUNTIME_DIR_NAME = 'claude-code-cli-status-line';

// Claude Code honors CLAUDE_CONFIG_DIR on Linux and Windows; it defaults to ~/.claude
// on every platform.
function claudeConfigDir() {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.join(os.homedir(), '.claude');
}

function runtimeDir() {
  return path.join(claudeConfigDir(), RUNTIME_DIR_NAME);
}

module.exports = {
  RUNTIME_DIR_NAME,
  claudeConfigDir,
  runtimeDir,
  settingsPath: () => path.join(claudeConfigDir(), 'settings.json'),
  configPath: () => path.join(runtimeDir(), 'config.json'),
  cachePath: () => path.join(runtimeDir(), 'usage-cache.json'),
  entryPath: () => path.join(runtimeDir(), 'statusline.js'),
  credentialsPath: () => path.join(claudeConfigDir(), '.credentials.json'),
};
