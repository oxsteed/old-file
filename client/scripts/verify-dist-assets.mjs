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

function collect(entry) {
  if (!entry || typeof entry !== 'object') return;
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
}

console.log(`[dist-assets] verified ${files.size} emitted assets`);
