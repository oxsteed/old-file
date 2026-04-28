const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { withChatTransaction, updateSessionStatus, logChatEvent, queueMessageIfTransitioning, drainMessageQueue } = require('../services/chatTransactionService');
const { broadcastNewGuestSession, broadcastGuestSessionUpdate, broadcastGuestChatMessage } = require('../services/socketService');
const logger = require('../utils/logger');

/**
 * Guest creates a new chat session and sends initial message
 * POST /api/guest-chat/sessions
 */
async function createGuestSession(req, res, next) {
  try {
    const { guestName, guestEmail, message, consentMonitoring = false } = req.body;

    // Validate inputs
    if (!guestName || !guestName.trim()) {
      return res.status(400).json({ error: 'Guest name is required' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Initial message is required' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }

    let sessionId;
    let messageId;

    await withChatTransaction(async (client) => {
      sessionId = uuidv4();

      // Create guest session
      const { rows: [session] } = await client.query(
        `INSERT INTO guest_profile_chat_inbound
         (id, guest_name, guest_email, session_status, helper_response_deadline, guest_consent_monitoring, consent_requested_at, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + INTERVAL '5 minutes', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING *`,
        [sessionId, guestName, guestEmail, 'waiting_for_helper', consentMonitoring]
      );

      // Insert initial guest message
      const { rows: [msg] } = await client.query(
        `INSERT INTO guest_profile_chat_messages
         (session_id, sender_type, sender_name, message, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [sessionId, 'guest', guestName, message]
      );

      messageId = msg.id;

      // Log session creation event
      await logChatEvent(client, sessionId, 'session_created', {
        triggeredBy: null,
        metadata: {
          guest_name: guestName,
          guest_email: guestEmail,
          consent_monitoring: consentMonitoring
        }
      });
    }, 'create_guest_session');

    logger.info('Guest chat session created', {
      sessionId,
      guestName,
      consentMonitoring
    });

    // Broadcast new session to online helpers and admins
    broadcastNewGuestSession({
      sessionId,
      guestName,
      guestEmail,
      createdAt: new Date().toISOString(),
      deadlineMinutes: 5,
      initialMessage: message
    });

    res.status(201).json({
      sessionId,
      messageId,
      status: 'waiting_for_helper',
      deadlineMinutes: 5
    });
  } catch (err) {
    logger.error('Failed to create guest chat session', { error: err.message });
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
    const { guestName, message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }

    let messageId;

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      if (session.session_status === 'resolved' || session.session_status === 'abandoned') {
        throw new Error('Cannot send messages to resolved or abandoned sessions');
      }

      // Check if we should queue this message
      const shouldQueue = await queueMessageIfTransitioning(client, sessionId, {
        sender_type: 'guest',
        sender_name: guestName,
        message
      });

      if (!shouldQueue) {
        // Insert message directly
        const { rows: [msg] } = await client.query(
          `INSERT INTO guest_profile_chat_messages
           (session_id, sender_type, sender_name, message, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           RETURNING id`,
          [sessionId, 'guest', guestName, message]
        );
        messageId = msg.id;
      } else {
        // Message was queued, no messageId yet
        messageId = null;
      }

      // Update session activity
      await client.query(
        `UPDATE guest_profile_chat_inbound
         SET last_guest_message_at = CURRENT_TIMESTAMP,
             guest_messages_count = guest_messages_count + 1,
             last_activity_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [sessionId]
      );
    }, 'send_guest_message');

    logger.info('Guest message sent', {
      sessionId,
      queued: messageId === null
    });

    // Broadcast message to helpers/admins monitoring this session
    if (messageId) {
      broadcastGuestChatMessage(sessionId, {
        messageId,
        senderType: 'guest',
        senderName: guestName,
        message,
        createdAt: new Date().toISOString()
      });
    }

    res.json({
      messageId,
      queued: messageId === null,
      sessionId
    });
  } catch (err) {
    logger.error('Failed to send guest message', { error: err.message });
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('resolved or abandoned')) {
      return res.status(400).json({ error: err.message });
    }
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
    const helperId = req.user.id;

    if (!helperId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status, ai_summary FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Can only claim from ai_support_active state
      if (session.session_status !== 'ai_support_active') {
        throw new Error(`Cannot claim session in state: ${session.session_status}`);
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
    logger.error('Failed to claim session', { error: err.message });
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Cannot claim')) {
      return res.status(400).json({ error: err.message });
    }
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
    const { message } = req.body;
    const helperId = req.user.id;

    if (!helperId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message too long (max 4000 characters)' });
    }

    let messageId;

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status, helper_id FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Can only send messages if helper_assigned
      if (session.session_status !== 'helper_assigned') {
        throw new Error(`Cannot send messages in state: ${session.session_status}`);
      }

      // Verify this helper owns this session
      if (session.helper_id !== helperId) {
        throw new Error('Unauthorized: this session is not assigned to you');
      }

      // Insert message
      const { rows: [msg] } = await client.query(
        `INSERT INTO guest_profile_chat_messages
         (session_id, sender_type, sender_name, message, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id`,
        [sessionId, 'helper', req.user.first_name, message]
      );

      messageId = msg.id;

      // Update session activity
      await client.query(
        `UPDATE guest_profile_chat_inbound
         SET last_helper_message_at = CURRENT_TIMESTAMP,
             helper_messages_count = helper_messages_count + 1,
             last_activity_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [sessionId]
      );
    }, 'send_helper_message');

    logger.info('Helper message sent', {
      sessionId,
      helperId
    });

    // Broadcast message to admins and guests monitoring this session
    broadcastGuestChatMessage(sessionId, {
      messageId,
      senderType: 'helper',
      senderName: req.user.first_name,
      message,
      createdAt: new Date().toISOString()
    });

    res.json({
      messageId,
      sessionId
    });
  } catch (err) {
    logger.error('Failed to send helper message', { error: err.message });
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Cannot send messages')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message.includes('Unauthorized')) {
      return res.status(403).json({ error: err.message });
    }
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
      return res.status(401).json({ error: 'Authentication required' });
    }

    await withChatTransaction(async (client) => {
      // Get session with lock
      const { rows: [session] } = await client.query(
        `SELECT session_status, helper_id, guest_id FROM guest_profile_chat_inbound WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Verify user owns this session (either guest or helper)
      const isHelper = session.helper_id === userId;
      const isGuest = session.guest_id === userId;

      if (!isHelper && !isGuest) {
        throw new Error('Unauthorized: you do not own this session');
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
          resolved_by: isHelper ? 'helper' : 'guest',
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
    logger.error('Failed to resolve session', { error: err.message });
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Unauthorized')) {
      return res.status(403).json({ error: err.message });
    }
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

    const { rows: [session] } = await db.query(
      `SELECT * FROM guest_profile_chat_inbound WHERE id = $1`,
      [sessionId]
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
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
    logger.error('Failed to get session', { error: err.message });
    next(err);
  }
}

module.exports = {
  createGuestSession,
  sendGuestMessage,
  helperClaimSession,
  sendHelperMessage,
  resolveSession,
  getSession
};
