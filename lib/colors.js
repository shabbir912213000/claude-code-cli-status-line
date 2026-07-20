'use strict';

const ESC = '';

const CODES = {
  reset: `${ESC}[0m`,
  bold: `${ESC}[1m`,
  dim: `${ESC}[2m`,
  black: `${ESC}[30m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  magenta: `${ESC}[35m`,
  cyan: `${ESC}[36m`,
  white: `${ESC}[37m`,
  gray: `${ESC}[90m`,
  brightRed: `${ESC}[91m`,
  brightGreen: `${ESC}[92m`,
  brightYellow: `${ESC}[93m`,
  brightBlue: `${ESC}[94m`,
  brightMagenta: `${ESC}[95m`,
  brightCyan: `${ESC}[96m`,
};

// NO_COLOR is a cross-tool convention; respect it so the line degrades to plain text.
function colorEnabled(env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.CLAUDE_STATUSLINE_NO_COLOR === '1') return false;
  return true;
}

function makePainter(enabled) {
  return function paint(text, ...names) {
    const str = text === undefined || text === null ? '' : String(text);
    if (!enabled || str === '') return str;
    const prefix = names.map((n) => CODES[n] || '').join('');
    return prefix ? `${prefix}${str}${CODES.reset}` : str;
  };
}

module.exports = { ESC, CODES, colorEnabled, makePainter };
