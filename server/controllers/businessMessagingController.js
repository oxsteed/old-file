// Business messaging controller
// Handles team and customer messaging conversations per business

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { canAccessBusinessTeam } = require('../utils/businessOwnership');
const { getClientRequestId } = require('../utils/idempotency');
const { withTransaction } = require('../utils/transaction');

function senderNameSql(alias = 'u') {
  return `NULLIF(TRIM(BOTH FROM CONCAT(COALESCE(${alias}.first_name, ''), ' ', COALESCE(${alias}.last_name, ''))), '')`;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function assertBusinessAccess(req, businessId) {
  if (req.business && String(req.business.id) === String(businessId)) return true;
  const access = await canAccessBusinessTeam(req.user.id, businessId);
  if (!access) {
    throw new AppError('Unauthorized', 403, 'forbidden');
  }
  return true;
}

async function getConversations(req, res, next) {
  try {
    const { businessId } = req.params;
    const { type = 'all', search = '', limit = 50, offset = 0 } = req.query;
    await assertBusinessAccess(req, businessId);

    let query = `
      SELECT
        bc.id, bc.business_id, bc.conversation_type, bc.status,
        bc.customer_id, bc.customer_name, bc.customer_email, bc.subject,
        bc.last_message_at, bc.created_at,
        (SELECT COUNT(*) FROM business_messages bm
          WHERE bm.conversation_id = bc.id AND bm.deleted_at IS NULL) AS message_count
      FROM business_conversations bc
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

    query += ` ORDER BY bc.last_message_at DESC NULLS LAST, bc.created_at DESC
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);
    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM business_conversations
       WHERE business_id = $1 AND status IN ('active', 'resolved')`,
      [businessId]
    );

    res.json({
      conversations: result.rows,
      total: parseInt(totalResult.rows[0].count, 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error fetching conversations', { error: error.message, businessId: req.params.businessId });
    next(new AppError('Failed to fetch conversations', 500));
  }
}

async function getConversation(req, res, next) {
  try {
    const { businessId, conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    await assertBusinessAccess(req, businessId);

    const convCheck = await pool.query(
      'SELECT * FROM business_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );
    if (!convCheck.rows.length) {
      return next(new AppError('Conversation not found', 404, 'not_found'));
    }

    const messages = await pool.query(
      `SELECT
         bm.id, bm.sender_id, bm.sender_type, bm.content, bm.message_type, bm.created_at,
         COALESCE(NULLIF(bm.sender_name, ''), ${senderNameSql('u')}) AS sender_name
       FROM business_messages bm
       LEFT JOIN users u ON u.id = bm.sender_id
       WHERE bm.conversation_id = $1 AND bm.deleted_at IS NULL
       ORDER BY bm.created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, parseInt(limit, 10), parseInt(offset, 10)]
    );

    res.json({
      ...convCheck.rows[0],
      messages: messages.rows,
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error fetching conversation', { error: error.message, conversationId: req.params.conversationId });
    next(new AppError('Failed to fetch conversation', 500));
  }
}

async function sendMessage(req, res, next) {
  try {
    const { businessId, conversationId } = req.params;
    const { content, message_type = 'text', attachments = [] } = req.body;
    const clientMessageId = req.get('Idempotency-Key')
      || req.body.clientMessageId
      || req.body.client_message_id
      || null;
    await assertBusinessAccess(req, businessId);

    if (!content || content.trim().length === 0) {
      return next(new AppError('Message content is required', 400, 'validation_failed'));
    }
    if (content.trim().length > 4000) {
      return next(new AppError('Message too long (max 4000 characters)', 400, 'validation_failed'));
    }
    if (clientMessageId && !isUuid(clientMessageId)) {
      return next(new AppError('Invalid client message id', 400, 'validation_failed'));
    }

    const convCheck = await pool.query(
      'SELECT * FROM business_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId]
    );
    if (!convCheck.rows.length) {
      return next(new AppError('Conversation not found', 404, 'not_found'));
    }

    const { message, replayed } = await withTransaction(pool, async (client) => {
      const msgResult = await client.query(
        `INSERT INTO business_messages
           (conversation_id, sender_id, sender_name, sender_type, content, message_type, client_message_id)
         VALUES (
           $1, $2,
           (SELECT ${senderNameSql('u')} FROM users u WHERE u.id = $2),
           'team_member', $3, $4, $5
         )
         ON CONFLICT (conversation_id, client_message_id)
         WHERE client_message_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [conversationId, req.user.id, content.trim(), message_type, clientMessageId]
      );

      if (!msgResult.rows.length) {
        const replay = await client.query(
          `SELECT * FROM business_messages
           WHERE conversation_id = $1 AND client_message_id = $2`,
          [conversationId, clientMessageId]
        );
        if (!replay.rows.length) {
          throw new AppError('Failed to send message', 500);
        }
        return { message: replay.rows[0], replayed: true };
      }

      await client.query(
        'UPDATE business_conversations SET last_message_at = NOW() WHERE id = $1',
        [conversationId]
      );

      if (Array.isArray(attachments) && attachments.length > 0) {
        for (const att of attachments) {
          await client.query(
            'INSERT INTO business_message_attachments (message_id, file_name, file_url, file_size_bytes, file_type) VALUES ($1, $2, $3, $4, $5)',
            [msgResult.rows[0].id, att.file_name, att.file_url, att.file_size_bytes, att.file_type]
          );
        }
      }

      return { message: msgResult.rows[0], replayed: false };
    }, 'send_business_message');

    res.status(replayed ? 200 : 201).json(message);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error sending message', { error: error.message, conversationId: req.params.conversationId });
    next(new AppError('Failed to send message', 500));
  }
}

async function createConversation(req, res, next) {
  try {
    const { businessId } = req.params;
    const { conversation_type, customer_email, subject, customer_name, customer_phone } = req.body;
    const clientRequestId = getClientRequestId(req);
    if (clientRequestId === false) {
      return next(new AppError('Invalid client request id', 400, 'validation_failed'));
    }
    await assertBusinessAccess(req, businessId);

    if (!['team', 'customer'].includes(conversation_type)) {
      return next(new AppError('Invalid conversation type', 400, 'validation_failed'));
    }

    if (conversation_type === 'customer' && !customer_email) {
      return next(new AppError('Customer email is required for customer conversations', 400, 'validation_failed'));
    }

    const result = await pool.query(
      `INSERT INTO business_conversations
       (business_id, conversation_type, customer_email, customer_name, customer_phone, subject, created_by_id, client_request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (business_id, created_by_id, client_request_id)
       WHERE client_request_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [businessId, conversation_type, customer_email || null, customer_name || null, customer_phone || null, subject || null, req.user.id, clientRequestId]
    );

    let conversation = result.rows[0];
    let replayed = false;
    if (!conversation && clientRequestId) {
      const existing = await pool.query(
        `SELECT * FROM business_conversations
          WHERE business_id = $1 AND created_by_id = $2 AND client_request_id = $3
          LIMIT 1`,
        [businessId, req.user.id, clientRequestId],
      );
      conversation = existing.rows[0];
      replayed = Boolean(conversation);
    }
    if (!conversation) return next(new AppError('Conversation retry could not be recovered', 409, 'conversation_retry_failed'));

    res.status(replayed ? 200 : 201).json({ ...conversation, idempotent: replayed });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error creating conversation', { error: error.message, businessId: req.params.businessId });
    next(new AppError('Failed to create conversation', 500));
  }
}

async function archiveConversation(req, res, next) {
  try {
    const { businessId, conversationId } = req.params;
    await assertBusinessAccess(req, businessId);

    const result = await pool.query(
      'UPDATE business_conversations SET status = $1 WHERE id = $2 AND business_id = $3 RETURNING *',
      ['archived', conversationId, businessId]
    );

    if (!result.rows.length) {
      return next(new AppError('Conversation not found', 404, 'not_found'));
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error archiving conversation', { error: error.message });
    next(new AppError('Failed to archive conversation', 500));
  }
}

module.exports = {
  getConversations,
  getConversation,
  sendMessage,
  createConversation,
  archiveConversation,
};
