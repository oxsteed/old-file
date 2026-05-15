// Business messaging controller
// Handles team and customer messaging conversations per business

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');

// Get all conversations for a business
async function getConversations(req, res, next) {
  try {
    const { businessId } = req.params;
    const { type = 'all', status = 'active', search = '', limit = 50, offset = 0 } = req.query;

    // Verify user belongs to business (manager/owner/staff)
    const businessCheck = await pool.query(
      'SELECT id FROM businesses WHERE id = $1 AND (user_id = $2 OR id IN (SELECT business_id FROM business_team_members WHERE user_id = $2))',
      [businessId, req.user.id]
    );
    if (!businessCheck.rows.length) {
      return next(new AppError('Unauthorized', 403));
    }

    let query = `
      SELECT
        bc.id, bc.business_id, bc.conversation_type, bc.status,
        bc.customer_id, bc.customer_name, bc.customer_email, bc.subject,
        bc.last_message_at, bc.created_at,
        COUNT(bm.id) as message_count,
        (SELECT COUNT(*) FROM business_messages bm2 WHERE bm2.conversation_id = bc.id AND bm2.deleted_at IS NULL) as unread_count
      FROM business_conversations bc
      LEFT JOIN business_messages bm ON bc.id = bm.conversation_id AND bm.deleted_at IS NULL
      WHERE bc.business_id = $1 AND bc.status IN ('active', 'resolved')
    `;

    const params = [businessId];

    if (type !== 'all') {
      query += ` AND bc.conversation_type = $${params.length + 1}`;
      params.push(type);
    }

    if (search) {
      query += ` AND (bc.subject ILIKE $${params.length + 1} OR bc.customer_name ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY bc.id ORDER BY bc.last_message_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    const totalResult = await pool.query(
      'SELECT COUNT(*) FROM business_conversations WHERE business_id = $1',
      [businessId]
    );

    res.json({
      conversations: result.rows,
      total: parseInt(totalResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    logger.error('Error fetching conversations', { error, businessId: req.params.businessId });
    next(new AppError('Failed to fetch conversations', 500));
  }
}

// Get single conversation with messages
async function getConversation(req, res, next) {
  try {
    const { businessId, conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Verify access
    const convCheck = await pool.query(
      'SELECT * FROM business_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );
    if (!convCheck.rows.length) {
      return next(new AppError('Conversation not found', 404));
    }

    // Get conversation details with messages
    const query = `
      SELECT
        bc.id, bc.business_id, bc.conversation_type, bc.status,
        bc.customer_id, bc.customer_name, bc.customer_email, bc.customer_phone,
        bc.subject, bc.created_at,
        (
          SELECT json_agg(json_build_object(
            'id', bm.id,
            'sender_id', bm.sender_id,
            'sender_name', bm.sender_name,
            'sender_type', bm.sender_type,
            'content', bm.content,
            'message_type', bm.message_type,
            'created_at', bm.created_at,
            'attachments', (
              SELECT json_agg(json_build_object('file_name', file_name, 'file_url', file_url))
              FROM business_message_attachments WHERE message_id = bm.id
            )
          ) ORDER BY bm.created_at DESC LIMIT $3 OFFSET $4)
          FROM business_messages bm
          WHERE bm.conversation_id = bc.id AND bm.deleted_at IS NULL
        ) as messages
      FROM business_conversations bc
      WHERE bc.id = $1 AND bc.business_id = $2
    `;

    const result = await pool.query(query, [conversationId, businessId, parseInt(limit), parseInt(offset)]);

    if (!result.rows.length) {
      return next(new AppError('Conversation not found', 404));
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching conversation', { error, conversationId: req.params.conversationId });
    next(new AppError('Failed to fetch conversation', 500));
  }
}

// Send message
async function sendMessage(req, res, next) {
  try {
    const { businessId, conversationId } = req.params;
    const { content, message_type = 'text', attachments = [] } = req.body;

    if (!content || content.trim().length === 0) {
      return next(new AppError('Message content is required', 400));
    }

    // Verify conversation exists and belongs to business
    const convCheck = await pool.query(
      'SELECT * FROM business_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );
    if (!convCheck.rows.length) {
      return next(new AppError('Conversation not found', 404));
    }

    // Insert message
    const msgResult = await pool.query(
      `INSERT INTO business_messages
       (conversation_id, sender_id, sender_name, sender_type, content, message_type)
       VALUES ($1, $2, (SELECT COALESCE(display_name, first_name || ' ' || last_name) FROM users WHERE id = $2), 'team_member', $3, $4)
       RETURNING *`,
      [conversationId, req.user.id, content, message_type]
    );

    // Update conversation last_message_at
    await pool.query(
      'UPDATE business_conversations SET last_message_at = NOW() WHERE id = $1',
      [conversationId]
    );

    // Handle attachments if provided
    if (attachments.length > 0) {
      for (const att of attachments) {
        await pool.query(
          'INSERT INTO business_message_attachments (message_id, file_name, file_url, file_size_bytes, file_type) VALUES ($1, $2, $3, $4, $5)',
          [msgResult.rows[0].id, att.file_name, att.file_url, att.file_size_bytes, att.file_type]
        );
      }
    }

    res.status(201).json(msgResult.rows[0]);
  } catch (error) {
    logger.error('Error sending message', { error, conversationId: req.params.conversationId });
    next(new AppError('Failed to send message', 500));
  }
}

// Create new conversation (customer or team)
async function createConversation(req, res, next) {
  try {
    const { businessId } = req.params;
    const { conversation_type, customer_email, subject, customer_name, customer_phone } = req.body;

    if (!['team', 'customer'].includes(conversation_type)) {
      return next(new AppError('Invalid conversation type', 400));
    }

    if (conversation_type === 'customer' && !customer_email) {
      return next(new AppError('Customer email is required for customer conversations', 400));
    }

    const result = await pool.query(
      `INSERT INTO business_conversations
       (business_id, conversation_type, customer_email, customer_name, customer_phone, subject, created_by_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [businessId, conversation_type, customer_email, customer_name, customer_phone, subject, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Error creating conversation', { error, businessId: req.params.businessId });
    next(new AppError('Failed to create conversation', 500));
  }
}

// Archive conversation
async function archiveConversation(req, res, next) {
  try {
    const { businessId, conversationId } = req.params;

    const result = await pool.query(
      'UPDATE business_conversations SET status = $1 WHERE id = $2 AND business_id = $3 RETURNING *',
      ['archived', conversationId, businessId]
    );

    if (!result.rows.length) {
      return next(new AppError('Conversation not found', 404));
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error archiving conversation', { error });
    next(new AppError('Failed to archive conversation', 500));
  }
}

module.exports = {
  getConversations,
  getConversation,
  sendMessage,
  createConversation,
  archiveConversation
};
