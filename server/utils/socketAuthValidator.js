// ATTACK #6 FIX: Socket.IO Token Re-validation
// Ensures tokens are re-validated for sensitive operations (not just on initial connection)

const pool = require('../db');
const logger = require('./logger');

/**
 * Re-validate socket user's token and account status
 * Call this before sensitive operations (accessing conversations, sending messages, etc.)
 *
 * Returns true if user is still valid, false if token has been revoked
 */
async function validateSocketUser(socket) {
  if (!socket.userId) return false;

  try {
    const { rows } = await pool.query(
      `SELECT is_active, deleted_at, role FROM users WHERE id = $1`,
      [socket.userId]
    );

    if (!rows[0]) {
      // User deleted
      logger.warn('Socket auth failed: user not found', { userId: socket.userId });
      return false;
    }

    if (!rows[0].is_active) {
      // User suspended/deactivated
      logger.warn('Socket auth failed: user account suspended', { userId: socket.userId });
      return false;
    }

    if (rows[0].deleted_at) {
      // User soft-deleted
      logger.warn('Socket auth failed: user deleted', { userId: socket.userId });
      return false;
    }

    // Roles can change while a long-lived dashboard socket remains connected.
    // Refresh the role before every sensitive event so privilege changes take
    // effect without relying on a reconnect.
    if (rows[0].role) socket.userRole = rows[0].role;

    return true;
  } catch (err) {
    logger.error('Socket auth validation error', { userId: socket.userId, error: err.message });
    return false;
  }
}

/**
 * Middleware wrapper: validate socket auth before allowing handler to execute
 * Usage: socket.on('sensitive_event', validateBeforeHandler(async (data) => { ... }))
 */
function validateBeforeHandler(handler) {
  return async function(data, ...args) {
    const socket = this;

    // Re-validate token
    if (!(await validateSocketUser(socket))) {
      socket.emit('error', {
        code: 'auth_revoked',
        message: 'Your authentication has been revoked. Please reconnect.'
      });
      socket.disconnect(true);
      return;
    }

    // User is valid, call handler
    return handler.call(socket, data, ...args);
  };
}

module.exports = {
  validateSocketUser,
  validateBeforeHandler
};
