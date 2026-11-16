'use strict';

const { can } = require('./accessService');
const { consultantEnforcement } = require('./flags');
const platformApproval = require('../modePlatformApprovalService');
const logger = require('../../utils/logger');

const CAPABILITY = 'consultant.accept_paying_clients';
const ACTION = 'accept_paying_booking';

async function checkPayingAccess(userId, { client, lockGrant = false } = {}) {
  const mode = consultantEnforcement();

  if (mode === 'enforce') {
    if (lockGrant) {
      // The grant status writer locks this same row before revoking it.
      await client.query(
        `SELECT id FROM access_grants
         WHERE user_id = $1 AND capability = $2 AND subject_key = 'self' FOR SHARE`,
        [userId, CAPABILITY],
      );
    }
    const decision = await can(userId, CAPABILITY, { type: 'self' }, client);
    return { ...decision, code: 'access_required', capability: CAPABILITY };
  }

  const legacy = await platformApproval.canPerformAction(userId, 'consultant', ACTION);
  if (mode === 'shadow') {
    try {
      const decision = await can(userId, CAPABILITY, { type: 'self' }, client);
      if (decision.allowed !== legacy.allowed) {
        logger.warn('access.shadow_mismatch', {
          capability: CAPABILITY,
          legacyAllowed: legacy.allowed,
          capabilityAllowed: decision.allowed,
          reason: decision.reason,
        });
      }
    } catch (error) {
      logger.warn('access.shadow_error', { capability: CAPABILITY, code: error.code });
    }
  }
  return { ...legacy, code: 'platform_approval_required', mode: 'consultant', action: ACTION };
}

function bookingDenial(decision) {
  return {
    error: 'consultant_pending_platform_approval',
    message: 'This consultant is still completing OxSteed verification and cannot accept bookings yet.',
    ...(decision.current_status && { current_status: decision.current_status }),
  };
}

module.exports = { checkPayingAccess, bookingDenial };
