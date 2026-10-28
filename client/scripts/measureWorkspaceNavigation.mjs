import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(client, 'dist/.vite/manifest.json'), 'utf8'));
function closure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  const item = manifest[key];
  if (!item) throw new Error(`Missing manifest entry: ${key}`);
  seen.add(key);
  for (const dependency of item.imports || []) closure(dependency, seen);
  return seen;
}
// The application shell is already loaded before a client-side transition.
// Dynamic imports remain excluded until their panel is actually opened.
const shell = closure('index.html');
const parts = [...closure('src/pages/BusinessHubPage.jsx')].filter(key => !shell.has(key))
  .map(key => {
    const file = manifest[key].file;
    const contents = fs.readFileSync(path.join(client, 'dist', file));
    return { key, file, bytes: contents.length, gzip: gzipSync(contents).length };
  });
console.log(JSON.stringify({ entry: 'index.html', bytes: parts.reduce((n, part) => n + part.bytes, 0),
  gzip: parts.reduce((n, part) => n + part.gzip, 0), parts }, null, 2));
