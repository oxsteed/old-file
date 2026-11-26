'use strict';

// G11-B2/A5: one failure-safe sender for rental lifecycle in-app
// notifications. Every send honors the recipient's tool-rentals
// notify_bookings toggle (tool_rental_notifications.notify_bookings,
// default TRUE): the toggle was dead before this batch (G11-A5) because
// nothing consumed it. Support-escalation notices (Wave 3, D-572) keep
// their own sender: an escalation is a safety thread, not a booking
// lifecycle event, so the bookings toggle does not silence it.
//
// All sends carry a per-event idempotency key so a retry cannot
// duplicate the row, and never throw: a failed notice is logged and the
// booking transition still stands.
const db = require('../db');
const logger = require('../utils/logger');

async function rentalNotifyAllowed(userId) {
  try {
    const { rows } = await db.query(
      'SELECT notify_bookings FROM tool_rental_notifications WHERE user_id = $1',
      [userId],
    );
    if (!rows[0]) return true;
    return rows[0].notify_bookings !== false;
  } catch (err) {
    logger.warn('rentalNotifyAllowed lookup failed, notifying anyway', { userId, error: err.message });
    return true;
  }
}

async function notifyRental({ userId, type, bookingId, eventKey, data = {}, actionUrl = '/my-bookings' }) {
  try {
    if (!(await rentalNotifyAllowed(userId))) return { success: false, reason: 'notify_bookings_off' };
    const { sendNotification } = require('../services/notificationService');
    const result = await sendNotification({
      userId: String(userId),
      type,
      data: { booking_id: String(bookingId), ...data },
      action_url: actionUrl,
      idempotencyKey: `tool-rental-${type}:${eventKey}:${userId}`,
    });
    if (result?.success === false) {
      logger.warn('Rental notification not delivered', { userId, type, bookingId, reason: result.reason });
    }
    return result;
  } catch (err) {
    logger.warn('Rental notification failed', { userId, type, bookingId, error: err.message });
    return { success: false, reason: 'error' };
  }
}

// Notify the party on the other side of the booking from the actor.
async function notifyRentalCounterparty({ booking, actorId, type, eventKey, data = {} }) {
  const counterpartyId = String(actorId) === String(booking.owner_id) ? booking.customer_id : booking.owner_id;
  if (String(counterpartyId) === String(actorId)) return { success: false, reason: 'no_counterparty' };
  return notifyRental({ userId: counterpartyId, type, bookingId: booking.id, eventKey, data });
}

module.exports = { rentalNotifyAllowed, notifyRental, notifyRentalCounterparty };
