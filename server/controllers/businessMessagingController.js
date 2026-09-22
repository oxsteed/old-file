// Business messaging controller
// Handles team and customer messaging conversations per business

const pool = require('../db');
const { AppError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { canAccessBusinessTeam } = require('../utils/businessOwnership');
const { getClientRequestId } = require('../utils/idempotency');
const { withTransaction } = require('../utils/transaction');
const socketService = require('../services/socketService');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');

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

    const filters = ['bc.business_id = $1', "bc.status IN ('active', 'resolved')"];
    const filterParams = [businessId, req.user.id];
    if (type !== 'all') {
      filters.push(`bc.conversation_type = $${filterParams.length + 1}`);
      filterParams.push(type);
    }
    if (search) {
      filters.push(`(bc.subject ILIKE $${filterParams.length + 1} OR bc.customer_name ILIKE $${filterParams.length + 1})`);
      filterParams.push(`%${search}%`);
    }

    let query = `
      SELECT
        bc.id, bc.business_id, bc.conversation_type, bc.status,
        bc.customer_id, bc.customer_name, bc.customer_email, bc.subject,
        bc.last_message_at, bc.created_at,
        (SELECT COUNT(*) FROM business_messages bm
          WHERE bm.conversation_id = bc.id AND bm.deleted_at IS NULL) AS message_count
        ,(SELECT COUNT(*) FROM business_messages bm_unread
          LEFT JOIN business_conversation_participants bcp
            ON bcp.conversation_id = bc.id AND bcp.user_id = $2
          WHERE bm_unread.conversation_id = bc.id
            AND bm_unread.deleted_at IS NULL
            AND bm_unread.sender_id IS DISTINCT FROM $2
            AND (bcp.last_read_at IS NULL OR bm_unread.created_at > bcp.last_read_at)
        ) AS unread_count
        ,(SELECT bm_last.content FROM business_messages bm_last
          WHERE bm_last.conversation_id = bc.id AND bm_last.deleted_at IS NULL
          ORDER BY bm_last.created_at DESC LIMIT 1
        ) AS last_message
      FROM business_conversations bc
      WHERE ${filters.join(' AND ')}
    `;
    const params = [...filterParams];

    query += ` ORDER BY bc.last_message_at DESC NULLS LAST, bc.created_at DESC
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);
    const totalFilters = ['business_id = $1', "status IN ('active', 'resolved')"];
    const totalParams = [businessId];
    if (type !== 'all') {
      totalFilters.push(`conversation_type = $${totalParams.length + 1}`);
      totalParams.push(type);
    }
    if (search) {
      totalFilters.push(`(subject ILIKE $${totalParams.length + 1} OR customer_name ILIKE $${totalParams.length + 1})`);
      totalParams.push(`%${search}%`);
    }
    const totalResult = await pool.query(
      `SELECT COUNT(*) FROM business_conversations
       WHERE ${totalFilters.join(' AND ')}`,
      totalParams
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
      `WITH latest_message AS (
         SELECT id, created_at
         FROM business_messages
         WHERE conversation_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1
       ), mark_read AS (
         INSERT INTO business_conversation_participants
           (conversation_id, user_id, last_read_message_id, last_read_at)
         SELECT $1, $4, id, created_at FROM latest_message
         ON CONFLICT (conversation_id, user_id) DO UPDATE
           SET last_read_message_id = EXCLUDED.last_read_message_id,
               last_read_at = EXCLUDED.last_read_at
       )
       SELECT
         bm.id, bm.sender_id, bm.sender_type, bm.content, bm.message_type, bm.created_at,
         COALESCE(NULLIF(bm.sender_name, ''), ${senderNameSql('u')}) AS sender_name,
         COALESCE(attachments.items, '[]'::json) AS attachments
       FROM business_messages bm
       LEFT JOIN users u ON u.id = bm.sender_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'id', bma.id,
           'file_name', bma.file_name,
           'file_url', bma.file_url,
           'file_size_bytes', bma.file_size_bytes,
           'file_type', bma.file_type
         ) ORDER BY bma.created_at ASC) AS items
         FROM business_message_attachments bma
         WHERE bma.message_id = bm.id
       ) attachments ON TRUE
       WHERE bm.conversation_id = $1 AND bm.deleted_at IS NULL
       ORDER BY bm.created_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, parseInt(limit, 10), parseInt(offset, 10), req.user.id]
    );

    const hydratedMessages = await Promise.all(messages.rows.map(async (message) => {
      const attachments = await Promise.all((Array.isArray(message.attachments) ? message.attachments : []).map(async (attachment) => {
        const storedUrl = String(attachment.file_url || '');
        if (!storedUrl.startsWith('private://')) return attachment;
        return {
          ...attachment,
          file_url: await getSignedDownloadUrl(storedUrl.slice('private://'.length), 3600),
        };
      }));
      return { ...message, attachments };
    }));

    res.json({
      ...convCheck.rows[0],
      messages: hydratedMessages,
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
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    const normalizedAttachments = Array.isArray(attachments)
      ? attachments.filter((attachment) => (
        attachment
        && typeof attachment.file_url === 'string'
        && attachment.file_url.trim()
        && typeof attachment.file_name === 'string'
        && attachment.file_name.trim()
      )).slice(0, 10)
      : [];
    const clientMessageId = req.get('Idempotency-Key')
      || req.body.clientMessageId
      || req.body.client_message_id
      || null;
    await assertBusinessAccess(req, businessId);

    if (!normalizedContent && normalizedAttachments.length === 0) {
      return next(new AppError('Message content or attachment is required', 400, 'validation_failed'));
    }
    if (normalizedContent.length > 4000) {
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
        [conversationId, req.user.id, normalizedContent, message_type, clientMessageId]
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

      if (normalizedAttachments.length > 0) {
        for (const att of normalizedAttachments) {
          await client.query(
            'INSERT INTO business_message_attachments (message_id, file_name, file_url, file_size_bytes, file_type) VALUES ($1, $2, $3, $4, $5)',
            [msgResult.rows[0].id, att.file_name, att.file_url, att.file_size_bytes, att.file_type]
          );
        }
      }

      return { message: msgResult.rows[0], replayed: false };
    }, 'send_business_message');

    if (!replayed) {
      socketService.broadcastToBusinessInbox(businessId, 'business_inbox:message', {
        business_id: businessId,
        conversation_id: conversationId,
        message_id: message.id,
        sender_id: req.user.id,
        sender_name: message.sender_name || null,
        content: normalizedContent.slice(0, 280),
        created_at: message.created_at || new Date().toISOString(),
      });
    }

    res.status(replayed ? 200 : 201).json(message);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error sending message', { error: error.message, conversationId: req.params.conversationId });
    next(new AppError('Failed to send message', 500));
  }
}

async function uploadAttachment(req, res, next) {
  try {
    const { businessId, conversationId } = req.params;
    await assertBusinessAccess(req, businessId);

    if (!req.file) {
      return next(new AppError('No file provided', 400, 'validation_failed'));
    }

    const conversation = await pool.query(
      'SELECT id FROM business_conversations WHERE id = $1 AND business_id = $2',
      [conversationId, businessId],
    );
    if (!conversation.rows.length) {
      return next(new AppError('Conversation not found', 404, 'not_found'));
    }

    const { buffer, originalname, mimetype, size } = req.file;
    const key = await uploadFile(buffer, 'business-message-attachments', originalname, mimetype);
    const url = await getSignedDownloadUrl(key, 3600);
    return res.json({ url, key, name: originalname, size, mimeType: mimetype });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    logger.error('Error uploading business message attachment', {
      error: error.message,
      businessId: req.params.businessId,
      conversationId: req.params.conversationId,
    });
    return next(new AppError('Upload failed', 500));
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
  uploadAttachment,
  createConversation,
  archiveConversation,
};
