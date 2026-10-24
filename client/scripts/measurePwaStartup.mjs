import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(client, 'dist/.vite/manifest.json')),
);
const budget = JSON.parse(
  fs.readFileSync(path.join(client, 'scripts/pwa-startup-budget.json')),
);
const seen = new Set(),
  chunks = [];
function visit(key) {
  if (seen.has(key)) return;
  seen.add(key);
  const item = manifest[key];
  if (!item) throw Error(`Missing manifest entry: ${key}`);
  for (const dependency of item.imports || []) visit(dependency);
  if (item.file.endsWith('.js')) {
    const bytes = fs.readFileSync(path.join(client, 'dist', item.file));
    chunks.push({
      file: item.file,
      bytes: bytes.length,
      gzip: gzipSync(bytes).length,
    });
  }
}
visit('index.html');
const bytes = chunks.reduce((sum, c) => sum + c.bytes, 0),
  gzip = chunks.reduce((sum, c) => sum + c.gzip, 0);
console.log(
  JSON.stringify(
    {
      bytes,
      gzip,
      reductionPercent:
        Math.round((1 - bytes / budget.baselineJavaScriptBytes) * 1000) / 10,
      chunks,
    },
    null,
    2,
  ),
);
if (
  bytes > budget.maxInitialJavaScriptBytes ||
  gzip > budget.maxInitialGzipBytes
) {
  console.error('PWA startup budget exceeded');
  process.exitCode = 1;
}
