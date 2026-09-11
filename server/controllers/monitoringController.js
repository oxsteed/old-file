// Enterprise monitoring and health check endpoints
// Provides real-time metrics, security events, and system status for ops dashboard

const pool = require('../db');
const logger = require('../utils/logger');
const metricsService = require('../services/metricsService');
const backupMonitor = require('../services/backupMonitor');
const complianceAuditLogger = require('../services/complianceAuditLogger');

/**
 * GET /api/monitoring/health
 * System health overview
 */
exports.getSystemHealth = async (req, res, next) => {
  try {
    const snapshot = metricsService.getHealthSnapshot();
    const alerts = metricsService.checkAlerts();
    const [backupStatus, auditIntegrity] = await Promise.all([
      backupMonitor.getStatus(),
      _readAuditIntegrity(),
    ]);
    const poolStats = req.app.locals.poolMonitor?.getStats() || {};
    const healthAlerts = [...alerts];
    if (auditIntegrity.status === 'integrity_failure') {
      healthAlerts.push({
        type: 'AUDIT_CHAIN_INTEGRITY_FAILURE',
        severity: 'critical',
        message: `${auditIntegrity.brokenCount} admin audit chain entr${auditIntegrity.brokenCount === 1 ? 'y is' : 'ies are'} invalid`,
      });
    }

    res.json({
      status: healthAlerts.length > 0 ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      alerts: healthAlerts,
      metrics: snapshot.counters,
      latency: snapshot.latency,
      database: poolStats,
      backup: backupStatus,
      auditIntegrity,
    });
  } catch (err) {
    logger.error('Health check error', { error: err.message });
    res.status(500).json({ error: 'Health check failed' });
  }
};

/**
 * GET /api/monitoring/security-events
 * Recent security events (last 1 hour or specified window)
 */
exports.getSecurityEvents = async (req, res, next) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 1, 24); // Max 24 hours
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const events = metricsService.getSecurityEvents(since);

    // Group by severity
    const grouped = {
      critical: events.filter(e => e.severity === 'critical'),
      warning: events.filter(e => e.severity === 'warning'),
      info: events.filter(e => e.severity === 'info'),
    };

    res.json({
      period: `Last ${hours} hour(s)`,
      totalEvents: events.length,
      byType: grouped,
      summary: {
        criticalCount: grouped.critical.length,
        warningCount: grouped.warning.length,
        infoCount: grouped.info.length,
      },
    });
  } catch (err) {
    logger.error('Security events query error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
};

/**
 * GET /api/monitoring/audit-trail
 * Compliance audit trail for user
 */
exports.getAuditTrail = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const trail = await complianceAuditLogger.getAuditTrail(req.user.id, 100);

    res.json({
      userId: req.user.id,
      totalEvents: trail.length,
      events: trail,
    });
  } catch (err) {
    logger.error('Audit trail error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch audit trail' });
  }
};

/**
 * GET /api/monitoring/audit-integrity
 * Verify the append-only admin audit hash chain.
 */
exports.getAuditIntegrity = async (req, res, next) => {
  try {
    const [verification, head] = await Promise.all([
      pool.query('SELECT * FROM verify_admin_audit_hash_chain()'),
      pool.query(`
        SELECT entry_hash, created_at
        FROM admin_audit_log
        WHERE entry_hash IS NOT NULL
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `),
    ]);

    const result = verification.rows[0] || {
      valid: true,
      checked_count: 0,
      broken_count: 0,
      first_broken_id: null,
      first_broken_sequence: null,
    };

    res.status(result.valid ? 200 : 503).json({
      status: result.valid ? 'healthy' : 'integrity_failure',
      checkedCount: Number(result.checked_count || 0),
      brokenCount: Number(result.broken_count || 0),
      firstBrokenId: result.first_broken_id || null,
      firstBrokenSequence: result.first_broken_sequence == null
        ? null
        : Number(result.first_broken_sequence),
      chainHead: head.rows[0] || null,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Audit integrity check error', { error: err.message });
    res.status(503).json({
      status: 'unavailable',
      error: 'Audit integrity check unavailable',
    });
  }
};

/**
 * GET /api/monitoring/database-health
 * Database performance and connection pool metrics
 */
exports.getDatabaseHealth = async (req, res, next) => {
  try {
    const poolMonitor = req.app.locals.poolMonitor;
    if (!poolMonitor) {
      return res.status(503).json({ error: 'Pool monitor not available' });
    }

    const stats = poolMonitor.getStats();

    // Quick health check query
    const startTime = Date.now();
    await pool.query('SELECT 1');
    const queryTime = Date.now() - startTime;

    res.json({
      status: stats.totalSize > 0 ? 'healthy' : 'degraded',
      pool: stats,
      latency: {
        queryMs: queryTime,
        p95Ms: metricsService.getHistogramStats('db.query_ms')?.p95 || 0,
        p99Ms: metricsService.getHistogramStats('db.query_ms')?.p99 || 0,
      },
    });
  } catch (err) {
    logger.error('Database health check error', { error: err.message });
    res.status(500).json({ error: 'Database health check failed' });
  }
};

/**
 * GET /api/monitoring/backup-status
 * Backup and disaster recovery readiness
 */
exports.getBackupStatus = async (req, res, next) => {
  try {
    const status = await backupMonitor.getStatus();
    const complianceStats = await backupMonitor.getComplianceStats(30);

    res.json({
      status,
      complianceStats,
      recommendations: _generateBackupRecommendations(status, complianceStats),
    });
  } catch (err) {
    logger.error('Backup status error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch backup status' });
  }
};

/**
 * GET /api/monitoring/latency-percentiles
 * API latency distribution (p50, p95, p99)
 */
exports.getLatencyPercentiles = async (req, res, next) => {
  try {
    const httpStats = metricsService.getHistogramStats('http.request_ms');
    const dbStats = metricsService.getHistogramStats('db.query_ms');
    const paymentStats = metricsService.getHistogramStats('payment.process_ms');

    res.json({
      timestamp: new Date().toISOString(),
      http: httpStats,
      database: dbStats,
      payments: paymentStats,
      alerts: _generateLatencyAlerts(httpStats, dbStats),
    });
  } catch (err) {
    logger.error('Latency percentiles error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch latency stats' });
  }
};

/**
 * GET /api/monitoring/compliance-report
 * SOC 2, ISO 27001, GDPR compliance status
 */
exports.getComplianceReport = async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);

    // Audit log summary
    const auditEvents = await complianceAuditLogger.getEventsByAction('*', days);
    const failuresByUser = {};
    const criticalsCount = auditEvents.filter(e => e.severity === 'critical').length;
    const highsCount = auditEvents.filter(e => e.severity === 'high').length;

    // Backup compliance
    const backupStats = await backupMonitor.getComplianceStats(days);

    // Security events
    const securityEvents = metricsService.getSecurityEvents();
    const recentCriticals = securityEvents
      .filter(e => e.severity === 'critical')
      .slice(-10);

    res.json({
      period: `Last ${days} days`,
      compliance: {
        soc2: {
          status: criticalsCount === 0 ? 'COMPLIANT' : 'AT_RISK',
          failedControls: criticalsCount,
          recommendations: _generateSOC2Recommendations(criticalsCount),
        },
        iso27001: {
          status: (criticalsCount + highsCount) < 10 ? 'COMPLIANT' : 'AT_RISK',
          violations: criticalsCount + highsCount,
        },
        backup: {
          status: backupStats.status,
          stats: backupStats,
        },
      },
      recentCriticalEvents: recentCriticals,
      lastReported: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Compliance report error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate compliance report' });
  }
};

/**
 * GET /api/monitoring/incident-summary
 * Recent incidents and anomalies
 */
exports.getIncidentSummary = async (req, res, next) => {
  try {
    const hours = Math.min(parseInt(req.query.hours) || 24, 168); // Max 7 days

    const alerts = metricsService.checkAlerts();
    const securityEvents = metricsService.getSecurityEvents(
      new Date(Date.now() - hours * 60 * 60 * 1000)
    );

    const incidents = {
      activeAlerts: alerts,
      securityEventsCount: securityEvents.length,
      topSecurityTypes: _countEventTypes(securityEvents),
      failedLoginCount: metricsService.getCounter('auth.failed_login'),
      rateLimitHits: metricsService.getCounter('ratelimit.exceeded'),
      timestamp: new Date().toISOString(),
    };

    res.json(incidents);
  } catch (err) {
    logger.error('Incident summary error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch incident summary' });
  }
};

// ── HELPER FUNCTIONS ──────────────────────────────────────────

function _generateBackupRecommendations(status, stats) {
  const recs = [];

  if (!status.backupHealthy) {
    recs.push('⚠️ Backup is not healthy. Verify backup job is running.');
  }

  if (stats.failureCount > 0) {
    recs.push('⚠️ Recent backup failures detected. Check backup logs.');
  }

  if (stats.successRate < 100) {
    recs.push('⚠️ Not all backups are successful. Investigate failures.');
  }

  if (recs.length === 0) {
    recs.push('✓ Backups are healthy and on schedule.');
  }

  return recs;
}

function _generateLatencyAlerts(httpStats, dbStats) {
  const alerts = [];

  if (httpStats && httpStats.p95 > 5000) {
    alerts.push({
      type: 'SLOW_HTTP_RESPONSE',
      message: `HTTP p95 latency is ${httpStats.p95.toFixed(0)}ms`,
      severity: 'warning',
    });
  }

  if (dbStats && dbStats.p95 > 5000) {
    alerts.push({
      type: 'SLOW_DATABASE',
      message: `Database p95 latency is ${dbStats.p95.toFixed(0)}ms`,
      severity: 'high',
    });
  }

  return alerts;
}

function _generateSOC2Recommendations(criticalCount) {
  if (criticalCount === 0) {
    return ['✓ No critical control failures in compliance window'];
  }

  return [
    `⚠️ ${criticalCount} critical control issue(s) require remediation`,
    'Review audit logs for details on failures',
    'Implement corrective action and document resolution',
  ];
}

function _countEventTypes(events) {
  const counts = {};
  events.forEach(e => {
    counts[e.type] = (counts[e.type] || 0) + 1;
  });
  return counts;
}

async function _readAuditIntegrity() {
  try {
    const { rows } = await pool.query('SELECT * FROM verify_admin_audit_hash_chain()');
    const result = rows[0];
    return {
      status: result?.valid === false ? 'integrity_failure' : 'healthy',
      checkedCount: Number(result?.checked_count || 0),
      brokenCount: Number(result?.broken_count || 0),
    };
  } catch (err) {
    logger.warn('Audit integrity health check unavailable', { error: err.message });
    return { status: 'unavailable', checkedCount: 0, brokenCount: 0 };
  }
}
