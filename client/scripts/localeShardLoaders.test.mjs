// The legacy catalogs are split into N shards at build time, and
// src/i18n/index.js imports a fixed list of shards per language and slices
// the first localeLegacyShardCounts[lang] (default 3) modules as legacy
// shards. If a catalog grows into another shard and the loader is not
// updated, that shard's keys silently disappear and the namespaced bundles
// shift position. This test runs the real splitter and checks the two agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th'];

test('every generated legacy shard is imported and counted by the locale loader', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts/splitLocaleCatalogs.mjs')]);
  const generated = fs.readdirSync(path.join(root, 'src/locales/generated'));
  const index = fs.readFileSync(path.join(root, 'src/i18n/index.js'), 'utf8');
  const countsMatch = index.match(/const localeLegacyShardCounts = (\{[^}]*\});/);
  assert.ok(countsMatch, 'localeLegacyShardCounts must exist');
  const counts = Function(`return ${countsMatch[1]}`)();
  for (const language of languages) {
    const shardCount = generated.filter((name) => new RegExp(`^${language}-\\d+\\.json$`).test(name)).length;
    const loader = index.match(new RegExp(`\\n  ${language}: \\(\\) => Promise\\.all\\(\\[([\\s\\S]*?)\\n  \\]\\),`));
    assert.ok(loader, `${language}: loader block`);
    const imported = [...loader[1].matchAll(new RegExp(`generated/${language}-(\\d+)\\.json`, 'g'))].map((m) => Number(m[1]));
    assert.deepEqual(imported, Array.from({ length: shardCount }, (_, i) => i), `${language}: imports every shard in order`);
    assert.equal(counts[language] || 3, shardCount, `${language}: localeLegacyShardCounts`);
  }
});
