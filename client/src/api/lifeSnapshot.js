import api from './axios';

const SNAPSHOT_TTL_MS = 5000;
const snapshots = new Map();

// Cost audit 2026-11-13 item 3: the Dashboard mount fires 10 life fetches
// and navigating to /life-dashboard re-fired them, because useLifeDashboard
// did a bare api.get per fetch with no caching. This mirrors
// getAccountSnapshot: coalesce in-flight duplicates and reuse a fresh
// response for 5s, so a mount plus a rapid re-mount or Dashboard ->
// LifeDashboard hop pays once per endpoint. Account identity is part of
// every key; no cross-account cache reuse. Mutations must call
// invalidateLifeSnapshots so the next fetch reads fresh data.
function normalizeUrl(url) {
  const [path, query = ''] = url.split('?');
  if (!query) return path;
  const params = query.split('&').filter(Boolean).sort();
  return params.length ? `${path}?${params.join('&')}` : path;
}

export function getLifeSnapshot(userId, url) {
  const normalized = normalizeUrl(url);
  const key = JSON.stringify([userId, normalized]);
  const prior = snapshots.get(key);
  if (prior && (prior.pending || Date.now() - prior.at < SNAPSHOT_TTL_MS)) return prior.promise;
  const entry = { at: Date.now(), pending: true };
  entry.promise = api.get(normalized).then(value => {
    entry.pending = false; entry.at = Date.now(); return value;
  }, error => { snapshots.delete(key); throw error; });
  snapshots.set(key, entry);
  if (snapshots.size > 50) for (const [k, v] of snapshots) {
    if (!v.pending && k !== key) snapshots.delete(k);
    if (snapshots.size <= 25) break;
  }
  return entry.promise;
}

export function invalidateLifeSnapshots(userId, urlPrefix) {
  const prefix = urlPrefix ? normalizeUrl(urlPrefix) : null;
  const id = userId ?? null;
  for (const key of snapshots.keys()) {
    const [keyUserId, keyUrl] = JSON.parse(key);
    if (keyUserId !== id) continue;
    if (prefix && !keyUrl.startsWith(prefix)) continue;
    snapshots.delete(key);
  }
}
