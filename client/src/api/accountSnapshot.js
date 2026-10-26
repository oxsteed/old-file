import api from './axios';
const snapshots = new Map();
// Coalesce simultaneous Navbar/dashboard mounts and short reconnect bursts.
// Account identity is part of every key; no cross-account cache reuse.
export function getAccountSnapshot(userId, path, params) {
  const key = JSON.stringify([userId, path, params || null]);
  const prior = snapshots.get(key);
  if (prior && (prior.pending || Date.now() - prior.at < 5000)) return prior.promise;
  const entry = { at: Date.now(), pending: true };
  entry.promise = api.get(path, params ? { params } : undefined).then(value => {
    entry.pending = false; entry.at = Date.now(); return value;
  }, error => { snapshots.delete(key); throw error; });
  snapshots.set(key, entry);
  if (snapshots.size > 50) for (const [k, v] of snapshots) {
    if (!v.pending && k !== key) snapshots.delete(k);
    if (snapshots.size <= 25) break;
  }
  return entry.promise;
}
export function invalidateAccountSnapshots(userId) {
  for (const key of snapshots.keys()) if (JSON.parse(key)[0] === userId) snapshots.delete(key);
}
