'use strict';

/**
 * V2-P1-06 — inventory of every mutated module-scope Map/Set in the server.
 *
 * Each entry classifies one process-local collection per the contract in
 * utils/processState.js. The processStateInventory test fails CI when a
 * mutated module-scope `new Map()` / `new Set()` is found in source without
 * a matching entry here, so new code cannot regress to unclassified
 * in-process state.
 *
 * Authoritative leases, throttles, and idempotency keys MUST NOT be
 * in-process: they live in Redis (SET NX EX fencing via
 * processState.tryAcquireOnce) or PostgreSQL (unique constraints /
 * advisory locks). Pure caches may stay in-process with TTL + size
 * bounds (processState.createTtlCache).
 */

const { registerProcessState } = require('./processState');

const ENTRIES = [
  // ── Caches (TTL-bounded, DB/provider-backed; safe in-process) ──────────
  {
    file: 'controllers/geoController.js', name: 'cache',
    classification: 'cache', shared: 'redis',
    rationale: 'Geocode result cache: 24h TTL, size-capped, backed by a Redis shared-cache layer (geo-cache:v1:) with in-memory L1. Backing store is the geo provider.',
  },
  {
    file: 'controllers/geoController.js', name: 'nearbyCache',
    classification: 'cache', shared: 'redis',
    rationale: 'Nearby-search cache: 2min TTL, size-capped, Redis shared layer. Backing store is the geo provider.',
  },
  {
    file: 'controllers/geoController.js', name: 'routeCache',
    classification: 'cache', shared: 'redis',
    rationale: 'Route/matrix cache: 30s TTL, size-capped, Redis shared layer. Backing store is the geo provider.',
  },
  {
    file: 'controllers/helpersController.js', name: 'directoryCache',
    classification: 'cache', shared: 'redis',
    rationale: 'Helper directory cache: 30s TTL, 250-entry cap, Redis shared layer (directory:v1:). Backing store is PostgreSQL.',
  },
  {
    file: 'controllers/houseController.js', name: 'cache',
    classification: 'cache', shared: 'none',
    rationale: 'Census/Overpass/FEMA lookup cache: 7d TTL, 300-entry cap. Backing stores are slow public APIs; staleness bounded by TTL.',
  },
  {
    file: 'controllers/vehicleController.js', name: 'cache',
    classification: 'cache', shared: 'none',
    rationale: 'NHTSA vehicle-data cache: 24h TTL, 200-entry cap. Backing store is the NHTSA API.',
  },
  {
    file: 'services/corporateRolesService.js', name: 'cache',
    classification: 'cache', shared: 'none',
    rationale: 'Corporate role resolution cache: 60s TTL, size-capped. Backing store is PostgreSQL; role changes propagate within the TTL.',
  },
  {
    file: 'services/permissionsService.js', name: 'cache',
    classification: 'cache', shared: 'none',
    rationale: 'Business permission cache: 30s TTL, size-capped, with targeted invalidation on grant changes. Backing store is PostgreSQL.',
  },
  {
    file: 'services/pricingService.js', name: 'priceCache',
    classification: 'cache', shared: 'none',
    rationale: 'Country pricing cache: 15min TTL, keyed by country code (bounded keyspace). Backing store is PostgreSQL.',
  },
  {
    file: 'services/pricingSignals.js', name: 'segmentCache',
    classification: 'cache', shared: 'none',
    rationale: 'Customer segment cache: 10min TTL, size-capped. Backing store is PostgreSQL.',
  },
  {
    file: 'services/pricingSignals.js', name: 'demandCache',
    classification: 'cache', shared: 'none',
    rationale: 'Demand signal cache: 10min TTL, size-capped. Backing store is PostgreSQL.',
  },
  {
    file: 'routes/priceGuidance.js', name: 'cache',
    classification: 'cache', shared: 'none',
    rationale: 'Price guidance aggregate cache: 5min TTL, 500-entry cap with full clear on overflow. Backing store is PostgreSQL.',
  },
  {
    file: 'services/modePlatformApprovalService.js', name: 'POLICY_CACHE',
    classification: 'cache', shared: 'none',
    rationale: 'Mode policy cache: 60s TTL. Backing store is PostgreSQL.',
  },
  {
    file: 'middleware/prerenderHelperProfile.js', name: 'seoLocaleCache',
    classification: 'cache', shared: 'none',
    rationale: 'SEO locale bundle cache: TTL-bounded via createTtlCache. Bundles are static per deploy.',
  },
  {
    file: 'middleware/prerenderHelperProfile.js', name: 'seoContentLocaleCache',
    classification: 'cache', shared: 'none',
    rationale: 'SEO content cache: TTL-bounded via createTtlCache. Backing store is PostgreSQL.',
  },
  {
    file: 'services/realtimePresence.js', name: 'remoteSnapshot',
    classification: 'cache', shared: 'redis',
    rationale: 'Cross-process presence snapshot refreshed from Redis every 5s. Replaced wholesale, never mutated in place.',
  },
  {
    file: 'utils/translateService.js', name: 'cache',
    classification: 'cache', shared: 'none',
    rationale: 'LibreTranslate result cache: 24h TTL, 20k-entry cap via createTtlCache. Translations are immutable, so a long TTL is safe.',
  },
  {
    file: 'utils/dbBudgets.js', name: 'budgetConfigs',
    classification: 'cache', shared: 'none',
    rationale: 'Workload budget config registry: env-derived at first use, explicitly overridable via configureBudget(). Process config; changes take effect on restart or explicit override.',
  },
  {
    file: 'controllers/adminOperationsController.js', name: 'columnsCache',
    classification: 'cache', shared: 'none',
    rationale: 'information_schema column probe cache: 60s TTL, per-table entries. Backing store is PostgreSQL information_schema; schema changes propagate within the TTL. Eliminates N+1 schema probes on the operations overview endpoint.',
  },

  // ── Leases / presence (Redis with TTL) ──────────────────────────────────
  {
    file: 'services/realtimePresence.js', name: 'localOnline',
    classification: 'lease', shared: 'redis',
    rationale: 'Per-process refcount of locally-online entities. Authoritative presence lives in Redis hashes realtime:presence:<kind>:<id> with a 45s TTL heartbeat per process; crashed processes self-heal via TTL expiry.',
  },

  // ── Security lists (Redis-primary, TTL-bounded fallback) ────────────────
  {
    file: 'services/tokenRevocationService.js', name: 'tokenBlacklist',
    classification: 'security-list', shared: 'redis',
    rationale: 'JWT revocation list. Redis-primary (revoked:<jti> with TTL matching token lifetime). In-memory fallback is a TTL-bounded cache, single-instance only.',
  },
  {
    file: 'services/tokenRevocationService.js', name: 'userRevocationMarkers',
    classification: 'security-list', shared: 'redis',
    rationale: 'User-level revocation timestamps. Redis-primary (revoked:user:<id>, 7d TTL). In-memory fallback is a TTL-bounded cache, single-instance only.',
  },
  {
    file: 'middleware/csrf.js', name: 'tokenMap',
    classification: 'security-list', shared: 'redis',
    rationale: 'CSRF tokens. Redis-primary (csrf:<userId>, 24h TTL). In-memory fallback is a TTL-bounded cache, single-instance only.',
  },

  // ── Semaphores (per-process concurrency guards; correct in-process) ─────
  {
    file: 'utils/dbBudgets.js', name: 'budgetState',
    classification: 'semaphore', shared: 'none',
    rationale: 'Per-workload semaphore guarding this process\'s own pg pool slots. Per-process granularity is correct: each process owns a separate pool; Postgres max_connections is the global ceiling. Exhaustion fails closed with 503.',
  },

  // ── Ephemeral (socket handles / in-flight guards; die with process) ─────
  {
    file: 'services/socketService.js', name: 'onlineMap',
    classification: 'ephemeral', shared: 'none',
    rationale: 'Socket-handle bookkeeping (userId -> socketIds) for THIS process only. Online/offline routing decisions use the realtimePresence contract (Redis), not this map; isOnline() consults both.',
  },
  {
    file: 'workerMain.js', name: 'activeJobs',
    classification: 'ephemeral', shared: 'none',
    rationale: 'Per-process in-flight job counters for queue polling. Each worker process polls independently; counters die with the process.',
  },
  {
    file: 'workerMain.js', name: 'trackingInFlight',
    classification: 'ephemeral', shared: 'none',
    rationale: 'Per-process overlap guard for setInterval tracking workers. The interval only fires in this process, so the guard is correct in-process.',
  },
  {
    file: 'utils/processState.js', name: 'memoryFences',
    classification: 'lease', shared: 'none',
    rationale: 'Single-process fallback for the fencing helpers (tryAcquireOnce/throttleOnce) when Redis is unavailable. TTL-bounded, 10k-entry cap, warns once. Production must set REDIS_URL for cross-process fencing.',
  },
  {
    file: 'utils/providerCircuitBreaker.js', name: 'localStates',
    classification: 'semaphore', shared: 'redis',
    rationale: 'In-memory fallback for per-provider circuit breaker state when REDIS_URL is not set. Bounded (256 entries) and self-expiring on read. Production shares breaker state in Redis (provider-circuit:v1:*); the fallback is single-instance dev/test only.',
  },
  {
    file: 'services/providerHealthRegistry.js', name: 'breakers',
    classification: 'constant', shared: 'none',
    rationale: 'Write-once registry of per-provider circuit breaker singletons (one per provider id, populated lazily on first access). Holds no authoritative state itself; breaker state lives in Redis or the registered fallback map above.',
  },
  {
    file: 'services/providerHealthRegistry.js', name: 'probeCache',
    classification: 'cache', shared: 'none',
    rationale: '60s TTL cache of provider probe snapshots for the operator view (max 32 entries). Backing truth is the live provider; staleness is bounded by the TTL.',
  },
];

for (const entry of ENTRIES) registerProcessState(entry);

module.exports = { ENTRIES };
