# Resource and API Cost Optimization

This runbook records the seven low-risk savings changes for the OxSteed
production app. It is intentionally measurement-first: do not increase worker
counts, database size, or map-provider limits until the measurements below
show a sustained bottleneck.

## 1. Share Redis across app instances

The production compose file already passes `REDIS_URL` into the app. In
Coolify, set `REDIS_URL` to the shared Redis service URL for the production
environment. Do not use a loopback URL or a per-container Redis instance when
running more than one app container.

Redis is an optimization, not a hard dependency. If it is unavailable, the
app falls back to short-lived in-process caches, so verify the deployment after
setting the variable instead of assuming a restart succeeded:

```text
/ready
/api/health/deep
```

The shared cache currently covers AWS/Google geocoding and route lookups plus
public helper-directory pages. Provider results remain short-lived to avoid
stale locations and to bound memory usage.

## 2. Defer non-critical translation payloads

Terms and privacy catalogs are now loaded when a legal page is opened instead
of being included in the initial application locale chunk. The supported
language fallback remains unchanged, including English fallback content if a
localized catalog cannot be loaded.

## 3. Reduce image transfer and decode work

Public cards now use lazy loading and asynchronous image decoding. Profile
image responses and static assets retain explicit cache headers. The next
provider-level step is to add a derivative pipeline (AVIF/WebP plus a small
fallback) behind the configured object storage/CDN; it is deliberately not
enabled here because no image transformer or CDN origin has been configured.
When that pipeline is introduced, keep originals private and publish only
bounded-width derivatives.

## 4. Avoid duplicate homepage location work

Homepage widgets share one browser geolocation request and one permission
prompt. The request uses a ten-minute browser cache and low accuracy because
the homepage only needs an approximate discovery location. Reverse geocoding
continues through the server-side geo cache.

## 5. Keep database reads bounded

The helper directory keeps server-side pagination and caps a page at 25
records. Repeated public pages are reused for 30 seconds in memory and, when
configured, Redis. Before adding indexes, capture the real query plan with
`EXPLAIN (ANALYZE, BUFFERS)` against a production-like dataset and verify the
index improves the slow query without harming writes.

## 6. Deduplicate public API work

The client deduplicates in-flight and recently completed public helper-page
requests. The server adds a short browser/reverse-proxy cache for the same
public response and keeps private/authenticated controller responses out of
that path. Geolocation provider attempts and cache hits are counted so a
cache change can be evaluated against actual provider traffic.

## 7. Measure before scaling

Admins can use the existing monitoring endpoints to capture a baseline:

```text
/api/monitoring/health
/api/monitoring/latency-percentiles
/api/monitoring/database-health
```

The health snapshot now includes process CPU, RSS/heap memory, load average,
geo provider attempts/cache hits, and helper-directory cache hits/misses.
Capture at least one normal peak period and one quiet period before changing
CPU, memory, database pool, or worker settings. Compare p95 latency, error
rate, cache hit rate, provider attempts, and database query latency together;
scaling only one resource can hide the actual bottleneck.

## Coolify verification checklist

- Set `REDIS_URL` as a Coolify environment value/secret for the production app.
- Confirm `/ready` is healthy after the rollout.
- Confirm `/api/health/deep` reports database and cache dependencies as expected.
- Confirm `/api/monitoring/health` is reachable only through admin auth.
- Watch AWS geo provider attempts versus cache hits before increasing AWS limits.
- Add an image derivative/CDN origin only after storage, cache invalidation, and
  rollback behavior are documented.
