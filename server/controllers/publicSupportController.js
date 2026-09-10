'use strict';

const crypto = require('crypto');
const pool = require('../db');
const emailService = require('../utils/email');
const logger = require('../utils/logger');
const { waitingState, processWaiting } = require('../services/supportWaitService');
const WebSocketService = require('../services/websocketService');
const { sendError, sendValidationError } = require('../utils/apiError');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const { withTransaction } = require('../utils/transaction');

const CODE_TTL_MS = 15 * 60 * 1000;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL_LENGTH = 254;
const CLIENT_MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length <= MAX_EMAIL_LENGTH && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length === rightBuffer.length
    && leftBuffer.length > 0
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function randomCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function sendVerification(conversationId, email, name, db = pool) {
  const code = randomCode();
  await db.query('UPDATE support_guest_verifications SET consumed_at = NOW() WHERE conversation_id = $1 AND consumed_at IS NULL', [conversationId]);
  await db.query(
    `INSERT INTO support_guest_verifications
       (conversation_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes')`,
    [conversationId, email, hash(code)]
  );
  const result = await emailService.sendEmail({
    to: email,
    subject: 'Your OxSteed support verification code',
    text: `Hi ${name},\n\nYour OxSteed support verification code is ${code}. It expires in 15 minutes.\n\nIf you did not request support, you can ignore this email.`,
  });
  if (!result.success) throw new Error('Verification email could not be delivered');
}

async function createGuestConversation(req, res) {
  let client;
  try {
    const { visitorName, visitorEmail, message } = req.body || {};
    const category = 'general';
    const priority = 'normal';
    const name = String(visitorName || '').trim();
    const email = normalizeEmail(visitorEmail);
    const content = String(message || '').trim();
    if (!name || name.length > 255 || !email || !isValidEmail(email) || !content || content.length > 5000) {
      return sendValidationError(res, { visitorName: 'Name is required', visitorEmail: 'Valid email is required', message: 'Message is required and must be 5000 characters or fewer' });
    }
    const businessId = null;
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO support_conversations
        (business_id, customer_id, guest_name, guest_email, subject, description, category, priority, status)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, 'pending_verification')
       RETURNING id`,
      [businessId, name, email, `${category} support request`, content, category, priority]
    );
    const conversationId = rows[0].id;
    await client.query(
      `INSERT INTO support_conversation_messages
        (conversation_id, sender_id, message_type, content, is_agent)
       VALUES ($1, NULL, 'text', $2, FALSE)`,
      [conversationId, content]
    );
    await client.query(
      `UPDATE support_conversations
       SET message_count = 1, customer_message_count = 1
       WHERE id = $1`,
      [conversationId]
    );
    await sendVerification(conversationId, email, name, client);
    await client.query('COMMIT');
    return res.status(201).json({ success: true, conversationId, verificationRequired: true, email: email.replace(/^(.{2}).+(@.*)$/, '$1***$2') });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    logger.error('createGuestConversation error', { error: err.message });
    return sendError(res, 500, 'Failed to start support conversation');
  } finally {
    client?.release();
  }
}

async function verifyGuestConversation(req, res) {
  let client;
  try {
    const conversationId = req.params.conversationId;
    const email = normalizeEmail(req.body?.visitorEmail);
    const code = String(req.body?.code || '').trim();
    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) return sendValidationError(res, { code: 'Enter the six-digit code sent by email' });
    client = await pool.connect();
    await client.query('BEGIN');
    const session = await client.query(`SELECT id FROM support_conversations
      WHERE id = $1 AND guest_email = $2 AND guest_verified_at IS NULL FOR UPDATE`, [conversationId, email]);
    if (!session.rows.length) {
      await client.query('ROLLBACK');
      return sendError(res, 401, 'The verification code is invalid or expired');
    }
    const { rows } = await client.query(
      `SELECT id, code_hash FROM support_guest_verifications
       WHERE conversation_id = $1 AND email = $2 AND consumed_at IS NULL
         AND expires_at > NOW() AND attempts < 5
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [conversationId, email]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return sendError(res, 401, 'The verification code is invalid or expired');
    }
    const verificationId = rows[0].id;
    if (!hashesMatch(hash(code), rows[0].code_hash)) {
      await client.query('UPDATE support_guest_verifications SET attempts = attempts + 1 WHERE id = $1', [verificationId]);
      await client.query('COMMIT');
      return sendError(res, 401, 'The verification code is invalid or expired');
    }
    const token = crypto.randomBytes(32).toString('hex');
    await client.query('UPDATE support_guest_verifications SET consumed_at = NOW() WHERE id = $1', [verificationId]);
    await client.query(
      `UPDATE support_conversations
       SET guest_access_token_hash = $1, guest_token_expires_at = NOW() + INTERVAL '24 hours', guest_verified_at = NOW(),
           status = 'waiting_for_agent', live_wait_started_at = NOW(), live_wait_expires_at = NOW() + INTERVAL '5 minutes'
       WHERE id = $2 AND guest_email = $3`,
      [hash(token), conversationId, email]
    );
    await client.query(`INSERT INTO support_queue (business_id, conversation_id, priority, status)
      VALUES (NULL, $1, 'normal', 'waiting')`, [conversationId]);
    await client.query('COMMIT');

    // Run the same strict presence/capacity routing pass used by the worker so
    // a guest with a verified email is connected immediately when an agent is
    // genuinely live, instead of waiting for the next worker tick.
    try {
      await processWaiting();
    } catch (routingError) {
      logger.warn('Immediate guest support routing failed; conversation remains queued', {
        conversationId,
        error: routingError.message,
      });
    }

    const { rows: routedRows } = await pool.query(
      'SELECT agent_id FROM support_conversations WHERE id = $1',
      [conversationId]
    );
    const routedTo = routedRows[0]?.agent_id ? 'agent' : 'queue';
    WebSocketService.broadcastToAdmins('ticket:created', { ticketId: conversationId, routedTo });
    return res.json({ success: true, conversationId, guestToken: token, routedTo, expiresInSeconds: TOKEN_TTL_MS / 1000 });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    logger.error('verifyGuestConversation error', { error: err.message });
    return sendError(res, 500, 'Failed to verify support conversation');
  } finally {
    client?.release();
  }
}

async function resendGuestVerification(req, res) {
  const conversationId = req.params.conversationId;
  let outcome;
  try {
    const email = normalizeEmail(req.body?.visitorEmail);
    if (!isValidEmail(email)) return sendValidationError(res, { visitorEmail: 'Valid email is required' });

    // Serialize resend attempts per conversation. Without the row lock, two
    // concurrent requests can both pass the throttle check and send codes.
    outcome = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT guest_name FROM support_conversations
         WHERE id = $1 AND guest_email = $2 AND guest_verified_at IS NULL
         FOR UPDATE`,
        [conversationId, email]
      );
      if (!rows.length) return 'missing';

      const { rows: recent } = await client.query(
        `SELECT id FROM support_guest_verifications
         WHERE conversation_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'
         LIMIT 1`,
        [conversationId]
      );
      if (recent.length) return 'throttled';

      await sendVerification(conversationId, email, rows[0].guest_name, client);
      return 'sent';
    }, 'resend_guest_support_verification');

    if (outcome === 'missing') return sendError(res, 404, 'Support verification request not found');
    if (outcome === 'throttled') return sendError(res, 429, 'Please wait before requesting another code');
    return res.json({ success: true });
  } catch (err) {
    logger.error('resendGuestVerification error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to resend verification code');
  }
}

async function loadGuestConversation(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const { rows } = await pool.query(
      `SELECT id, status, category, priority, guest_name, subject, created_at, updated_at, agent_id,
        resolution_summary,
        live_wait_started_at, live_wait_expires_at, live_wait_ended_at,
        (
          SELECT jsonb_build_object(
            'id', scr.id,
            'rating', scr.rating,
            'comment', scr.comment,
            'created_at', scr.created_at,
            'updated_at', scr.updated_at
          )
          FROM support_conversation_reviews scr
          WHERE scr.conversation_id = support_conversations.id
        ) AS review
       FROM support_conversations
       WHERE id = $1 AND guest_access_token_hash = $2 AND guest_token_expires_at > NOW()`,
      [conversationId, hash(req.guestToken)]
    );
    if (!rows.length) return sendError(res, 404, 'Support conversation not found or expired');
    const { rows: messages } = await pool.query(
      `SELECT id, content, is_agent, message_type, attachment_url, attachment_name,
        edited_at, edit_count, created_at
       FROM support_conversation_messages
       WHERE conversation_id = $1 AND message_type <> 'internal_note'
       ORDER BY created_at ASC`,
      [conversationId]
    );
    return res.json({ success: true, data: { ...rows[0], messages, waiting: waitingState(rows[0]) } });
  } catch (err) {
    logger.error('loadGuestConversation error', { error: err.message });
    return sendError(res, 500, 'Failed to load support conversation');
  }
}

async function addGuestMessage(req, res) {
  const conversationId = req.params.conversationId;
  const content = String(req.body?.message || req.body?.content || '').trim();
  const rawClientMessageId = req.body?.clientMessageId
    || req.body?.client_message_id
    || req.get?.('Idempotency-Key')
    || '';
  const clientMessageId = String(rawClientMessageId).trim() || null;
  if (clientMessageId && !CLIENT_MESSAGE_ID_PATTERN.test(clientMessageId)) {
    return sendValidationError(res, { clientMessageId: 'Must be a UUID v4 request identifier' });
  }
  if ((!content && !req.file) || content.length > 5000) return sendValidationError(res, { message: 'Message or image is required and must be 5000 characters or fewer' });
  if (req.file && (!req.file.mimetype || !req.file.mimetype.startsWith('image/'))) {
    return sendValidationError(res, { file: 'Only image attachments are allowed' });
  }
  let uploadedKey = null;
  try {
    const { rows } = await pool.query(
      `SELECT id FROM support_conversations
       WHERE id = $1 AND guest_access_token_hash = $2 AND guest_token_expires_at > NOW()
         AND status NOT IN ('resolved', 'closed')`,
      [conversationId, hash(req.guestToken)]
    );
    if (!rows.length) return sendError(res, 404, 'Support conversation not found or expired');
    let attachmentUrl = null;
    let attachmentName = null;
    if (req.file) {
      uploadedKey = await uploadFile(req.file.buffer, 'support-conversations', req.file.originalname, req.file.mimetype);
      attachmentUrl = await getSignedDownloadUrl(uploadedKey, 7 * 24 * 60 * 60);
      attachmentName = req.file.originalname;
    }
    // The message content column is non-nullable; represent an image-only
    // reply with a stable text label while the attachment carries the detail.
    const messageContent = content || 'Attachment';
    const result = await withTransaction(pool, async (client) => {
      const { rows: messageRows } = await client.query(
        `INSERT INTO support_conversation_messages
          (conversation_id, sender_id, message_type, content, attachment_url, attachment_name, is_agent, client_message_id)
         VALUES ($1, NULL, $2, $3, $4, $5, FALSE, $6)
         ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
         RETURNING id, created_at, content, message_type, attachment_url, attachment_name, client_message_id`,
        [conversationId, req.file ? 'image' : 'text', messageContent, attachmentUrl, attachmentName, clientMessageId]
      );
      if (!messageRows.length) {
        const existing = await client.query(
          `SELECT id, created_at, content, message_type, attachment_url, attachment_name, client_message_id
           FROM support_conversation_messages
           WHERE conversation_id = $1 AND client_message_id = $2`,
          [conversationId, clientMessageId]
        );
        if (!existing.rows.length) throw new Error('Idempotent support message could not be recovered');
        return { rows: existing.rows, duplicate: true };
      }
      await client.query(
        `UPDATE support_conversations SET message_count = message_count + 1,
          customer_message_count = customer_message_count + 1, updated_at = NOW()
         WHERE id = $1`, [conversationId]
      );
      return { rows: messageRows, duplicate: false };
    }, 'add_guest_support_message');
    const message = result.rows[0];
    if (result.duplicate && uploadedKey) {
      // A concurrent retry may upload before the unique request key wins.
      // Remove that unused object instead of leaving an orphan in storage.
      await deleteFile(uploadedKey).catch((cleanupError) => {
        logger.warn('Failed to clean up duplicate guest support attachment', {
          conversationId,
          key: uploadedKey,
          error: cleanupError.message,
        });
      });
    }
    const payload = { ticketId: conversationId, messageId: message.id, sender: { type: 'customer' }, content: message.content || messageContent, attachmentUrl: message.attachment_url || attachmentUrl, attachmentName: message.attachment_name || attachmentName, messageType: message.message_type || (req.file ? 'image' : 'text'), timestamp: message.created_at };
    if (!result.duplicate) WebSocketService.broadcastToTicket(conversationId, 'message:new', payload);
    return res.json({ success: true, data: message, idempotent: Boolean(result.duplicate) });
  } catch (err) {
    if (uploadedKey) {
      await deleteFile(uploadedKey).catch((cleanupError) => {
        logger.warn('Failed to clean up failed guest support attachment', {
          conversationId,
          key: uploadedKey,
          error: cleanupError.message,
        });
      });
    }
    logger.error('addGuestMessage error', { error: err.message });
    return sendError(res, 500, 'Failed to send support message');
  }
}

async function updateGuestMessage(req, res) {
  const conversationId = req.params.conversationId;
  const messageId = req.params.messageId;
  const content = String(req.body?.content ?? req.body?.message ?? '').trim();
  if (!content || content.length > 5000) {
    return sendValidationError(res, { content: 'Message is required and must be 5000 characters or fewer' });
  }
  try {
    const { rows: conversations } = await pool.query(
      `SELECT id, status FROM support_conversations
       WHERE id = $1 AND guest_access_token_hash = $2 AND guest_token_expires_at > NOW()`,
      [conversationId, hash(req.guestToken)]
    );
    if (!conversations.length) return sendError(res, 404, 'Support conversation not found or expired');
    if (['resolved', 'closed'].includes(conversations[0].status)) {
      return sendError(res, 409, 'Closed conversations cannot be edited');
    }
    const { rows } = await pool.query(
      `UPDATE support_conversation_messages
       SET original_content = COALESCE(original_content, content),
           content = $1,
           edited_at = NOW(),
           edit_count = edit_count + 1,
           updated_at = NOW()
       WHERE id = $2 AND conversation_id = $3 AND sender_id IS NULL
         AND is_agent = FALSE AND message_type <> 'internal_note'
         AND created_at > NOW() - INTERVAL '15 minutes'
       RETURNING id, content, attachment_url, attachment_name, message_type,
                 edited_at, edit_count, created_at`,
      [content, messageId, conversationId]
    );
    if (!rows.length) return sendError(res, 409, 'This message is no longer editable');
    const message = rows[0];
    const payload = {
      ticketId: conversationId,
      conversationId,
      messageId: message.id,
      sender: { type: 'customer' },
      content: message.content,
      attachmentUrl: message.attachment_url,
      attachmentName: message.attachment_name,
      messageType: message.message_type,
      editedAt: message.edited_at,
      editCount: message.edit_count,
      timestamp: message.created_at,
    };
    WebSocketService.broadcastToTicket(conversationId, 'message:updated', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: message });
  } catch (err) {
    logger.error('updateGuestMessage error', { conversationId, messageId, error: err.message });
    return sendError(res, 500, 'Failed to edit support message');
  }
}

async function downloadGuestConversation(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const { rows: conversations } = await pool.query(
      `SELECT id, subject, status, guest_name, created_at
       FROM support_conversations
       WHERE id = $1 AND guest_access_token_hash = $2 AND guest_token_expires_at > NOW()`,
      [conversationId, hash(req.guestToken)]
    );
    if (!conversations.length) return sendError(res, 404, 'Support conversation not found or expired');
    const { rows: messages } = await pool.query(
      `SELECT content, attachment_name, is_agent, message_type, created_at
       FROM support_conversation_messages
       WHERE conversation_id = $1
         AND COALESCE(message_type, 'text') <> 'internal_note'
       ORDER BY created_at ASC`,
      [conversationId]
    );
    const conversation = conversations[0];
    const lines = [
      'OxSteed Support Conversation',
      `Subject: ${conversation.subject || 'Support request'}`,
      `Started: ${conversation.created_at ? new Date(conversation.created_at).toISOString() : '-'}`,
      `Status: ${conversation.status || '-'}`,
      '',
    ];
    messages.forEach((message) => {
      if (message.message_type === 'internal_note') return;
      lines.push(`[${message.created_at ? new Date(message.created_at).toISOString() : '-'}] ${message.is_agent ? 'OxSteed Support' : (conversation.guest_name || 'Customer')}`);
      if (message.content) lines.push(String(message.content));
      if (message.attachment_name) lines.push(`Attachment: ${message.attachment_name}`);
      lines.push('');
    });
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="oxsteed-support-${String(conversationId).slice(0, 8)}.txt"`);
    return res.send(`${lines.join('\n').trim()}\n`);
  } catch (err) {
    logger.error('downloadGuestConversation error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to download support conversation');
  }
}

async function createGuestConversationReview(req, res) {
  const conversationId = req.params.conversationId;
  const rating = Number(req.body?.rating);
  const comment = String(req.body?.comment || '').trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 1000) {
    return sendValidationError(res, { rating: 'Choose a rating from 1 to 5', comment: 'Feedback must be 1000 characters or fewer' });
  }
  try {
    const { rows: conversations } = await pool.query(
      `SELECT id, guest_email, status FROM support_conversations
       WHERE id = $1 AND guest_access_token_hash = $2 AND guest_token_expires_at > NOW()`,
      [conversationId, hash(req.guestToken)]
    );
    if (!conversations.length) return sendError(res, 404, 'Support conversation not found or expired');
    if (!['resolved', 'closed'].includes(conversations[0].status)) {
      return sendError(res, 409, 'Reviews are available after the conversation is finished');
    }
    const { rows } = await pool.query(
      `INSERT INTO support_conversation_reviews (conversation_id, guest_email, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (conversation_id) DO UPDATE
       SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = NOW()
       RETURNING id, conversation_id, rating, comment, created_at, updated_at`,
      [conversationId, conversations[0].guest_email, rating, comment || null]
    );
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('createGuestConversationReview error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to save conversation review');
  }
}

async function reopenGuestConversation(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const { rows } = await pool.query(
      `SELECT id, status FROM support_conversations
       WHERE id = $1 AND guest_access_token_hash = $2 AND guest_token_expires_at > NOW()`,
      [conversationId, hash(req.guestToken)]
    );
    if (!rows.length) return sendError(res, 404, 'Support conversation not found or expired');
    if (rows[0].status !== 'resolved') return sendError(res, 409, 'Only resolved conversations can be reopened');

    const updated = await withTransaction(pool, async (client) => {
      const { rows: reopened } = await client.query(
        `UPDATE support_conversations
         SET status = 'open', resolved_at = NULL, closed_at = NULL,
             resolution_status = NULL, resolution_summary = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'resolved'
         RETURNING id, status, updated_at`,
        [conversationId]
      );
      if (!reopened.length) return null;

      await client.query(
        `UPDATE support_queue
         SET status = 'waiting', removed_at = NULL, reason_removed = NULL,
             routed_to_agent_id = NULL
         WHERE conversation_id = $1`,
        [conversationId]
      );
      return reopened[0];
    }, 'reopen_guest_support_conversation');
    if (!updated) return sendError(res, 409, 'This conversation changed before it could be reopened');
    const payload = { ticketId: conversationId, conversationId, status: 'open', timestamp: new Date().toISOString() };
    WebSocketService.broadcastToTicket(conversationId, 'ticket:status-changed', payload);
    WebSocketService.broadcastToAdmins('support:conversation-updated', payload);
    return res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('reopenGuestConversation error', { conversationId, error: err.message });
    return sendError(res, 500, 'Failed to reopen conversation');
  }
}

function guestToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Guest ') ? header.slice(6).trim() : '';
  if (!token) return sendError(res, 401, 'Guest verification required');
  req.guestToken = token;
  next();
}

module.exports = {
  createGuestConversation,
  verifyGuestConversation,
  resendGuestVerification,
  loadGuestConversation,
  addGuestMessage,
  updateGuestMessage,
  downloadGuestConversation,
  createGuestConversationReview,
  reopenGuestConversation,
  guestToken,
};
