'use strict';

const crypto = require('crypto');
const pool = require('../db');
const emailService = require('../utils/email');
const logger = require('../utils/logger');
const { waitingState } = require('../services/supportWaitService');
const WebSocketService = require('../services/websocketService');
const { sendError, sendValidationError } = require('../utils/apiError');
const { uploadFile, getSignedDownloadUrl } = require('../utils/storage');

const CODE_TTL_MS = 15 * 60 * 1000;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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
    if (!name || name.length > 255 || !email || email.length > 320 || !content || content.length > 5000) {
      return sendValidationError(res, { visitorName: 'Name is required', visitorEmail: 'Valid email is required', message: 'Message is required and must be 5000 characters or fewer' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return sendValidationError(res, { visitorEmail: 'Valid email is required' });
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
    if (!email || !/^\d{6}$/.test(code)) return sendValidationError(res, { code: 'Enter the six-digit code sent by email' });
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
    if (hash(code) !== rows[0].code_hash) {
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
    WebSocketService.broadcastToAdmins('ticket:created', { ticketId: conversationId, routedTo: 'queue' });
    return res.json({ success: true, conversationId, guestToken: token, expiresInSeconds: TOKEN_TTL_MS / 1000 });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    logger.error('verifyGuestConversation error', { error: err.message });
    return sendError(res, 500, 'Failed to verify support conversation');
  } finally {
    client?.release();
  }
}

async function resendGuestVerification(req, res) {
  try {
    const conversationId = req.params.conversationId;
    const email = normalizeEmail(req.body?.visitorEmail);
    const { rows } = await pool.query(
      `SELECT guest_name FROM support_conversations
       WHERE id = $1 AND guest_email = $2 AND guest_verified_at IS NULL`,
      [conversationId, email]
    );
    if (!rows.length) return sendError(res, 404, 'Support verification request not found');
    const { rows: recent } = await pool.query(
      `SELECT id FROM support_guest_verifications
       WHERE conversation_id = $1 AND created_at > NOW() - INTERVAL '60 seconds'`,
      [conversationId]
    );
    if (recent.length) return sendError(res, 429, 'Please wait before requesting another code');
    await sendVerification(conversationId, email, rows[0].guest_name);
    return res.json({ success: true });
  } catch (err) {
    logger.error('resendGuestVerification error', { error: err.message });
    return sendError(res, 500, 'Failed to resend verification code');
  }
}

async function loadGuestConversation(req, res) {
  const conversationId = req.params.conversationId;
  try {
    const { rows } = await pool.query(
      `SELECT id, status, category, priority, guest_name, created_at, updated_at, agent_id,
        live_wait_started_at, live_wait_expires_at, live_wait_ended_at
       FROM support_conversations
       WHERE id = $1 AND guest_access_token_hash = $2 AND guest_token_expires_at > NOW()`,
      [conversationId, hash(req.guestToken)]
    );
    if (!rows.length) return sendError(res, 404, 'Support conversation not found or expired');
    const { rows: messages } = await pool.query(
      `SELECT id, content, is_agent, message_type, attachment_url, attachment_name, created_at
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
  if ((!content && !req.file) || content.length > 5000) return sendValidationError(res, { message: 'Message or image is required and must be 5000 characters or fewer' });
  if (req.file && (!req.file.mimetype || !req.file.mimetype.startsWith('image/'))) {
    return sendValidationError(res, { file: 'Only image attachments are allowed' });
  }
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
      const key = await uploadFile(req.file.buffer, 'support-conversations', req.file.originalname, req.file.mimetype);
      attachmentUrl = await getSignedDownloadUrl(key, 7 * 24 * 60 * 60);
      attachmentName = req.file.originalname;
    }
    const { rows: messageRows } = await pool.query(
      `INSERT INTO support_conversation_messages
        (conversation_id, sender_id, message_type, content, attachment_url, attachment_name, is_agent)
       VALUES ($1, NULL, $2, $3, $4, $5, FALSE) RETURNING id, created_at, attachment_url, attachment_name`,
      [conversationId, req.file ? 'image' : 'text', content || null, attachmentUrl, attachmentName]
    );
    await pool.query(
      `UPDATE support_conversations SET message_count = message_count + 1,
        customer_message_count = customer_message_count + 1, updated_at = NOW()
       WHERE id = $1`, [conversationId]
    );
    const payload = { ticketId: conversationId, messageId: messageRows[0].id, sender: { type: 'customer' }, content, attachmentUrl, attachmentName, messageType: req.file ? 'image' : 'text', timestamp: messageRows[0].created_at };
    WebSocketService.broadcastToTicket(conversationId, 'message:new', payload);
    return res.json({ success: true, data: messageRows[0] });
  } catch (err) {
    logger.error('addGuestMessage error', { error: err.message });
    return sendError(res, 500, 'Failed to send support message');
  }
}

function guestToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Guest ') ? header.slice(6).trim() : '';
  if (!token) return sendError(res, 401, 'Guest verification required');
  req.guestToken = token;
  next();
}

module.exports = { createGuestConversation, verifyGuestConversation, resendGuestVerification, loadGuestConversation, addGuestMessage, guestToken };
