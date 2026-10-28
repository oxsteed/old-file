import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(clientRoot, 'dist');
const manifestCandidates = [
  join(distRoot, '.vite', 'manifest.json'),
  join(distRoot, 'manifest.json'),
];
const manifestPath = manifestCandidates.find(existsSync);
assert.ok(manifestPath, 'Vite manifest is missing from the production build');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const files = new Set();
const visitedEntries = new Set();

function collect(entry) {
  if (!entry || typeof entry !== 'object' || visitedEntries.has(entry)) return;
  visitedEntries.add(entry);
  for (const key of ['file', 'css', 'assets']) {
    const values = Array.isArray(entry[key]) ? entry[key] : [entry[key]];
    for (const value of values) {
      if (typeof value === 'string') files.add(value);
    }
  }
  for (const key of ['imports', 'dynamicImports']) {
    for (const value of entry[key] || []) {
      const imported = manifest[value];
      if (imported) collect(imported);
    }
  }
}

for (const entry of Object.values(manifest)) collect(entry);

for (const file of files) {
  assert.ok(existsSync(join(distRoot, file)), `Build manifest references missing asset: ${file}`);
  if (!file.endsWith('.css')) continue;
  const css = readFileSync(join(distRoot, file), 'utf8');
  // Unresolved CSS URLs are omitted from Vite's asset manifest. Check local
  // font references too, so a successful build cannot silently ship fallbacks.
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g)) {
    const reference = (match[1] ?? match[2] ?? match[3]).trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)
      || !/\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(reference)) continue;
    const url = new URL(reference, `https://build.invalid/${file}`);
    assert.ok(existsSync(join(distRoot, decodeURIComponent(url.pathname))),
      `Built CSS references missing font: ${file} -> ${reference}`);
  }
}

console.log(`[dist-assets] verified ${files.size} emitted assets`);
