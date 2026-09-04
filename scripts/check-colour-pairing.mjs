// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Colour-pairing guard (DESIGN §13.1, §13.3).
 *
 * Enforces the two brand rules that are cheap to check statically:
 *   1. Bitcoin Orange is never a text colour. `--fill-bitcoin` is the only
 *      orange token and its name says "fill, not text" — so `text-fill-bitcoin`
 *      / `text-[--fill-bitcoin]` / `color: var(--fill-bitcoin)` are banned.
 *   2. Raw brand hex values live only in `app/globals.css` — everywhere else
 *      uses the semantic tokens.
 *
 * The full accessibility sweep (axe on every route) runs in the Playwright
 * job from M3. Run: `node scripts/check-colour-pairing.mjs`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOTS = ['app', 'components', 'lib'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css']);
const ALLOW_RAW_HEX = new Set(['app/globals.css']);

const BITCOIN_HEX = /#(?:f7931a|c4700c)\b/i;
const ORANGE_AS_TEXT = [
  /\btext-fill-bitcoin\b/i,
  /\btext-\[\s*(?:var\(\s*)?--fill-bitcoin/i,
  /\bcolor\s*:\s*var\(\s*--(?:fill-bitcoin|brand-bitcoin)/i,
];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/** @type {{ file: string, line: number, rule: string, text: string }[]} */
const violations = [];

for (const root of ROOTS) {
  let files;
  try {
    files = walk(root);
  } catch {
    continue;
  }

  for (const file of files) {
    const rel = relative('.', file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((text, index) => {
      if (ORANGE_AS_TEXT.some((pattern) => pattern.test(text))) {
        violations.push({ file: rel, line: index + 1, rule: 'orange-as-text', text: text.trim() });
      }
      if (BITCOIN_HEX.test(text) && !ALLOW_RAW_HEX.has(rel)) {
        violations.push({ file: rel, line: index + 1, rule: 'raw-brand-hex', text: text.trim() });
      }
    });
  }
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
  }
  console.error(`\n${violations.length} colour-pairing violation(s). See docs/DESIGN.md §13.1.`);
  process.exit(1);
}

console.log('colour-pairing check passed');
