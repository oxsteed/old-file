const db = require('../db');

/**
 * Verify that a user has access to a conversation.
 * Returns conversation metadata if access granted, throws 403 error if denied.
 *
 * @param {number} conversationId - The conversation ID
 * @param {number} userId - The user attempting to access
 * @param {string} includeBusinessName - Optional; if true, JOIN businesses table for business_name
 * @returns {Promise<object>} Conversation row with access verified
 * @throws {Error} Error with status=403 if access denied
 */
async function verifyConversationAccess(conversationId, userId, includeBusinessName = false) {
  const selectClause = includeBusinessName
    ? `SELECT c.customer_id, c.helper_id, c.business_id, c.id, c.job_id, c.status, b.business_name
       FROM conversations c
       LEFT JOIN businesses b ON b.id = c.business_id AND b.is_active = TRUE`
    : `SELECT c.customer_id, c.helper_id, c.business_id, c.id, c.job_id, c.status
       FROM conversations c`;

  const result = await db.query(
    `${selectClause}
     WHERE c.id = $1 AND (
       c.customer_id = $2
       OR c.helper_id = $2
       OR (c.business_id IS NOT NULL AND EXISTS(
         SELECT 1 FROM business_members bm
         WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
       ))
     )`,
    [conversationId, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }

  return result.rows[0];
}

module.exports = { verifyConversationAccess };
