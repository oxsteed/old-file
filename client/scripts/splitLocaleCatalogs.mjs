import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const localeDirectory = join(scriptDirectory, '../src/locales');
const outputDirectory = join(localeDirectory, 'generated');
const languages = ['en', 'es', 'fr', 'ht', 'ar'];
const maxShardBytes = 450 * 1024;

await mkdir(outputDirectory, { recursive: true });

for (const language of languages) {
  const catalog = JSON.parse(
    await readFile(join(localeDirectory, `${language}.json`), 'utf8'),
  );
  const entries = Object.entries(catalog);
  const shards = [[], []];
  const shardSizes = [0, 0];
  const assignments = new Map();

  for (const { key, size } of entries
    .map(([key, value]) => ({ key, value, size: Buffer.byteLength(JSON.stringify({ [key]: value })) - 2 }))
    .sort((left, right) => right.size - left.size)) {
    const shardIndex = shardSizes[0] <= shardSizes[1] ? 0 : 1;
    assignments.set(key, shardIndex);
    shardSizes[shardIndex] += size;
  }

  if (Math.max(...shardSizes) > maxShardBytes) {
    throw new Error(`${language} locale shard exceeds ${maxShardBytes} bytes; update the split strategy.`);
  }

  for (const [key, value] of entries) {
    shards[assignments.get(key)].push([key, value]);
  }

  await Promise.all(shards.map((shard, index) => writeFile(
    join(outputDirectory, `${language}-${index}.json`),
    `${JSON.stringify(Object.fromEntries(shard))}\n`,
  )));
}
