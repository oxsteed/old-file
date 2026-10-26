'use strict';
// Workers await only a bounded number of operations; one recipient cannot
// prevent the rest of its page from starting. Callers own per-item error policy.
async function mapBounded(items, concurrency, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  }));
  return results;
}
module.exports = { mapBounded };
