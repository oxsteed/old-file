const pool = require('../db');

const MessageModel = {
  async createConversation({ customerId, helperId, jobId }) {
    const result = await pool.query(
      'INSERT INTO conversations (customer_id, helper_id, job_id) VALUES ($1, $2, $3) RETURNING *',
      [customerId, helperId, jobId || null]
    );
    return result.rows[0];
  },

  async findConversationById(id) {
    const result = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
    return result.rows[0];
  },

  async findConversationsByUserId(userId) {
    const result = await pool.query(
      'SELECT * FROM conversations WHERE customer_id = $1 OR helper_id = $1 ORDER BY last_message_at DESC NULLS LAST',
      [userId]
    );
    return result.rows;
  },

  async createMessage({ conversationId, senderId, content, messageType }) {
    const result = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content, message_type) VALUES ($1, $2, $3, $4) RETURNING *',
      [conversationId, senderId, content, messageType || 'text']
    );
    await pool.query('UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1', [conversationId]);
    return result.rows[0];
  },

  async findMessagesByConversation(conversationId, limit = 50, offset = 0) {
    const result = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
      [conversationId, limit, offset]
    );
    return result.rows;
  },

  async markAsRead(conversationId, userId) {
    const result = await pool.query(
      'UPDATE messages SET is_read = TRUE, read_at = NOW() WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE RETURNING *',
      [conversationId, userId]
    );
    return result.rows;
  },

  async getUnreadCount(userId) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (c.customer_id = $1 OR c.helper_id = $1)
       AND m.sender_id != $1 AND m.is_read = FALSE`,
      [userId]
    );
    return parseInt(result.rows[0].count);
  }
};

module.exports = MessageModel;
