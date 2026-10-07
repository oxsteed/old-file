const db = require('../db');
const crypto = require('crypto');
const { uuidv4 } = require('../utils/uuid');
const { withChatTransaction, updateSessionStatus, logChatEvent, queueMessageIfTransitioning, drainMessageQueue } = require('../services/chatTransactionService');
const { broadcastNewGuestSession, broadcastGuestSessionUpdate, broadcastGuestChatMessage } = require('../services/socketService');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { sendNotification } = require('../services/notificationService');

const GUEST_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
// Audit fix: fail closed when no secret is configured. The previous
// hardcoded fallback ('development-only-guest-chat-secret') meant anyone
// could forge guest session tokens in any environment missing the env vars.
const GUEST_TOKEN_SECRET = String(
  process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || ''
).trim();
if (!GUEST_TOKEN_SECRET) {
  throw new Error('GUEST_TOKEN_SECRET is not configured: set ENCRYPTION_KEY or JWT_SECRET');
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getClientMessageId(req, bodyValue) {
  return (typeof req.get === 'function' ? req.get('Idempotency-Key') : null)
    || req.headers?.['idempotency-key']
    || bodyValue
    || null;
}

function createGuestToken(sessionId) {
  const expiresAt = Math.floor(Date.now() / 1000) + GUEST_TOKEN_TTL_SECONDS;
  const payload = `${sessionId}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', GUEST_TOKEN_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function getGuestToken(req) {
  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Guest ')) return authorization.slice(6).trim();
  return String(req.headers['x-guest-chat-token'] || '').trim();
}

function verifyGuestToken(req, sessionId) {
  const [tokenSessionId, expiryText, signature] = getGuestToken(req).split('.');
  const expiry = Number.parseInt(expiryText, 10);
  if (!tokenSessionId || tokenSessionId !== sessionId || !Number.isFinite(expiry)
    || expiry < Math.floor(Date.now() / 1000) || !/^[a-f0-9]{64}$/i.test(signature || '')) {
    return false;
  }

  const expected = crypto.createHmac('sha256', GUEST_TOKEN_SECRET)
    .update(`${tokenSessionId}.${expiry}`)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
}

function requireGuestSessionToken(req, sessionId) {
  if (!verifyGuestToken(req, sessionId)) {
    throw new AppError('Guest session verification required', 401, 'guest_session_verification_required');
  }
}

async function requireGuestChatStaff(req) {
  const userId = req.user?.id;
  if (!userId) {
    throw new AppError('Authentication required', 401, 'auth_error');
  }

  if (req.user.role === 'admin' || req.user.role === 'super_admin') return;

  const { rows } = await db.query(
    `SELECT 1
     FROM support_agents sa
     JOIN users u ON u.id = sa.user_id
     WHERE sa.user_id = $1
       AND sa.status = 'active'
       AND u.is_active = true
       AND u.deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );

  if (!rows.length) {
    throw new AppError('Support staff access required', 403, 'forbidden');
  }
}

/**
 * Anti-spam gate for the legacy guest-chat queue.
 * A session may only broadcast to helpers/admins (and fire push
 * notifications) once its guest email has been verified through the OTP
 * flow used by guest profile chat (guest_verified_at is set by
 * verifyGuestCode in guestProfileChatVerification). Unverified sessions stay
 * fully functional for the guest; they simply do not broadcast.
 * Fails closed: when the verification state cannot be read, do not broadcast.
 */
async function hasVerifiedGuestEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM guest_profile_chat_inbound
        WHERE lower(guest_email) = $1
          AND guest_verified_at IS NOT NULL
        LIMIT 1`,
      [normalized]
    );
    return rows.length > 0;
  } catch (err) {
    logger.warn('Guest email verification check failed', { error: err.message });
    return false;
  }
}

/**
 * Guest creates a new chat session and sends initial message
 * POST /api/guest-chat/sessions
 */
async function createGuestSession(req, res, next) {
  try {
    const { guestName, guestEmail, message, consentMonitoring = false, clientMessageId: bodyClientMessageId } = req.body;
    const clientMessageId = getClientMessageId(req, bodyClientMessageId);
    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('clientMessageId must be a valid UUID', 400, 'validation_failed', {
        clientMessageId: 'Must be a valid UUID',
      });
    }

    // Validate inputs
    if (!guestName || !guestName.trim()) {
      throw new AppError('Guest name is required', 400, 'validation_failed', { guestName: 'Guest name is required' });
    }
    if (!message || !message.trim()) {
      throw new AppError('Initial message is required', 400, 'validation_failed', { message: 'Initial message is required' });
    }
    if (message.length > 4000) {
      throw new AppError('Message too long (max 4000 characters)', 400, 'validation_failed', { message: 'Maximum 4000 characters' });
    }

    let sessionId;
    let messageId;
    let replayed = false;

    await withChatTransaction(async (client) => {
      if (clientMessageId) {
        const existing = await client.query(
          `SELECT id FROM guest_profile_chat_inbound WHERE client_request_id = $1 LIMIT 1`,
          [clientMessageId]
        );
        if (existing.rows[0]) {
          sessionId = existing.rows[0].id;
          const existingMessage = await client.query(
            `SELECT id FROM guest_profile_chat_messages
             WHERE session_id = $1 AND client_message_id = $2 LIMIT 1`,
            [sessionId, clientMessageId]
          );
          messageId = existingMessage.rows[0]?.id || null;
          replayed = true;
          return;
        }
      }
      sessionId = uuidv4();

      // Create guest session
      const { rows: [session] } = await client.query(
        `INSERT INTO guest_profile_chat_inbound
         (id, guest_name, guest_email, session_status, helper_response_deadline, guest_consent_monitoring, consent_requested_at, created_at, client_request_id)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '5 minutes', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $6)
         ON CONFLICT (client_request_id)
         WHERE client_request_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [sessionId, guestName, guestEmail, 'waiting_for_helper', consentMonitoring, clientMessageId]
      );

      if (!session && clientMessageId) {
        const replaySession = await client.query(
          `SELECT id FROM guest_profile_chat_inbound WHERE client_request_id = $1 LIMIT 1`,
          [clientMessageId]
        );
        if (!replaySession.rows[0]) {
          throw new AppError('Guest chat retry could not be recovered', 409, 'idempotency_conflict');
        }
        sessionId = replaySession.rows[0].id;
        const replayMessage = await client.query(
          `SELECT id FROM guest_profile_chat_messages
           WHERE session_id = $1 AND client_message_id = $2 LIMIT 1`,
          [sessionId, clientMessageId]
        );
        messageId = replayMessage.rows[0]?.id || null;
        replayed = true;
        return;
      }

      // Insert initial guest message
      const { rows: [msg] } = await client.query(
        `INSERT INTO guest_profile_chat_messages
         (session_id, sender_type, sender_name, message, created_at, client_message_id)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
         RETURNING id`,
        [sessionId, 'guest', guestName, message, clientMessageId]
      );

      messageId = msg.id;

      // Log session creation event
      await logChatEvent(client, sessionId, 'session_created', {
        triggeredBy: null,
        metadata: {
          consent_monitoring: consentMonitoring
        }
      });
    }, 'create_guest_session');

    logger.info('Guest chat session created', { sessionId, consentMonitoring });

    // Broadcast new session to online helpers and admins - but only when the
    // guest email is verified (anti-spam). Unverified sessions are still
    // created and usable for the guest; they simply do not broadcast.
    if (!replayed) {
      const verified = await hasVerifiedGuestEmail(guestEmail);
      if (verified) {
        broadcastNewGuestSession({
          sessionId,
          guestName,
          guestEmail,
          createdAt: new Date().toISOString(),
          deadlineMinutes: 5,
          initialMessage: message
        });
      } else {
        logger.info('Guest chat session created without broadcast (unverified email)', { sessionId });
      }
    }

    res.status(replayed ? 200 : 201).json({
      sessionId,
      messageId,
      guestToken: createGuestToken(sessionId),
      status: 'waiting_for_helper',
      deadlineMinutes: 5,
      idempotent: replayed,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Guest sends a message to the session
 * POST /api/guest-chat/sessions/:sessionId/messages
 */
async function sendGuestMessage(req, res, next) {
  try {
    const { sessionId } = req.params;
    requireGuestSessionToken(req, sessionId);
    const { message, clientMessageId: bodyClientMessageId } = req.body;
    const clientMessageId = getClientMessageId(req, bodyClientMessageId);
    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('clientMessageId must be a valid UUID', 400, 'validation_failed', {
        clientMessageId: 'Must be a valid UUID',
      });
    }

    if (!message || !message.trim()) {
      throw new AppError('Message is required', 400, 'validation_failed', { message: 'Message is required' });
    }
    if (message.length > 4000) {
      throw new AppError('Message too long (max 4000 characters)', 400, 'validation_failed', { message: 'Maximum 4000 characters' });
    }

    let messageId;
    let replayed = false;
    let helperIdForNotification = null;
    let guestEmailForVerification = null;

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status, guest_name, guest_email, helper_id FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new AppError('Session not found', 404, 'not_found');
      }
      helperIdForNotification = session.helper_id || null;
      guestEmailForVerification = session.guest_email || null;

      if (session.session_status === 'resolved' || session.session_status === 'abandoned') {
        throw new AppError('Cannot send messages to resolved or abandoned sessions', 400, 'invalid_state');
      }

      // Check if we should queue this message
      const shouldQueue = await queueMessageIfTransitioning(client, sessionId, {
        sender_type: 'guest',
        sender_name: session.guest_name,
        message
      });

      if (!shouldQueue) {
        // Insert message directly
        const { rows: [msg] } = await client.query(
          `INSERT INTO guest_profile_chat_messages
           (session_id, sender_type, sender_name, message, created_at, client_message_id)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
           ON CONFLICT (session_id, client_message_id)
           WHERE client_message_id IS NOT NULL
           DO NOTHING
           RETURNING id`,
          [sessionId, 'guest', session.guest_name, message, clientMessageId]
        );
        messageId = msg?.id || null;
        if (!messageId && clientMessageId) {
          const existingMessage = await client.query(
            `SELECT id FROM guest_profile_chat_messages
             WHERE session_id = $1 AND client_message_id = $2 LIMIT 1`,
            [sessionId, clientMessageId]
          );
          messageId = existingMessage.rows[0]?.id || null;
          replayed = Boolean(messageId);
        }
      } else {
        // Message was queued, no messageId yet
        messageId = null;
      }

      if (!replayed) {
        // Update session activity only for a newly committed message.
        await client.query(
          `UPDATE guest_profile_chat_inbound
           SET last_guest_message_at = CURRENT_TIMESTAMP,
               guest_messages_count = guest_messages_count + 1,
               last_activity_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [sessionId]
        );
      }
    }, 'send_guest_message');

    logger.info('Guest message sent', {
      sessionId,
      queued: messageId === null
    });

    // Broadcast message to helpers/admins monitoring this session - only for
    // verified guest emails (anti-spam). Unverified sessions stay silent.
    if (messageId && !replayed) {
      const verified = await hasVerifiedGuestEmail(guestEmailForVerification);
      if (!verified) {
        logger.info('Guest message stored without broadcast (unverified email)', { sessionId });
      } else {
        broadcastGuestChatMessage(sessionId, {
          messageId,
          senderType: 'guest',
          senderName: 'Guest',
          message,
          createdAt: new Date().toISOString()
        });
        if (helperIdForNotification) {
          void sendNotification({
            userId: helperIdForNotification,
            type: 'new_message',
            title: 'New guest message',
            body: message,
            data: {
              guestSessionId: String(sessionId),
              guestMessageId: String(messageId),
            },
            action_url: '/helper/messages',
            idempotencyKey: `guest-chat-message:${sessionId}:${messageId}:${helperIdForNotification}`,
          }).catch((error) => {
            logger.warn('Guest chat notification failed', {
              sessionId,
              messageId,
              error: error.message,
            });
          });
        }
      }
    }

    res.status(replayed ? 200 : 201).json({
      messageId,
      queued: messageId === null,
      sessionId,
      idempotent: replayed,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Helper claims a session from AI support
 * POST /api/guest-chat/sessions/:sessionId/claim
 */
async function helperClaimSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    await requireGuestChatStaff(req);
    const helperId = req.user.id;

    if (!helperId) {
      throw new AppError('Authentication required', 401, 'auth_error');
    }

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status, ai_summary FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new AppError('Session not found', 404, 'not_found');
      }

      // Can only claim from ai_support_active state
      if (session.session_status !== 'ai_support_active') {
        throw new AppError(`Cannot claim session in state: ${session.session_status}`, 400, 'invalid_state');
      }

      // Transition to helper_assigned
      const updatedSession = await updateSessionStatus(client, sessionId, 'helper_assigned', {
        helper_id: helperId,
        helper_claimed_from_ai_at: new Date().toISOString()
      });

      // Log the claim event
      await logChatEvent(client, sessionId, 'helper_claimed_from_ai', {
        helperId,
        metadata: {
          helper_id: helperId,
          claimed_from_ai: true
        }
      });

      // Drain any queued messages while AI was handling the session
      const processedMessages = await drainMessageQueue(client, sessionId, async (queuedMsg) => {
        // Insert queued message as a normal message
        const { rows: [msg] } = await client.query(
          `INSERT INTO guest_profile_chat_messages
           (session_id, sender_type, sender_name, message, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           RETURNING id`,
          [sessionId, queuedMsg.sender_type, queuedMsg.sender_name, queuedMsg.message]
        );
        return msg.id;
      });

      return {
        session: updatedSession,
        aiSummary: session.ai_summary,
        queuedMessagesProcessed: processedMessages.length
      };
    }, 'helper_claim_session');

    logger.info('Helper claimed session from AI', {
      sessionId,
      helperId
    });

    // Broadcast session update to admins
    broadcastGuestSessionUpdate(sessionId, {
      status: 'helper_assigned',
      helperId,
      claimedFromAiAt: new Date().toISOString()
    });

    res.json({
      sessionId,
      status: 'helper_assigned',
      message: 'Session claimed successfully'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Helper sends a message to the guest
 * POST /api/guest-chat/sessions/:sessionId/messages
 * (Requires authentication, distinguishes from guest messages)
 */
async function sendHelperMessage(req, res, next) {
  try {
    const { sessionId } = req.params;
    const { message, clientMessageId: bodyClientMessageId } = req.body;
    const clientMessageId = getClientMessageId(req, bodyClientMessageId);
    if (clientMessageId && !isUuid(clientMessageId)) {
      throw new AppError('clientMessageId must be a valid UUID', 400, 'validation_failed', {
        clientMessageId: 'Must be a valid UUID',
      });
    }
    await requireGuestChatStaff(req);
    const helperId = req.user.id;

    if (!helperId) {
      throw new AppError('Authentication required', 401, 'auth_error');
    }

    if (!message || !message.trim()) {
      throw new AppError('Message is required', 400, 'validation_failed', { message: 'Message is required' });
    }
    if (message.length > 4000) {
      throw new AppError('Message too long (max 4000 characters)', 400, 'validation_failed', { message: 'Maximum 4000 characters' });
    }

    let messageId;
    let replayed = false;

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status, helper_id FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new AppError('Session not found', 404, 'not_found');
      }

      // Can only send messages if helper_assigned
      if (session.session_status !== 'helper_assigned') {
        throw new AppError(`Cannot send messages in state: ${session.session_status}`, 400, 'invalid_state');
      }

      // Verify this helper owns this session
      if (session.helper_id !== helperId) {
        throw new AppError('This session is not assigned to you', 403, 'forbidden');
      }

      // Insert message
      const { rows: [msg] } = await client.query(
        `INSERT INTO guest_profile_chat_messages
         (session_id, sender_type, sender_name, message, created_at, client_message_id)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5)
         ON CONFLICT (session_id, client_message_id)
         WHERE client_message_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [sessionId, 'helper', req.user.first_name, message, clientMessageId]
      );

      messageId = msg?.id || null;
      if (!messageId && clientMessageId) {
        const existingMessage = await client.query(
          `SELECT id FROM guest_profile_chat_messages
           WHERE session_id = $1 AND client_message_id = $2 LIMIT 1`,
          [sessionId, clientMessageId]
        );
        messageId = existingMessage.rows[0]?.id || null;
        replayed = Boolean(messageId);
      }

      if (!replayed) {
        // Update session activity only for a newly committed message.
        await client.query(
          `UPDATE guest_profile_chat_inbound
           SET last_helper_message_at = CURRENT_TIMESTAMP,
               helper_messages_count = helper_messages_count + 1,
               last_activity_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [sessionId]
        );
      }
    }, 'send_helper_message');

    logger.info('Helper message sent', {
      sessionId,
      helperId
    });

    // Broadcast message to admins and guests monitoring this session
    if (!replayed) {
      broadcastGuestChatMessage(sessionId, {
        messageId,
        senderType: 'helper',
        senderName: req.user.first_name,
        message,
        createdAt: new Date().toISOString()
      });
    }

    res.status(replayed ? 200 : 201).json({
      messageId,
      sessionId,
      idempotent: replayed,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Guest or helper marks session as resolved
 * POST /api/guest-chat/sessions/:sessionId/resolve
 */
async function resolveSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.id;
    const { reason = 'completed' } = req.body;

    if (!userId) {
      throw new AppError('Authentication required', 401, 'auth_error');
    }

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status, helper_id FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new AppError('Session not found', 404, 'not_found');
      }

      // Only the assigned helper (or support staff resolving as helper) can
      // resolve. The guest branch (session.guest_id === userId) was dead:
      // HMAC-token guests never carry req.user, and this route requires
      // authenticate, so the caller is always an authenticated staff member.
      const isHelper = session.helper_id === userId;

      if (!isHelper) {
        throw new AppError('You do not own this session', 403, 'forbidden');
      }

      // Transition to resolved
      await updateSessionStatus(client, sessionId, 'resolved', {
        total_resolution_time_seconds: Math.floor(
          (new Date() - new Date(session.created_at)) / 1000
        )
      });

      // Log resolution
      await logChatEvent(client, sessionId, 'session_resolved', {
        helperId: session.helper_id,
        triggeredBy: userId,
        metadata: {
          resolved_by: 'helper',
          reason
        }
      });
    }, 'resolve_session');

    logger.info('Guest chat session resolved', {
      sessionId,
      resolvedBy: userId
    });

    // Broadcast session update to admins
    broadcastGuestSessionUpdate(sessionId, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolvedBy: userId
    });

    res.json({
      sessionId,
      status: 'resolved'
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get session details and messages
 * GET /api/guest-chat/sessions/:sessionId
 */
async function getSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    requireGuestSessionToken(req, sessionId);

    // Explicit guest-facing column list: never leak internal columns
    // (ai_summary, helper_id, deadlines, token/code hashes, metadata).
    const { rows: [session] } = await db.query(
      `SELECT id, guest_name, guest_email, session_status, message,
              verification_status, created_at
         FROM guest_profile_chat_inbound WHERE id = $1`,
      [sessionId]
    );

    if (!session) {
      throw new AppError('Session not found', 404, 'not_found');
    }

    const { rows: messages } = await db.query(
      `SELECT id, sender_type, sender_name, message, created_at
       FROM guest_profile_chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );

    res.json({
      session,
      messages
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createGuestSession,
  sendGuestMessage,
  helperClaimSession,
  sendHelperMessage,
  resolveSession,
  getSession,
  createGuestToken,
  verifyGuestToken,
};
