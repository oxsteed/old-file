const logger = require('./logger');

/**
 * Connection pool monitoring utility
 *
 * Tracks PostgreSQL connection pool health and exposes metrics for
 * monitoring connection exhaustion, query timeouts, and performance issues.
 *
 * Usage:
 *   const monitor = createPoolMonitor(pool);
 *   app.get('/api/health/pool', (req, res) => {
 *     res.json(monitor.getMetrics());
 *   });
 */

function createPoolMonitor(pool) {
  const metrics = {
    // Pool configuration
    maxSize: pool.max || 10,
    minSize: pool.min || 2,

    // Runtime metrics
    totalConnections: 0,
    availableConnections: 0,
    waitingRequests: 0,
    queriesExecuted: 0,
    queriesFailed: 0,

    // Timing
    averageQueryTimeMs: 0,
    slowestQueryTimeMs: 0,
    slowestQueryCount: 0,

    // Timestamps
    lastUpdated: new Date(),
    startTime: new Date(),

    // Historical data
    queryTimings: [], // Ring buffer of last 100 queries
    maxQueryTimingsSize: 100,
  };

  /**
   * Get current pool metrics
   */
  function getMetrics() {
    const now = new Date();
    const uptime = now - metrics.startTime;

    return {
      // Pool state
      pool: {
        max: metrics.maxSize,
        min: metrics.minSize,
        totalConnections: pool.totalCount || 0,
        availableConnections: pool.idleCount || 0,
        activeConnections: (pool.totalCount || 0) - (pool.idleCount || 0),
        waitingRequests: pool.waitingCount || 0,
        exhausted: (pool.totalCount || 0) >= metrics.maxSize && (pool.idleCount || 0) === 0,
      },

      // Query metrics
      queries: {
        total: metrics.queriesExecuted,
        failed: metrics.queriesFailed,
        averageTimeMs: Math.round(metrics.averageQueryTimeMs),
        slowestTimeMs: metrics.slowestQueryTimeMs,
        slowestCount: metrics.slowestQueryCount,
      },

      // Health
      health: {
        status: getHealthStatus(),
        uptime: `${Math.floor(uptime / 1000)}s`,
        timestamp: now.toISOString(),
      },

      // Warnings
      warnings: getWarnings(),
    };
  }

  /**
   * Determine overall pool health
   */
  function getHealthStatus() {
    const available = pool.idleCount || 0;
    const total = pool.totalCount || 0;
    const utilization = total > 0 ? (1 - (available / total)) * 100 : 0;

    if (available === 0 && total >= metrics.maxSize) {
      return 'exhausted'; // No connections available
    }
    if (utilization > 90) {
      return 'critical'; // > 90% utilization
    }
    if (utilization > 70) {
      return 'warning'; // > 70% utilization
    }
    if ((pool.waitingCount || 0) > 5) {
      return 'slow'; // Queries waiting for connections
    }
    return 'healthy';
  }

  /**
   * Generate warnings based on metrics
   */
  function getWarnings() {
    const warnings = [];
    const available = pool.idleCount || 0;
    const total = pool.totalCount || 0;

    if (available === 0) {
      warnings.push('CRITICAL: Pool exhausted (0 available connections)');
    } else if (available === 1) {
      warnings.push('WARNING: Only 1 connection available');
    }

    if ((pool.waitingCount || 0) > 10) {
      warnings.push(`${pool.waitingCount} queries waiting for connections`);
    }

    if (metrics.queriesFailed > 10) {
      warnings.push(`${metrics.queriesFailed} queries failed (possible connection issues)`);
    }

    if (metrics.averageQueryTimeMs > 1000) {
      warnings.push(`Average query time ${Math.round(metrics.averageQueryTimeMs)}ms (slow)`);
    }

    if (metrics.slowestQueryTimeMs > 5000) {
      warnings.push(`Slowest query ${metrics.slowestQueryTimeMs}ms (very slow)`);
    }

    return warnings;
  }

  /**
   * Track a query execution
   */
  function trackQuery(durationMs, success = true) {
    metrics.queriesExecuted++;

    if (!success) {
      metrics.queriesFailed++;
    }

    // Update average
    const totalTime = metrics.averageQueryTimeMs * (metrics.queriesExecuted - 1);
    metrics.averageQueryTimeMs = (totalTime + durationMs) / metrics.queriesExecuted;

    // Track slowest
    if (durationMs > metrics.slowestQueryTimeMs) {
      metrics.slowestQueryTimeMs = durationMs;
      metrics.slowestQueryCount = 1;
    } else if (durationMs === metrics.slowestQueryTimeMs) {
      metrics.slowestQueryCount++;
    }

    // Store timing in ring buffer
    metrics.queryTimings.push({
      duration: durationMs,
      timestamp: new Date(),
      success,
    });

    if (metrics.queryTimings.length > metrics.maxQueryTimingsSize) {
      metrics.queryTimings.shift();
    }

    // Log if query is slow
    if (durationMs > 5000) {
      logger.warn('Slow query detected', { durationMs });
    }
  }

  /**
   * Get recent query timings for analysis
   */
  function getRecentTimings(count = 20) {
    return metrics.queryTimings.slice(-count).map(t => ({
      durationMs: t.duration,
      timestamp: t.timestamp.toISOString(),
      success: t.success,
    }));
  }

  /**
   * Get percentile query timing
   */
  function getQueryPercentile(percentile = 95) {
    if (metrics.queryTimings.length === 0) {
      return 0;
    }

    const sorted = metrics.queryTimings
      .map(t => t.duration)
      .sort((a, b) => a - b);

    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Reset metrics (for testing or manual reset)
   */
  function reset() {
    metrics.queriesExecuted = 0;
    metrics.queriesFailed = 0;
    metrics.averageQueryTimeMs = 0;
    metrics.slowestQueryTimeMs = 0;
    metrics.slowestQueryCount = 0;
    metrics.queryTimings = [];
    metrics.startTime = new Date();

    logger.info('Pool metrics reset');
  }

  // Expose monitor API
  return {
    getMetrics,
    trackQuery,
    getRecentTimings,
    getQueryPercentile,
    reset,
    getHealthStatus,
    getWarnings,
  };
}

/**
 * Middleware to track query execution time
 * Wraps pool.query() to automatically track metrics
 */
function createTrackingPoolWrapper(pool, monitor) {
  const originalQuery = pool.query.bind(pool);

  pool.query = async function(...args) {
    const start = Date.now();
    try {
      const result = await originalQuery(...args);
      const duration = Date.now() - start;
      monitor.trackQuery(duration, true);
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      monitor.trackQuery(duration, false);
      throw err;
    }
  };

  return pool;
}

module.exports = {
  createPoolMonitor,
  createTrackingPoolWrapper,
};
