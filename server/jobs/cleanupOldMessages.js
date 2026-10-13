/**
 * cleanupOldMessages.js
 * Scheduled job to delete support messages older than 180 days
 * Runs daily at 2 AM UTC (configurable via cron expression)
 * Compliance: GDPR, CCPA data retention policies
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { enqueueStorageDeletion, resolveKey } = require('../services/storageCleanupService');

// Review P3-6-F15: legacy support_messages rows can carry file references in
// the metadata JSONB column ("For storing file URLs"). Only strings shaped
// like storage references are collected: relative /api/storage/ download
// refs, or absolute URLs that resolve to a storage key. Anything else is
// ignored so free-text metadata never lands in the deletion queue.
function isStorageReference(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.startsWith('/api/storage/')) return true;
  if (/^https?:\/\//i.test(text)) return resolveKey(text) !== null;
  return false;
}

function collectAttachmentReferences(metadata) {
  const refs = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      if (isStorageReference(node)) refs.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      Object.values(node).forEach(walk);
    }
  };
  try {
    walk(metadata);
  } catch {
    // Never fail retention cleanup on odd metadata shapes.
  }
  return refs;
}

module.exports = {
  id: 'cleanup-old-messages',
  description: 'Delete support messages older than 180 days',
  cronExpression: '0 2 * * *', // Daily at 2 AM UTC

  async handler() {
    const startTime = Date.now();

    try {
      logger.info('Message cleanup job started', {
        job: 'cleanup-old-messages',
        timestamp: new Date().toISOString(),
      });

      // Option 1: Hard delete (removes data permanently)
      // Use this if you don't need audit trail of deleted messages.
      // Review P3-6-F15: capture attachment references before the rows are
      // gone so the storage objects are queued for deletion instead of
      // orphaned. Enqueueing never throws; a failed enqueue is logged by the
      // service and the object is left for a later sweep.
      const hardDeleteResult = await pool.query(
        `DELETE FROM support_messages
         WHERE expires_at < NOW() AND deleted_at IS NULL
         RETURNING id, metadata`
      );

      const deletedCount = hardDeleteResult.rows.length;
      let attachmentsQueued = 0;
      for (const row of hardDeleteResult.rows) {
        for (const ref of collectAttachmentReferences(row.metadata)) {
          if (await enqueueStorageDeletion(ref, 'support_legacy_retention')) {
            attachmentsQueued += 1;
          }
        }
      }
      const elapsedMs = Date.now() - startTime;

      logger.info('Message cleanup completed', {
        job: 'cleanup-old-messages',
        deleted_message_count: deletedCount,
        attachments_queued: attachmentsQueued,
        elapsed_ms: elapsedMs,
        status: 'success',
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        deleted: deletedCount,
        attachmentsQueued,
        elapsed_ms: elapsedMs,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startTime;

      logger.error('Message cleanup job failed', {
        job: 'cleanup-old-messages',
        error: error.message,
        error_code: error.code,
        elapsed_ms: elapsedMs,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });

      // Job failure should be logged but not crash the server
      // Send alert to admin if configured
      if (process.env.ALERT_EMAIL) {
        // Could integrate with email service to notify admins
        // await emailService.send(process.env.ALERT_EMAIL, 'Message cleanup failed', error.message);
      }

      return {
        success: false,
        error: error.message,
        elapsed_ms: elapsedMs,
      };
    }
  },

  // Optional: Manual trigger endpoint for testing
  async manualCleanup(req, res) {
    try {
      const result = await this.handler();
      res.json({
        success: true,
        data: result,
        message: `Manually deleted ${result.deleted} messages older than 180 days`,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  // Optional: Get cleanup statistics
  async getCleanupStats(req, res) {
    try {
      const stats = await pool.query(
        `SELECT
           COUNT(*) as total_messages,
           COUNT(*) FILTER (WHERE expires_at < NOW()) as expired_messages,
           COUNT(*) FILTER (WHERE expires_at < NOW() AND deleted_at IS NULL) as pending_deletion,
           MIN(created_at) as oldest_message,
           MAX(created_at) as newest_message,
           (SELECT COUNT(DISTINCT ticket_id) FROM support_messages) as unique_conversations
         FROM support_messages`
      );

      res.json({
        success: true,
        data: stats.rows[0],
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
};
