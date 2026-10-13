'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const { enqueueStorageDeletion } = require('../services/storageCleanupService');

// A transaction-scoped advisory lock prevents duplicate work when multiple
// application replicas run the same scheduled worker.
const RETENTION_LOCK_ID = 408180;

async function cleanupExpiredSupportMessages() {
  const startedAt = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT pg_try_advisory_xact_lock($1) AS acquired', [RETENTION_LOCK_ID]);
    if (!lock.rows[0]?.acquired) {
      await client.query('ROLLBACK');
      return { success: true, skipped: true, redacted: 0, elapsedMs: Date.now() - startedAt };
    }

    // Review P3-6-F15: capture attachment URLs before they are NULLed so the
    // storage objects can be queued for deletion. resolveKey understands the
    // signed download URLs stored here.
    const { rows: expiring } = await client.query(
      `SELECT id, attachment_url
         FROM support_conversation_messages
        WHERE expires_at < CURRENT_TIMESTAMP
          AND redacted_at IS NULL
          AND attachment_url IS NOT NULL`
    );
    const result = await client.query(
      `UPDATE support_conversation_messages
       SET content = '[Message removed under retention policy]',
           attachment_url = NULL,
           attachment_name = NULL,
           redacted_at = CURRENT_TIMESTAMP,
           redaction_reason = 'retention_policy',
           updated_at = CURRENT_TIMESTAMP
       WHERE expires_at < CURRENT_TIMESTAMP
         AND redacted_at IS NULL
       RETURNING id`
    );
    await client.query('COMMIT');

    // Queue the now-unreferenced attachment objects after the redaction
    // commits. Enqueueing never throws; a failed enqueue is logged by the
    // service and the object stays until a later sweep.
    let queued = 0;
    for (const row of expiring) {
      if (await enqueueStorageDeletion(row.attachment_url, 'retention_policy')) {
        queued += 1;
      }
    }

    const summary = {
      success: true,
      skipped: false,
      redacted: result.rows.length,
      attachmentsQueued: queued,
      elapsedMs: Date.now() - startedAt,
    };
    logger.info('Support conversation retention cleanup completed', summary);
    return summary;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve the original failure */ }
    logger.error('Support conversation retention cleanup failed', { error: error.message });
    return {
      success: false,
      skipped: false,
      redacted: 0,
      elapsedMs: Date.now() - startedAt,
      error: error.message,
    };
  } finally {
    client.release();
  }
}

module.exports = { cleanupExpiredSupportMessages, RETENTION_LOCK_ID };
