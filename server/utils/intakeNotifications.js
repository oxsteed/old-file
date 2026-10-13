'use strict';

/**
 * Intake-received fan-out (review P2-9-F04).
 *
 * Submitted intakes used to go nowhere observable: the six public intake
 * controllers wrote rows but never notified anyone. This helper notifies the
 * business owner (businesses.user_id) in-app/push when a new intake lands,
 * deep-linking to the matching operations tab in the business hub. The
 * idempotency key makes retries safe: a resubmitted request never
 * double-notifies.
 *
 * Never throws: a notification failure must not fail intake creation.
 */

const { query } = require('../db');
const logger = require('./logger');
const { sendNotification } = require('../services/notificationService');

// Maps the intake area to the business-hub tab that triages it.
const AREA_TABS = {
  beauty: 'beauty-ops',
  creative: 'creative-ops',
  continuity: 'continuity-ops',
  professional: 'professional-ops',
  trades: 'trades-ops',
  maintenance: 'maintenance',
};

async function notifyIntakeReceived({ businessId, intakeId, area }) {
  try {
    if (!businessId || !intakeId) return { success: false, reason: 'missing_args' };
    const tab = AREA_TABS[area] || 'overview';
    const { rows } = await query(
      'SELECT user_id, business_name FROM businesses WHERE id = $1',
      [businessId]
    );
    const ownerId = rows[0] && rows[0].user_id;
    if (!ownerId) {
      logger.warn('[intake] no owner to notify for intake', { businessId, intakeId, area });
      return { success: false, reason: 'no_owner' };
    }
    return await sendNotification({
      userId: ownerId,
      type: 'intake_request_received',
      data: {
        business_id: String(businessId),
        intake_id: String(intakeId),
        area: String(area || 'general'),
        business_name: rows[0].business_name || null,
      },
      action_url: `/business/${businessId}/workspace/${tab}`,
      idempotencyKey: `intake-received:${area || 'general'}:${intakeId}`,
    });
  } catch (err) {
    logger.warn('[intake] intake-received notification failed', {
      businessId,
      intakeId,
      area,
      error: err.message,
    });
    return { success: false, error: err.message };
  }
}

module.exports = { notifyIntakeReceived };
