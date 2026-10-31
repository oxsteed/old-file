// No-growth gate for the CSP style migration (see server/middleware/securityHeaders.js).
// React style={} attributes render as inline style attributes, which a CSP
// without 'unsafe-inline' blocks, so every new occurrence pushes the migration
// further out. This check fails the build when the count grows past the
// recorded baseline, and fails when a new <style> JSX tag appears outside
// the allowlist (converted tags live in CSS files now; the allowlisted
// StatusPage tag is documented in the baseline file).
//
// To lower the baseline after a real conversion, convert the styles, run
// this script with CSP_BASELINE_WRITE=1, and commit the updated baseline
// alongside the conversion.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..', 'src');
const baselinePath = path.join(dir, 'inlineStylesBaseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const STYLE_ATTR = /style\s*=\s*\{/g;
const STYLE_TAG = /<style[\s>]/g;

function* walk(current) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(jsx|js|tsx|ts)$/.test(entry.name)) yield full;
  }
}

let styleAttrs = 0;
const strayTags = [];
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  styleAttrs += (src.match(STYLE_ATTR) || []).length;
  const tags = (src.match(STYLE_TAG) || []).length;
  if (tags > 0) {
    const rel = path.relative(path.join(dir, '..'), file);
    if (!baseline.allowedStyleTagFiles.includes(rel)) strayTags.push(`${rel} (${tags})`);
  }
}

const failures = [];
if (styleAttrs > baseline.styleAttrOccurrences) {
  failures.push(
    `inline style={} occurrences grew: ${styleAttrs} > baseline ${baseline.styleAttrOccurrences} ` +
      `(convert styles to CSS classes and lower the baseline deliberately, do not just bump it)`,
  );
}
if (strayTags.length > 0) {
  failures.push(`new <style> JSX tags outside the allowlist: ${strayTags.join(', ')}`);
}

if (process.env.CSP_BASELINE_WRITE === '1') {
  baseline.styleAttrOccurrences = styleAttrs;
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`[no-new-inline-styles] baseline updated to ${styleAttrs} style={} occurrences`);
  process.exit(0);
}

console.log(
  `[no-new-inline-styles] style={} occurrences: ${styleAttrs} (baseline ${baseline.styleAttrOccurrences}), ` +
    `stray <style> tags: ${strayTags.length}`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`[no-new-inline-styles] FAIL: ${failure}`);
  process.exit(1);
}
