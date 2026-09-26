// Transaction-safe helper for guest chat operations
const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Execute a chat operation with proper transaction handling and rollback
 * @param {Function} callback - Async function that receives database client
 * @param {string} operationName - Name of operation for logging
 * @returns {Promise} - Result of callback function
 */
async function withChatTransaction(callback, operationName = 'chat_operation') {
  const client = await pool.connect();

  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

    const result = await callback(client);

    await client.query('COMMIT');
    logger.info(`[withChatTransaction] ${operationName} succeeded`, {
      operation: operationName
    });

    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
      logger.info(`[withChatTransaction] ${operationName} rolled back`, {
        operation: operationName,
        error: err.message
      });
    } catch (rollbackErr) {
      logger.error(`[withChatTransaction] rollback failed`, {
        operation: operationName,
        error: rollbackErr.message
      });
    }

    throw err;
  } finally {
    client.release();
  }
}

/**
 * Safely update session status with validation
 * Prevents race conditions using SELECT FOR UPDATE
 */
async function updateSessionStatus(
  client,
  sessionId,
  newStatus,
  updates = {}
) {
  // Validate status transition
  const validTransitions = {
    waiting_for_helper: ['ai_fallback_pending', 'helper_assigned', 'abandoned'],
    ai_fallback_pending: ['ai_support_active', 'helper_assigned'],
    ai_support_active: ['helper_takeover_requested', 'helper_assigned', 'resolved', 'abandoned'],
    helper_takeover_requested: ['helper_assigned', 'ai_support_active'],
    helper_assigned: ['resolved', 'abandoned'],
    resolved: [],
    abandoned: []
  };

  // Get current session with lock
  const current = await client.query(
    `SELECT session_status, helper_id FROM guest_profile_chat_inbound
     WHERE id = $1 FOR UPDATE`,
    [sessionId]
  );

  if (!current.rows[0]) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const currentStatus = current.rows[0].session_status;

  // Validate transition
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    throw new Error(
      `Invalid status transition from ${currentStatus} to ${newStatus}`
    );
  }

  // Build update query
  const updateFields = {
    session_status: newStatus,
    last_activity_at: new Date().toISOString(),
    ...updates
  };

  // The database requires helper_response_deadline to be NULL once a session
  // leaves waiting_for_helper. Enforce that invariant centrally so every
  // status transition remains valid, including future callers.
  if (newStatus !== 'waiting_for_helper') {
    updateFields.helper_response_deadline = null;
  }

  const updateKeys = Object.keys(updateFields);
  const setClause = updateKeys
    .map((key, i) => `${key} = $${i + 2}`)
    .join(', ');

  const values = [sessionId, ...updateKeys.map(k => updateFields[k])];

  const result = await client.query(
    `UPDATE guest_profile_chat_inbound
     SET ${setClause}
     WHERE id = $1
     RETURNING *`,
    values
  );

  return result.rows[0];
}

/**
 * Log chat event with context
 */
async function logChatEvent(
  client,
  sessionId,
  eventType,
  { helperId = null, triggeredBy = null, metadata = {} } = {}
) {
  return client.query(
    `INSERT INTO chat_monitoring_log
     (session_id, event_type, helper_id, triggered_by_user_id, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [sessionId, eventType, helperId, triggeredBy, JSON.stringify(metadata)]
  );
}

/**
 * Drain queued messages from transition period
 * Called when transitioning between states
 */
async function drainMessageQueue(client, sessionId, targetHandler) {
  const queued = await client.query(
    `SELECT * FROM chat_message_queue
     WHERE session_id = $1 AND processed_at IS NULL
     ORDER BY created_at ASC`,
    [sessionId]
  );

  if (queued.rows.length === 0) {
    return [];
  }

  const processed = [];

  for (const msg of queued.rows) {
    // Re-route message to target handler (helper or AI)
    const result = await targetHandler(msg);

    // Mark as processed
    await client.query(
      `UPDATE chat_message_queue SET processed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [msg.id]
    );

    processed.push(result);
  }

  // Log the drain event
  await logChatEvent(client, sessionId, 'transition_queue_drained', {
    metadata: { message_count: processed.length }
  });

  return processed;
}

/**
 * Safely queue a message if session is in transition
 * Returns true if queued, false if should be processed immediately
 */
async function queueMessageIfTransitioning(client, sessionId, message) {
  const session = await client.query(
    `SELECT session_status FROM guest_profile_chat_inbound WHERE id = $1`,
    [sessionId]
  );

  if (!session.rows[0]) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Queue if in transition state
  const isTransitioning = session.rows[0].session_status === 'helper_takeover_requested';

  if (isTransitioning) {
    await client.query(
      `INSERT INTO chat_message_queue
       (session_id, sender_type, sender_id, message)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, message.sender_type, message.sender_id, message.message]
    );
    return true;
  }

  return false;
}

module.exports = {
  withChatTransaction,
  updateSessionStatus,
  logChatEvent,
  drainMessageQueue,
  queueMessageIfTransitioning
};
