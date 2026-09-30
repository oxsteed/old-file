'use strict';
const pool = require('../db');
const logger = require('../utils/logger');
const metricsService = require('./metricsService');
const { SOURCE_ID, SOURCE_MAX_AGE_MS, TARGET, normalizeReport, normalizeRestore } = require('./coolifyBackupEvidence');

class BackupMonitor {
  constructor() {
    this.lastBackupTime = null;
    this.lastBackupSuccess = null;
    this.backupHistory = [];
    this.maxHistorySize = 1000;
  }
  async recordBackup(backupId, filename, sizeBytes, durationMs, success, error = null) {
    const event = { timestamp: new Date().toISOString(), backupId, filename, sizeBytes,
      durationMs, success, error, offsite: null, eventType: 'backup' };
    if (await this.logToDatabase(backupId, success, event, event.timestamp)) {
      this._remember(event); this.lastBackupTime = new Date(event.timestamp); this.lastBackupSuccess = success;
      this._observe({ backupId, success, details: event });
    }
    return event;
  }
  async recordRestorationTest(testId, durationMs, success, error = null) {
    // Legacy callers supply no restore proof. Persist without claiming verification.
    const event = { timestamp: new Date().toISOString(), testId, durationMs, success, error,
      eventType: 'restoration_test', verificationLevel: 'unverified' };
    if (await this.logToDatabase(`restore:${testId}`, success, event, event.timestamp)) {
      this._remember(event); this._observe({ backupId: `restore:${testId}`, success, details: event });
    }
    return event;
  }
  _remember(event) {
    this.backupHistory.push(event);
    if (this.backupHistory.length > this.maxHistorySize) this.backupHistory.shift();
  }
  _observe(event) {
    const restore = event.details.eventType === 'restoration_test';
    const collector = event.details.eventType === 'backup_source';
    if (collector) {
      metricsService.incrementCounter('backup.collector_failure', 1);
      metricsService.recordSecurityEvent('backup_collector_failure', 'critical', 'system', { sourceId: event.backupId, error: 'collector_failed' });
      logger.error('Coolify backup collector failed', { sourceId: event.backupId, error: 'collector_failed' });
      return;
    }
    const info = restore ? { testId: event.details.testId } : { backupId: event.backupId };
    const counter = restore ? `backup.restoration_test_${event.success ? 'success' : 'failure'}`
      : `backup.${event.success ? 'success' : 'failure'}`;
    metricsService.incrementCounter(counter, 1);
    if (event.success) {
      if (Number.isFinite(event.details.durationMs)) metricsService.recordHistogram(
        restore ? 'backup.restoration_duration_ms' : 'backup.duration_ms', event.details.durationMs);
      if (!restore && Number.isFinite(event.details.sizeBytes)) metricsService.recordHistogram('backup.size_bytes', event.details.sizeBytes);
      logger.info(restore ? 'Backup restoration test passed' : 'Backup successful', info);
    } else {
      // Fixed error codes only: never log execution messages, stderr, or caller errors.
      const error = restore ? 'restoration_test_failed' : 'backup_failed';
      metricsService.recordSecurityEvent(restore ? 'restoration_test_failure' : 'backup_failure', 'critical', 'system', { ...info, error });
      logger.error(restore ? 'BACKUP RESTORATION TEST FAILED' : 'Backup failed', { ...info, error });
    }
  }
  async logToDatabase(backupId, success, details, timestamp) {
    const result = await pool.query(
      `INSERT INTO backup_log (backup_id, success, details, created_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz AT TIME ZONE 'UTC')
       ON CONFLICT (backup_id) DO NOTHING RETURNING backup_id`,
      [backupId, success, JSON.stringify(details), timestamp]);
    return result.rows.length > 0;
  }
  async _transaction(operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(205, 1)');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) { logger.warn('Backup evidence rollback unavailable'); }
      throw error;
    } finally { client.release(); }
  }
  async _upsert(client, event, outcomes = []) {
    const { rows } = await client.query('SELECT details, success FROM backup_log WHERE backup_id = $1 FOR UPDATE', [event.backupId]);
    const previous = rows[0];
    if (previous) {
      const oldTime = previous.details?.observedAt || previous.details?.completedAt;
      const newTime = event.details.observedAt || event.details.completedAt;
      if (oldTime && newTime < oldTime) return false;
      if (oldTime === newTime) {
        if (previous.details.evidenceHash && previous.details.evidenceHash === event.details.evidenceHash) return false;
        const equal = await client.query('SELECT $1::jsonb = $2::jsonb AS equal', [JSON.stringify(previous.details), JSON.stringify(event.details)]);
        if (equal.rows[0]?.equal) return false;
        throw new Error('Conflicting evidence for the same observation');
      }
    }
    await client.query(
      `INSERT INTO backup_log (backup_id, success, details, created_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz AT TIME ZONE 'UTC')
       ON CONFLICT (backup_id) DO UPDATE SET success = EXCLUDED.success,
         details = EXCLUDED.details, created_at = EXCLUDED.created_at`,
      [event.backupId, event.success, JSON.stringify(event.details), event.timestamp]);
    if (!previous || previous.success !== event.success || previous.details?.state !== event.details.state) {
      if (event.details.eventType === 'backup' && !['running', 'pending'].includes(event.details.state)
        || event.details.eventType === 'backup_source' && !event.success) outcomes.push(event);
    }
    return true;
  }
  async ingestCoolifyReport(report) {
    const normalized = normalizeReport(report);
    const outcomes = [];
    const result = await this._transaction(async client => {
      let changed = 0;
      for (const event of normalized.events) if (await this._upsert(client, event, outcomes)) changed++;
      await this._upsert(client, normalized.source);
      return { executions: normalized.events.length, changed };
    });
    outcomes.forEach(event => this._observe(event));
    return result;
  }
  async recordCollectorFailure() {
    const observedAt = new Date().toISOString();
    const outcomes = [];
    const result = await this._transaction(client => this._upsert(client, { backupId: SOURCE_ID, success: false,
      timestamp: observedAt, details: { eventType: 'backup_source', source: 'coolify', ...TARGET,
        observedAt, error: 'collector_failed' } }, outcomes));
    outcomes.forEach(event => this._observe(event));
    return result;
  }
  async ingestRestorationEvidence(report) {
    const event = normalizeRestore(report);
    const result = await this._transaction(async client => {
      const { rows } = await client.query('SELECT success, details FROM backup_log WHERE backup_id = $1', [event.details.backupId]);
      const backup = rows[0];
      if (!backup?.success || backup.details?.source !== 'coolify' || backup.details.filename !== event.details.filename
        || backup.details.sizeBytes !== event.details.sizeBytes || event.details.startedAt < backup.details.finishedAt) {
        throw new Error('Restore evidence does not match an ingested Coolify dump');
      }
      const existing = await client.query('SELECT details FROM backup_log WHERE backup_id = $1', [event.backupId]);
      if (existing.rows[0]) {
        if (existing.rows[0].details.evidenceHash !== event.details.evidenceHash) throw new Error('Conflicting restore evidence');
        return { changed: false };
      }
      return { changed: await this._upsert(client, event) };
    });
    if (result.changed) this._observe(event);
    return result;
  }
  _event(row) {
    return { ...row.details, timestamp: new Date(row.created_at).toISOString(), backupId: row.backup_id,
      success: row.success, offsite: row.details?.offsite === true };
  }
  async _readHistory() {
    const { rows } = await pool.query(
      `SELECT backup_id, success, details, created_at AT TIME ZONE 'UTC' AS created_at
       FROM backup_log WHERE COALESCE(details->>'eventType', 'backup') = 'backup'
       ORDER BY created_at DESC, backup_id DESC LIMIT 1000`);
    const meta = await pool.query(
      `SELECT backup_id, success, details, created_at AT TIME ZONE 'UTC' AS created_at
       FROM backup_log WHERE backup_id = $1 OR details->>'eventType' = 'restoration_test'
       ORDER BY created_at DESC, backup_id DESC LIMIT 1000`, [SOURCE_ID]);
    return { backups: rows.map(row => this._event(row)), meta: meta.rows.map(row => this._event(row)) };
  }
  async getStatus() {
    let backups, meta = [], persistenceAvailable = true;
    try { ({ backups, meta } = await this._readHistory()); }
    catch (error) {
      persistenceAvailable = false; logger.warn('Persistent backup status unavailable');
      backups = this.backupHistory.filter(e => e.eventType === 'backup' || (!e.eventType && e.filename))
        .slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    }
    const now = Date.now(), latest = backups[0];
    const hours = latest ? (now - Date.parse(latest.timestamp)) / 3600000 : null;
    const source = meta.find(e => e.eventType === 'backup_source');
    const sourceAgeMs = source ? now - Date.parse(source.observedAt) : null;
    const sourceFresh = source?.success === true && sourceAgeMs >= 0 && sourceAgeMs < SOURCE_MAX_AGE_MS;
    const configHealthy = source?.config?.enabled === true && source.config.saveS3 === true
      && source.config.keepLocal === true && source.config.isR2 === true && source.config.frequency === '0 6 * * *';
    const imported = latest?.source === 'coolify', requiresOffsite = process.env.NODE_ENV === 'production' || imported;
    const backupHealthy = persistenceAvailable && latest?.success === true && hours >= 0 && hours < 25
      && (!requiresOffsite || latest.offsite === true)
      && (!imported || (latest.local === true && sourceFresh && configHealthy
        && latest.observedAt === source.observedAt));
    const restoration = meta.find(e => e.eventType === 'restoration_test');
    const restoreAgeHours = restoration ? (now - Date.parse(restoration.timestamp)) / 3600000 : null;
    const restoreVerified = persistenceAvailable && restoration?.success === true
      && restoration.source === 'isolated_restore_verifier' && restoreAgeHours >= 0 && restoreAgeHours < 30 * 24;
    const alerts = [], alert = message => alerts.push({ severity: 'critical', message });
    if (!persistenceAvailable) alert('Persistent backup status unavailable');
    if (!latest) alert('No backup recorded yet');
    else {
      if (!(hours >= 0 && hours < 25)) alert('Latest backup is outside the daily freshness window');
      if (!latest.success) alert(['running', 'pending'].includes(latest.state) ? 'Latest backup execution has not completed' : 'Latest backup execution failed');
      if (requiresOffsite && latest.success && !latest.offsite) alert('Latest backup is not confirmed in the configured off-host destination');
      if (imported && !latest.local) alert('Latest local backup copy is not confirmed retained');
      if (imported && !configHealthy) alert('Coolify daily local plus R2 schedule configuration is not confirmed');
      if (imported && source?.success && latest.observedAt !== source.observedAt) alert('Latest recorded backup is absent from the current collector observation');
    }
    if ((imported || source) && !sourceFresh) alert(source?.success === false ? 'Coolify backup collector failed' : 'Coolify backup collector evidence is stale or missing');
    if (!restoreVerified) alert(restoration?.success === false ? 'Last restoration test FAILED' : 'No recent verified restoration test recorded');
    return { lastBackupTime: latest?.timestamp, lastBackupSuccess: latest?.success ?? null,
      lastBackupOffsite: latest?.offsite ?? null, lastBackupLocal: latest?.local ?? null,
      hoursSinceBackup: hours === null ? undefined : hours.toFixed(2), backupHealthy,
      persistenceAvailable, sourceFresh, sourceObservation: source || null, recentBackups: backups.slice(0, 10),
      restorationTest: restoration || null, restorationVerified: restoreVerified,
      recoveryReady: backupHealthy && restoreVerified, alerts };
  }
  async getComplianceStats(days = 30) {
    const cutoff = Date.now() - days * 86400000;
    let backups = [], available = true;
    try {
      const { rows } = await pool.query(
        `SELECT backup_id, success, details, created_at AT TIME ZONE 'UTC' AS created_at
         FROM backup_log WHERE created_at > $1::timestamptz AT TIME ZONE 'UTC'
         AND COALESCE(details->>'eventType', 'backup') = 'backup'
         ORDER BY created_at DESC LIMIT 10000`, [new Date(cutoff).toISOString()]);
      backups = rows.map(row => this._event(row));
    } catch (error) { available = false; logger.warn('Persistent backup compliance unavailable'); }
    const completed = backups.filter(e => !['running', 'pending'].includes(e.state));
    const successCount = completed.filter(e => e.success).length, failureCount = completed.filter(e => !e.success).length;
    const status = await this.getStatus();
    const avg = key => completed.length ? completed.reduce((sum, e) => sum + (e[key] || 0), 0) / completed.length : 0;
    return { period: `Last ${days} days`, totalBackups: completed.length, successCount, failureCount,
      pendingCount: backups.length - completed.length,
      offsiteConfirmedCount: completed.filter(e => e.success && e.offsite).length,
      successRate: completed.length ? (successCount / completed.length * 100).toFixed(1) : 0,
      avgDurationMinutes: (avg('durationMs') / 60000).toFixed(2), avgSizeGb: (avg('sizeBytes') / 1024 ** 3).toFixed(2),
      persistenceAvailable: available, coverageLimited: backups.length === 10000 || status.sourceObservation?.truncated === true,
      status: available && completed.length && failureCount === 0 && status.recoveryReady
        && !status.sourceObservation?.truncated && backups.length < 10000 ? 'COMPLIANT' : 'AT_RISK' };
  }
}
module.exports = new BackupMonitor();
