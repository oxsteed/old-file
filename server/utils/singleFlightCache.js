'use strict';
const crypto = require('crypto');
// Request-derived keys contain hashes only; retain at most max successful
// results, and always evict failed work so temporary outages can recover.
function createSingleFlightCache({ max = 100, ttlMs = 600000 } = {}) {
  const entries = new Map();
  return async (input, work) => {
    const key = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const prior = entries.get(key);
    if (prior && (prior.pending || prior.expires > Date.now())) return prior.promise;
    if (entries.size >= max) {
      for (const [k, v] of entries) if (!v.pending) { entries.delete(k); break; }
      if (entries.size >= max) throw new Error('ai_work_capacity_reached');
    }
    const entry = { pending: true, expires: Date.now() + ttlMs };
    entry.promise = Promise.resolve().then(work).then(value => {
      entry.pending = false; entry.expires = Date.now() + ttlMs; return value;
    }, error => { entries.delete(key); throw error; });
    entries.set(key, entry);
    return entry.promise;
  };
}
module.exports = { createSingleFlightCache };
