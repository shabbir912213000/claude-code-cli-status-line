#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  install, uninstall, resolveUsageApi, setUsageApi,
} = require('../lib/install');
const { load, save, defaults } = require('../lib/config');
const { buildLine } = require('../lib/render');
const { readToken, describeSource } = require('../lib/credentials');
const { readCache, refresh, findModelWeekly, findCredits } = require('../lib/usage');
const {
  runtimeDir, settingsPath, configPath, cachePath, claudeConfigDir,
} = require('../lib/paths');
const { makePainter, colorEnabled } = require('../lib/colors');

const pkg = require('../package.json');
const paint = makePainter(colorEnabled());
const bold = (s) => paint(s, 'bold');
const dim = (s) => paint(s, 'dim');
const ok = (s) => paint(s, 'green');
const bad = (s) => paint(s, 'red');

function parseFlags(argv) {
  const flags = { yes: false, usageApi: undefined };
  for (const arg of argv) {
    if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--usage-api' || arg === '--model-limits') flags.usageApi = true;
    else if (arg === '--no-usage-api' || arg === '--no-model-limits') flags.usageApi = false;
  }
  return flags;
}

const HELP = `
${bold(pkg.name)} ${dim(`v${pkg.version}`)}
${pkg.description}

${bold('Usage')}
  npx ${pkg.name} install [options]   Install and wire into Claude Code settings
  npx ${pkg.name} uninstall           Remove the status line and its files
  npx ${pkg.name} preview             Print a sample line using your config
  npx ${pkg.name} doctor              Diagnose configuration and credentials
  npx ${pkg.name} config              Show the active config and its path

${bold('Install options')}
  --usage-api      Enable usage API extras: model-specific weekly limit, usage-credit
                   spend, and session/weekly for credit-billed models (reads local OAuth token)
  --no-usage-api   Disable them (default when non-interactive)
  -y, --yes        Non-interactive; skips the opt-in prompt

${bold('Docs')}  ${pkg.homepage}
`;

const SAMPLE = {
  model: { display_name: 'Fable 5' },
  effort: { level: 'high' },
  context_window: { used_percentage: 5, current_usage: { input_tokens: 19400 } },
  rate_limits: {
    five_hour: { used_percentage: 67, resets_at: Math.floor(Date.now() / 1000) + 5520 },
    seven_day: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 399900 },
  },
};

async function cmdInstall(flags) {
  try {
    await install();
  } catch (err) {
    const detail = err?.code || 'unknown error';
    throw new Error(`Could not install the status line (${detail}).`);
  }

  process.stdout.write(`${ok('✓')} Status line installed.\n\n`);
  const usageApi = await resolveUsageApi(flags);
  try {
    setUsageApi(usageApi);
  } catch (err) {
    const detail = err?.code || 'unknown error';
    throw new Error(`Status line installed, but could not update Usage API extras (${detail}).`);
  }
  process.stdout.write(`Usage API extras: ${usageApi ? 'enabled' : 'disabled'}\n`);
  process.stdout.write('Restart Claude Code, or start a new session, to see it.\n');
}

function cmdUninstall() {
  const result = uninstall();
  process.stdout.write(`\n${ok('✓')} Removed status line from ${dim(result.settingsFile)}\n`);
  if (!result.removed) process.stdout.write(`  ${dim('(no statusLine entry was configured)')}\n`);
  process.stdout.write(`  ${dim(`Config directory left intact: ${result.configDir}`)}\n\n`);
}

function cmdPreview() {
  const config = load();
  process.stdout.write(`\n  ${buildLine(SAMPLE, config, { usage: readCache().data })}\n\n`);
  process.stdout.write(`  ${dim('sample data; percentages above are illustrative')}\n\n`);
}

function cmdConfig() {
  const file = configPath();
  const exists = fs.existsSync(file);
  if (!exists) save(defaults());
  process.stdout.write(`\n  ${bold('config')} ${dim(file)}${exists ? '' : dim(' (created with defaults)')}\n\n`);
  process.stdout.write(`${JSON.stringify(load(), null, 2)}\n\n`);
}

async function cmdDoctor() {
  const lines = [];
  const check = (label, good, detail) => {
    lines.push(`  ${good ? ok('✓') : bad('✗')} ${label}${detail ? ` ${dim(detail)}` : ''}`);
  };

  lines.push(`\n${bold('Environment')}`);
  check('Node.js', Number(process.versions.node.split('.')[0]) >= 18, `v${process.versions.node} (needs >= 18)`);
  lines.push(`  ${dim(`platform: ${process.platform}`)}`);
  lines.push(`  ${dim(`claude config dir: ${claudeConfigDir()}`)}`);

  lines.push(`\n${bold('Installation')}`);
  const entry = path.join(runtimeDir(), 'statusline.js');
  check('runtime installed', fs.existsSync(entry), entry);
  let wired = false;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    wired = Boolean(settings.statusLine?.command);
    check('settings.json wired', wired, settings.statusLine?.command || 'no statusLine key');
  } catch {
    check('settings.json readable', false, settingsPath());
  }

  const config = load();
  lines.push(`\n${bold('Usage API extras')}`);
  check('enabled in config', config.usageApi, config.usageApi ? '' : 'opt-in; run install --usage-api');

  if (config.usageApi) {
    const { token, source } = readToken();
    check('OAuth token found', Boolean(token), token ? `via ${source}` : `expected at ${describeSource()}`);
    if (token) {
      process.stdout.write(`${lines.join('\n')}\n  ${dim('fetching usage...')}\n`);
      lines.length = 0;
      const result = await refresh();
      check('usage API reachable', result.ok, result.ok ? '' : result.reason);
      if (result.ok) {
        const scoped = findModelWeekly(result.data, 'Fable 5');
        lines.push(`  ${dim(scoped
          ? `example: model-scoped window found for Fable (${Math.round(scoped.percent)}%)`
          : 'no model-scoped weekly window on this plan for Fable; segment stays hidden')}`);
        const credits = findCredits(result.data);
        lines.push(`  ${dim(credits
          ? `usage credits: enabled, $${credits.usedDollars.toFixed(2)} spent${credits.percent === null ? '' : ` (${Math.round(credits.percent)}% of limit)`}`
          : 'usage credits: not enabled on this account; credits segment stays hidden')}`);
      }
    }
  }

  lines.push(`\n${bold('Files')}`);
  lines.push(`  ${dim(`config: ${configPath()}`)}`);
  lines.push(`  ${dim(`cache:  ${cachePath()}`)}`);
  process.stdout.write(`${lines.join('\n')}\n\n`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case 'install': return cmdInstall(flags);
    case 'uninstall': case 'remove': return cmdUninstall();
    case 'preview': return cmdPreview();
    case 'config': return cmdConfig();
    case 'doctor': return cmdDoctor();
    case '--version': case '-v': process.stdout.write(`${pkg.version}\n`); return undefined;
    case undefined: case 'help': case '--help': case '-h': process.stdout.write(HELP); return undefined;
    default:
      process.stderr.write(`Unknown command: ${command}\n${HELP}`);
      process.exitCode = 1;
      return undefined;
  }
}

main().catch((err) => {
  process.stderr.write(`${bad('error:')} ${err?.message || err}\n`);
  process.exitCode = 1;
});
