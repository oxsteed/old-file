type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const values = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
const MAX_CACHE_ENTRIES = 200;

/** Deduplicate short-lived public reads without caching account-specific data. */
export function cachePublicRequest<T>(
  key: string,
  request: () => Promise<T>,
  ttlMs = 30_000,
): Promise<T> {
  const cached = values.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
  if (cached) values.delete(key);

  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const pending = request()
    .then((value) => {
      values.set(key, { value, expiresAt: Date.now() + ttlMs });
      while (values.size > MAX_CACHE_ENTRIES) values.delete(values.keys().next().value as string);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, pending);
  return pending;
}
