'use strict';

// Review P1-4-F01: quote-flow requests submitted by guests are ownerless
// (user_id NULL), so the customer can never manage them afterwards. When an
// account is created or a signed-in customer asks, attach the guest requests
// whose contact email matches the verified account email.

const db = require('../db');
const logger = require('../utils/logger');

/**
 * Attach every ownerless quote request submitted with this email to the
 * user. Never throws: claiming must not break signup or sign-in flows.
 * Returns the number of requests claimed.
 */
async function claimGuestQuoteRequestsForUser(userId, email) {
  try {
    const clean = String(email || '').trim().toLowerCase();
    if (!userId || !clean) return 0;
    const { rowCount } = await db.query(
      `UPDATE quote_requests
          SET user_id = $1, updated_at = NOW()
        WHERE user_id IS NULL
          AND LOWER(email) = $2`,
      [userId, clean]
    );
    if (rowCount) {
      logger.info('Claimed guest quote requests for new account', { userId, count: rowCount });
    }
    return rowCount || 0;
  } catch (err) {
    logger.warn('Failed to claim guest quote requests', { userId, error: err.message });
    return 0;
  }
}

module.exports = { claimGuestQuoteRequestsForUser };
