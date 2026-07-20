'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { credentialsPath } = require('./paths');

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function extractToken(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const token = parsed?.claudeAiOauth?.accessToken;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

function fromFile(file = credentialsPath()) {
  try {
    return extractToken(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function fromKeychain() {
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return extractToken(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the Claude.ai OAuth access token for the current machine.
 *
 * Storage differs per platform:
 *   macOS   - encrypted Keychain, read through the `security` CLI
 *   Linux   - ~/.claude/.credentials.json (mode 0600)
 *   Windows - %USERPROFILE%\.claude\.credentials.json
 * CLAUDE_CONFIG_DIR relocates the file on Linux and Windows.
 *
 * Returns { token, source } or { token: null, source: null }.
 */
function readToken({ platform = process.platform, env = process.env } = {}) {
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { token: env.CLAUDE_CODE_OAUTH_TOKEN, source: 'CLAUDE_CODE_OAUTH_TOKEN' };
  }

  if (platform === 'darwin') {
    const token = fromKeychain();
    if (token) return { token, source: 'macOS Keychain' };
    // A relocated CLAUDE_CONFIG_DIR can still leave a file-based credential on macOS.
    const fileToken = fromFile();
    if (fileToken) return { token: fileToken, source: credentialsPath() };
    return { token: null, source: null };
  }

  const token = fromFile();
  return token ? { token, source: credentialsPath() } : { token: null, source: null };
}

function describeSource(platform = process.platform) {
  if (platform === 'darwin') return `macOS Keychain (service "${KEYCHAIN_SERVICE}")`;
  if (platform === 'win32') return `${credentialsPath()} (your user profile)`;
  return `${credentialsPath()} (mode 0600)`;
}

module.exports = { KEYCHAIN_SERVICE, readToken, describeSource, extractToken, fromFile };
