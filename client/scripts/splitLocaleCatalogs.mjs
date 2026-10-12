import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const localeDirectory = join(scriptDirectory, '../src/locales');
const outputDirectory = join(localeDirectory, 'generated');
const languages = ['en', 'es', 'fr', 'ht', 'ar'];
// Arabic needs about 513 KiB per shard after the Media recovery translations.
// Allow 16 KiB of headroom above the previous 512 KiB cap while retaining a
// bounded three-shard budget in every supported language.
const maxShardBytes = 528 * 1024;
const shardCount = 3;

await mkdir(outputDirectory, { recursive: true });

for (const language of languages) {
  const catalog = JSON.parse(
    await readFile(join(localeDirectory, `${language}.json`), 'utf8'),
  );
  const entries = Object.entries(catalog);
  const shards = Array.from({ length: shardCount }, () => []);
  const shardSizes = Array.from({ length: shardCount }, () => 0);
  const assignments = new Map();

  for (const { key, size } of entries
    .map(([key, value]) => ({ key, value, size: Buffer.byteLength(JSON.stringify({ [key]: value })) - 2 }))
    .sort((left, right) => right.size - left.size)) {
    const shardIndex = shardSizes.indexOf(Math.min(...shardSizes));
    assignments.set(key, shardIndex);
    shardSizes[shardIndex] += size;
  }

  if (Math.max(...shardSizes) > maxShardBytes) {
    throw new Error(`${language} locale shard exceeds ${maxShardBytes} bytes; update the split strategy.`);
  }

  for (const [key, value] of entries) {
    shards[assignments.get(key)].push([key, value]);
  }

  await Promise.all(shards.map(async (shard, index) => {
    const outputPath = join(outputDirectory, `${language}-${index}.json`);
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(shard))}\n`);
    await rename(temporaryPath, outputPath);
  }));
}
