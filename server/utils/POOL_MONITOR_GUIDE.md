# Database Connection Pool Monitoring Guide

## Problem

OxSteed uses a fixed 10-connection pool (`server/db.js: max = 10`), sufficient for ~50 concurrent users. At higher loads:

- Pool can be exhausted (0 available connections)
- Queries queue up waiting for available connections
- Timeout errors cascade through the API
- No visibility into what's happening

## Solution

`poolMonitor.js` tracks real-time pool health and exposes metrics for monitoring.

## Basic Setup

### 1. Initialize Monitor in `server/db.js`

```javascript
const { createPoolMonitor, createTrackingPoolWrapper } = require('./utils/poolMonitor');

// After creating pool
const pool = new Pool({ ... });

// Create monitor
const monitor = createPoolMonitor(pool);

// Optional: Automatically track all queries
createTrackingPoolWrapper(pool, monitor);

// Export for health checks
module.exports = { pool, poolMonitor: monitor };
```

### 2. Expose Metrics Endpoint

In `server/index.js`:

```javascript
const { pool, poolMonitor } = require('./db');

// Add health metrics endpoint
const { requireAdmin } = require('./middleware/adminAuth');

app.get('/api/health/pool', requireAdmin, (req, res) => {
  res.json(poolMonitor.getMetrics());
});
```

The detailed endpoint is admin-only because it exposes connection counts, query
volumes, timing data, and process uptime. Use `/health` or `/ready` for public
load-balancer and uptime checks.

### 3. Monitor from Client

```javascript
// Check pool health
const response = await fetch('/api/health/pool', {
  headers: { Authorization: `Bearer ${adminAccessToken}` },
});
const metrics = await response.json();

console.log(metrics);
// {
//   pool: {
//     max: 10,
//     availableConnections: 3,
//     activeConnections: 7,
//     waitingRequests: 2,
//     exhausted: false
//   },
//   queries: {
//     total: 15234,
//     failed: 12,
//     averageTimeMs: 87,
//     slowestTimeMs: 5234
//   },
//   health: {
//     status: 'healthy',
//     uptime: '3600s'
//   },
//   warnings: []
// }
```

## Metrics Reference

### Pool State

```javascript
{
  pool: {
    max: 10,                          // Max connections
    min: 2,                           // Min connections
    totalConnections: 8,              // Currently open
    availableConnections: 3,          // Ready for queries
    activeConnections: 5,             // Currently executing queries
    waitingRequests: 2,               // Queries waiting for a connection
    exhausted: false                  // true if 0 connections available
  }
}
```

### Query Metrics

```javascript
{
  queries: {
    total: 15234,                     // Queries executed since startup
    failed: 12,                       // Failed queries
    averageTimeMs: 87,                // Avg query duration
    slowestTimeMs: 5234,              // Slowest query ever
    slowestCount: 3                   // How many queries hit slowest time
  }
}
```

### Health Status

| Status | Meaning | Action |
|--------|---------|--------|
| `healthy` | Pool fine, queries fast | Monitor normally |
| `warning` | >70% utilization | Watch for spikes |
| `critical` | >90% utilization | Scale up or optimize |
| `exhausted` | 0 connections available | Emergency - increase pool or reduce load |
| `slow` | Queries waiting for connections | Increase pool max |

### Warnings Generated

- `CRITICAL: Pool exhausted (0 available connections)` — Immediate action needed
- `WARNING: Only 1 connection available` — Almost exhausted
- `N queries waiting for connections` — Pool too small for load
- `N queries failed` — Connection or query issues
- `Average query time Xms (slow)` — Queries taking >1 second
- `Slowest query Xms (very slow)` — Query >5 seconds

## Usage Examples

### Manual Query Tracking

If not using `createTrackingPoolWrapper`, track manually:

```javascript
const { pool, poolMonitor } = require('./db');

async function executeQuery(sql, params) {
  const start = Date.now();
  try {
    const result = await pool.query(sql, params);
    const duration = Date.now() - start;
    poolMonitor.trackQuery(duration, true);
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    poolMonitor.trackQuery(duration, false);
    throw err;
  }
}
```

### Get Recent Query Timings

```javascript
const timings = poolMonitor.getRecentTimings(20);
// [
//   { durationMs: 45, timestamp: '2026-04-18T...', success: true },
//   { durationMs: 1234, timestamp: '2026-04-18T...', success: true },
//   ...
// ]
```

### Get Query Percentile

```javascript
const p95 = poolMonitor.getQueryPercentile(95);
console.log(`95th percentile query: ${p95}ms`);
// 95th percentile query: 234ms
```

### Automated Alerts (example)

```javascript
setInterval(() => {
  const metrics = poolMonitor.getMetrics();
  
  if (metrics.health.status === 'exhausted') {
    sendAlert('CRITICAL: Database connection pool exhausted!', metrics);
  } else if (metrics.health.status === 'critical') {
    sendAlert('WARNING: Pool critically high utilization', metrics);
  }
}, 10000); // Check every 10 seconds
```

## Scaling Recommendations

### Current Capacity
- **Pool max: 10**
- **Sustainable concurrent users: ~50**
- **Sustainable RPS (requests/sec): ~100**

### When to Scale

| Metric | Threshold | Action |
|--------|-----------|--------|
| Available connections | < 2 | Increase max (next tier: 20) |
| Waiting requests | > 5 | Increase max |
| Average query time | > 500ms | Optimize slow queries + increase pool |
| Health status | `critical` | Increase max immediately |

### How to Scale

In `server/db.js`:

```javascript
const pool = new Pool({
  // ... other config ...
  max: 20,  // Increase from 10 to 20
  min: 4,   // Increase from 2 to 4
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

**OR** provision Redis for rate limiting and offload I/O operations.

## Monitoring in Production

### Set up alerts on

1. **Pool exhaustion** (0 available)
2. **High utilization** (>80%)
3. **Slow queries** (> 5 seconds)
4. **Failed queries** (increasing count)
5. **Waiting requests** (> 10)

### Tools

- **Datadog**: Post `/api/health/pool` metrics to Datadog
- **Prometheus**: Expose as Prometheus metrics endpoint
- **Grafana**: Build dashboard from pool metrics
- **New Relic**: Integrate with APM

### Example: Datadog Integration

```javascript
// server/routes/metrics.js
router.get('/metrics', (req, res) => {
  const metrics = poolMonitor.getMetrics();
  
  // Send to Datadog
  datadog.gauge('db.pool.available', metrics.pool.availableConnections);
  datadog.gauge('db.pool.active', metrics.pool.activeConnections);
  datadog.gauge('db.queries.avg_time', metrics.queries.averageTimeMs);
  datadog.increment('db.queries.failed', { count: metrics.queries.failed });
  
  res.json(metrics);
});
```

## Performance Considerations

- Monitoring adds ~1-2% overhead per query
- Ring buffer capped at 100 query timings (memory: ~1KB)
- No synchronous I/O in tracking code
- Metrics updated async (non-blocking)

## Related Files

- `server/utils/poolMonitor.js` - Monitor implementation
- `server/db.js` - Pool initialization (where to integrate)
- `server/index.js` - Where to expose metrics endpoint
- `/api/health` - Existing health check endpoint
