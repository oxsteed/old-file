// Backup monitoring and disaster recovery readiness
// Tracks backup success/failure, tests restoration, and alerts on issues

const pool = require('../db');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');

class BackupMonitor {
  constructor() {
    this.lastBackupTime = null;
    this.lastBackupSuccess = null;
    this.backupHistory = [];
    this.maxHistorySize = 1000;
  }

  /**
   * Record a backup event
   */
  async recordBackup(backupId, filename, sizeBytes, duration, success, error = null) {
    const event = {
      timestamp: new Date().toISOString(),
      backupId,
      filename,
      sizeBytes,
      durationMs: duration,
      success,
      error,
      rto: 3600, // Recovery Time Objective: 1 hour
      rpo: 3600, // Recovery Point Objective: 1 hour
    };

    this.backupHistory.push(event);
    if (this.backupHistory.length > this.maxHistorySize) {
      this.backupHistory.shift();
    }

    this.lastBackupTime = new Date();
    this.lastBackupSuccess = success;

    // Metrics
    if (success) {
      metricsService.incrementCounter('backup.success', 1);
      metricsService.recordHistogram('backup.duration_ms', duration);
      metricsService.recordHistogram('backup.size_bytes', sizeBytes);
      logger.info('Backup successful', {
        backupId,
        filename,
        sizeBytes,
        durationMs: duration,
      });
    } else {
      metricsService.incrementCounter('backup.failure', 1);
      metricsService.recordSecurityEvent('backup_failure', 'critical', 'system', {
        backupId,
        error,
      });
      logger.error('Backup failed', {
        backupId,
        error,
      });
    }

    await this.logToDatabase(backupId, success, {
      eventType: 'backup',
      filename,
      sizeBytes,
      durationMs: duration,
      error,
    });

    return event;
  }

  /**
   * Record backup restoration test
   */
  async recordRestorationTest(testId, durationMs, success, error = null) {
    const event = {
      timestamp: new Date().toISOString(),
      testId,
      durationMs,
      success,
      error,
      rowsVerified: null,
      integrityCheck: null,
    };

    this.backupHistory.push(event);

    if (success) {
      metricsService.incrementCounter('backup.restoration_test_success', 1);
      metricsService.recordHistogram('backup.restoration_duration_ms', durationMs);
      logger.info('Backup restoration test passed', {
        testId,
        durationMs,
      });
    } else {
      metricsService.incrementCounter('backup.restoration_test_failure', 1);
      metricsService.recordSecurityEvent('restoration_test_failure', 'critical', 'system', {
        testId,
        error,
      });
      logger.error('BACKUP RESTORATION TEST FAILED', {
        testId,
        error,
      });
    }

    return event;
  }

  /**
   * Get backup health status
   */
  async getStatus() {
    let persistedBackups = [];
    try {
      const { rows } = await pool.query(
        `SELECT backup_id, success, details, created_at
         FROM backup_log
         ORDER BY created_at DESC
         LIMIT 1000`
      );
      persistedBackups = rows;
    } catch (err) {
      logger.warn('Persistent backup status unavailable; using process history', { error: err.message });
    }

    const now = new Date();
    const latestPersisted = persistedBackups[0];
    const lastBackupTime = latestPersisted?.created_at || this.lastBackupTime;
    const lastBackupSuccess = latestPersisted ? latestPersisted.success : this.lastBackupSuccess;
    const hoursSinceBackup = lastBackupTime
      ? (now - new Date(lastBackupTime)) / (1000 * 60 * 60)
      : null;
    const recentBackups = persistedBackups.length
      ? persistedBackups.slice(0, 10).map((row) => ({
        timestamp: row.created_at,
        backupId: row.backup_id,
        filename: row.details?.filename || null,
        sizeBytes: row.details?.sizeBytes || 0,
        durationMs: row.details?.durationMs || 0,
        success: row.success,
        error: row.details?.error || null,
      }))
      : this.backupHistory.filter(e => e.filename).slice(-10);

    return {
      lastBackupTime: lastBackupTime ? new Date(lastBackupTime).toISOString() : undefined,
      lastBackupSuccess,
      hoursSinceBackup: hoursSinceBackup?.toFixed(2),
      backupHealthy: lastBackupSuccess === true && hoursSinceBackup < 25, // Should backup daily
      recentBackups,
      alerts: this._checkAlerts(hoursSinceBackup),
    };
  }

  /**
   * Check for backup issues
   */
  _checkAlerts(hoursSinceBackup) {
    const alerts = [];

    if (hoursSinceBackup === null) {
      alerts.push({
        severity: 'critical',
        message: 'No backup recorded yet',
      });
    } else if (hoursSinceBackup > 25) {
      alerts.push({
        severity: 'critical',
        message: `No backup in ${hoursSinceBackup.toFixed(1)} hours (should be daily)`,
      });
    }

    // Check for recent failures
    const recentFailures = this.backupHistory
      .filter(e => !e.success && e.filename)
      .slice(-5);

    if (recentFailures.length >= 3) {
      alerts.push({
        severity: 'critical',
        message: `Last 3 backups failed: ${recentFailures.map(e => e.error).join(', ')}`,
      });
    }

    // Check restoration test health
    const lastRestorationTest = this.backupHistory
      .filter(e => e.testId)
      .slice(-1)[0];

    if (lastRestorationTest && !lastRestorationTest.success) {
      alerts.push({
        severity: 'critical',
        message: `Last restoration test FAILED: ${lastRestorationTest.error}`,
      });
    }

    return alerts;
  }

  /**
   * Log backup to database for persistent audit trail
   */
  async logToDatabase(backupId, success, details = {}) {
    try {
      await pool.query(
        `INSERT INTO backup_log (backup_id, success, details, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [backupId, success, JSON.stringify(details)]
      );
    } catch (err) {
      logger.error('Failed to log backup to database', { error: err.message });
    }
  }

  /**
   * Get backup statistics for compliance reporting
   */
  async getComplianceStats(days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    let recentBackups = [];
    try {
      const { rows } = await pool.query(
        `SELECT backup_id, success, details, created_at
         FROM backup_log
         WHERE created_at > $1
         ORDER BY created_at ASC
         LIMIT 10000`,
        [cutoff.toISOString()]
      );
      recentBackups = rows.map((row) => ({
        filename: row.details?.filename || null,
        timestamp: row.created_at,
        success: row.success,
        durationMs: row.details?.durationMs || 0,
        sizeBytes: row.details?.sizeBytes || 0,
      }));
    } catch (err) {
      logger.warn('Persistent backup compliance unavailable; using process history', { error: err.message });
      recentBackups = this.backupHistory.filter(e =>
        e.filename && new Date(e.timestamp) > cutoff
      );
    }

    recentBackups = recentBackups.filter(e => e.filename);

    const successCount = recentBackups.filter(e => e.success).length;
    const failureCount = recentBackups.filter(e => !e.success).length;
    const avgDurationMs = recentBackups.length > 0
      ? recentBackups.reduce((sum, e) => sum + e.durationMs, 0) / recentBackups.length
      : 0;

    const avgSizeGb = recentBackups.length > 0
      ? (recentBackups.reduce((sum, e) => sum + e.sizeBytes, 0) / recentBackups.length) / (1024 ** 3)
      : 0;

    return {
      period: `Last ${days} days`,
      totalBackups: recentBackups.length,
      successCount,
      failureCount,
      successRate: recentBackups.length > 0 ? ((successCount / recentBackups.length) * 100).toFixed(1) : 0,
      avgDurationMinutes: (avgDurationMs / 60000).toFixed(2),
      avgSizeGb: avgSizeGb.toFixed(2),
      status: failureCount === 0 ? 'COMPLIANT' : 'AT_RISK',
    };
  }
}

module.exports = new BackupMonitor();
