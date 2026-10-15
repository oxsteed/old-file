import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const localeDirectory = join(scriptDirectory, '../src/locales');
const outputDirectory = join(localeDirectory, 'generated');
const languages = ['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th'];
// Arabic needs more than three shards after the Media recovery translations.
// Keep the per-shard transfer cap while allowing a bounded number of shards
// as catalogs grow.
const maxShardBytes = 528 * 1024;
const minimumShardCount = 3;
const maxAllowedShards = 6;

await mkdir(outputDirectory, { recursive: true });

for (const language of languages) {
  const catalog = JSON.parse(
    await readFile(join(localeDirectory, `${language}.json`), 'utf8'),
  );
  const entries = Object.entries(catalog);
  const sizedEntries = entries
    .map(([key, value]) => ({
      key,
      value,
      size: Buffer.byteLength(JSON.stringify({ [key]: value })) - 2,
    }))
    .sort((left, right) => right.size - left.size);
  const totalBytes = sizedEntries.reduce((sum, entry) => sum + entry.size, 0);

  const createShards = (count) => {
    const shards = Array.from({ length: count }, () => []);
    const shardSizes = Array.from({ length: count }, () => 0);
    const assignments = new Map();

    for (const { key, size } of sizedEntries) {
      const shardIndex = shardSizes.indexOf(Math.min(...shardSizes));
      assignments.set(key, shardIndex);
      shardSizes[shardIndex] += size;
    }

    // Restore the source catalog order so generated files remain stable and
    // diffs stay readable even when the balancing algorithm changes.
    for (const [key, value] of entries) {
      shards[assignments.get(key)].push([key, value]);
    }

    return {
      shards,
      // Include JSON punctuation and the trailing newline in the safety check.
      actualSizes: shards.map((shard) => Buffer.byteLength(`${JSON.stringify(Object.fromEntries(shard))}\n`)),
    };
  };

  let shardCount = Math.max(minimumShardCount, Math.ceil(totalBytes / maxShardBytes));
  let split = createShards(shardCount);
  while (Math.max(...split.actualSizes) > maxShardBytes) {
    shardCount += 1;
    if (shardCount > maxAllowedShards) {
      throw new Error(
        `${language} locale requires more than ${maxAllowedShards} shards `
        + `(total ${totalBytes} bytes; largest ${Math.max(...split.actualSizes)} bytes).`,
      );
    }
    split = createShards(shardCount);
  }

  const { shards } = split;

  await Promise.all(shards.map(async (shard, index) => {
    const outputPath = join(outputDirectory, `${language}-${index}.json`);
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(shard))}\n`);
    await rename(temporaryPath, outputPath);
  }));
}
