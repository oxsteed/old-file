/**
 * Conversation Retention Cleanup Job
 *
 * Runs daily at 2am Eastern to delete archived conversations that have exceeded the user's retention period.
 * By default, archived conversations are kept for 90 days before automatic deletion.
 * Users can disable auto-delete or adjust the retention_days in their settings.
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');

async function cleanupArchivedConversations() {
  try {
    logger.info('Starting conversation retention cleanup job');

    // Find all users with auto_delete enabled
    const usersRes = await pool.query(
      `SELECT user_id, retention_days FROM conversation_retention_settings
       WHERE auto_delete = TRUE AND retention_days > 0`
    );

    let totalDeleted = 0;

    // For each user, delete conversations exceeding their retention period
    for (const setting of usersRes.rows) {
      const { user_id, retention_days } = setting;

      // Calculate the cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retention_days);

      // Delete archived conversations for this user that are older than the cutoff date
      const deleteRes = await pool.query(
        `DELETE FROM conversations
         WHERE (customer_id = $1 OR helper_id = $1)
           AND archived_at IS NOT NULL
           AND archived_at < $2
         RETURNING id`,
        [user_id, cutoffDate.toISOString()]
      );

      if (deleteRes.rows.length > 0) {
        totalDeleted += deleteRes.rows.length;
        logger.info('Deleted archived conversations', {
          userId: user_id,
          count: deleteRes.rows.length,
          retentionDays: retention_days,
        });
      }
    }

    logger.info('Conversation retention cleanup completed', { totalDeleted });
  } catch (error) {
    logger.error('Error during conversation retention cleanup', {
      err: error.message,
      stack: error.stack,
    });
  }
}

// Schedule the cleanup job to run daily at 2am Eastern (6am UTC)
const startConversationRetentionCleanup = () => {
  cron.schedule('0 6 * * *', () => {
    cleanupArchivedConversations();
  });
};

module.exports = { startConversationRetentionCleanup };
