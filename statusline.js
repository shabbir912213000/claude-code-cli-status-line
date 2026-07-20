#!/usr/bin/env node
'use strict';

// Status line entry point. Claude Code runs this on every refresh with the session
// JSON on stdin, so it must stay fast and must never throw: any failure would leave
// the user staring at an empty status bar.
//
// This file and ./lib are copied verbatim into ~/.claude/claude-code-cli-status-line/
// by `install`, so the relative require paths below hold in both locations.

const { load } = require('./lib/config');
const { buildLine, loadUsageForRender } = require('./lib/render');

async function refreshUsage() {
  const { refresh } = require('./lib/usage');
  await refresh();
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    // Nothing piped in (e.g. run by hand) - do not hang waiting for input.
    if (process.stdin.isTTY) return resolve('');
    const timer = setTimeout(() => resolve(raw), 2000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); resolve(raw); });
    process.stdin.on('error', () => { clearTimeout(timer); resolve(raw); });
    return undefined;
  });
}

async function main() {
  if (process.argv.includes('--refresh-usage')) {
    await refreshUsage();
    return;
  }

  const raw = await readStdin();
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    input = {};
  }

  const config = load();
  const usage = loadUsageForRender(config);
  process.stdout.write(`${buildLine(input, config, { usage })}\n`);
}

main().catch(() => {
  // Stay silent on unexpected failures rather than printing a stack trace into the UI.
  process.exit(0);
});
