'use strict';

/**
 * server/controllers/agentBookingActions.js
 *
 * Support-agent initiated actions on booking requests. The cancellation
 * handler below performs the SAME status transitions and side effects as
 * the user-facing flows in bookingController.js (cancelBookingRequest /
 * helperCancelAcceptedBooking):
 *   - pending   -> cancelled
 *   - accepted  -> accepted_cancelled (plus linked appointment cancellation
 *                 via bookingLifecycle.cancelLinkedAppointment)
 *   - audit row in booking_request_audit_log
 *   - notifications via notificationService + socket broadcasts
 *
 * Differences that make this the agent variant:
 *   - the actor is recorded as the admin (actor_type 'admin'), with the
 *     supplied reason stored in the audit metadata and surfaced on the row;
 *   - BOTH parties (customer and provider) are notified, since neither of
 *     them initiated the cancellation;
 *   - grant-gated with `issue_refunds` (see below).
 *
 * Grant: `issue_refunds`. Cancelling a booking can release or refund a
 * deposit collected under the booking's refund policy, so this action
 * moves money in the general case. No new grant is minted; the existing
 * money-movement grant used by every other Customer360 resolution action
 * applies here unchanged.
 */

const pool = require('../db');
const { sendError } = require('../utils/apiError');
const logger = require('../utils/logger');
const { withTransaction } = require('../utils/transaction');
const { sendNotification } = require('../services/notificationService');
const { broadcastToUser } = require('../services/socketService');
const bookingLifecycle = require('../services/bookingRequestLifecycle');

// Mirrors the cancellable states of the user-facing flows:
// customer may cancel pending or accepted; helper may cancel accepted.
const CANCELLABLE_STATUSES = new Set(['pending', 'accepted']);

// Cancelling an already-cancelled booking is idempotent: a clean no-op,
// never re-notified and never re-applied.
const ALREADY_CANCELLED_STATUSES = new Set(['cancelled', 'accepted_cancelled']);

function statusAfterCancel(status) {
  return status === 'accepted' ? 'accepted_cancelled' : 'cancelled';
}

/**
 * Notify both parties of an agent-initiated cancellation. Mirrors the
 * notification bodies/types of the user-facing helpers
 * (notifyCustomerOfBookingResponse with 'accepted_cancelled' and
 * notifyHelperOfBookingCancellation) with the agent's reason appended.
 */
async function notifyBothParties(booking, reason) {
  const summary = `${booking.service_name}, ${booking.requested_date}${
    reason ? ` (${reason})` : ''
  }`;

  broadcastToUser(booking.customer_id, 'booking:updated', {
    bookingId: booking.id,
    status: booking.status,
  });
  await sendNotification({
    userId: booking.customer_id,
    type: 'booking_cancelled',
    body: summary,
    data: { bookingId: booking.id },
    action_url: '/my-bookings',
  });

  broadcastToUser(booking.helper_id, 'booking:updated', {
    bookingId: booking.id,
    status: booking.status,
  });
  await sendNotification({
    userId: booking.helper_id,
    type: 'booking_cancelled',
    body: summary,
    data: { bookingId: booking.id },
    action_url: '/calendar?tab=bookingRequests',
  });
}

/**
 * POST /api/agent/bookings/:bookingId/cancel
 *
 * Body: { reason: string } (required, non-empty)
 *
 * Agent cancels a pending or accepted booking on behalf of the platform.
 * The status update and the audit row commit atomically; if anything in
 * the underlying flow fails, the transaction rolls back and the request
 * is rejected, so a booking is never left half-cancelled.
 */
exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const adminId = req.user && req.user.id;
    const reason =
      req.body && typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (!reason) {
      return sendError(
        res,
        400,
        'A reason is required to cancel a booking',
        'reason_required'
      );
    }

    const { rows } = await pool.query(
      'SELECT * FROM booking_requests WHERE id = $1',
      [bookingId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, 'Booking request not found', 'not_found');
    }

    const booking = rows[0];

    // Idempotent: already cancelled by anyone -> clean non-error, no
    // re-apply, no re-notify.
    if (ALREADY_CANCELLED_STATUSES.has(booking.status)) {
      return res.json({
        success: true,
        already_cancelled: true,
        data: bookingLifecycle.toCalendarBooking(booking),
      });
    }

    if (!CANCELLABLE_STATUSES.has(booking.status)) {
      return sendError(
        res,
        409,
        `Cannot cancel a ${booking.status} booking request`,
        'booking_not_cancellable'
      );
    }

    const newStatus = statusAfterCancel(booking.status);

    // Fail closed: status update + audit log commit atomically. A
    // concurrent state change or any DB error rolls everything back.
    let updated;
    try {
      updated = await withTransaction(
        pool,
        async (client) => {
          const updatedResult = await client.query(
            `UPDATE booking_requests
                SET status = $2,
                    helper_response_reason = COALESCE($3, helper_response_reason),
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND status = $4
              RETURNING *`,
            [bookingId, newStatus, reason, booking.status]
          );
          if (!updatedResult.rows.length) {
            const conflict = new Error('Booking state changed during cancellation');
            conflict.status = 409;
            conflict.code = 'state_conflict';
            throw conflict;
          }
          const updatedRow = updatedResult.rows[0];

          // Cancelling an accepted booking must also cancel the confirmed
          // appointment it created (helper or business calendar). Kept
          // best-effort like the user-facing flows: a calendar cleanup
          // failure must not abort the cancellation itself.
          try {
            await bookingLifecycle.cancelLinkedAppointment(
              updatedRow,
              updatedRow.helper_id,
              client
            );
          } catch (e) {
            logger.warn('Failed to cancel linked appointment on agent cancel', {
              bookingId,
              error: e.message,
            });
          }

          // Audit: who (admin), what booking, reason, before/after status.
          await client.query(
            `INSERT INTO booking_request_audit_log
               (booking_request_id, action, actor_id, actor_type, old_status, new_status, metadata)
             VALUES ($1, $2, $3, 'admin', $4, $5, $6)`,
            [
              bookingId,
              'admin_booking_cancel',
              adminId,
              booking.status,
              newStatus,
              JSON.stringify({ reason }),
            ]
          );

          return updatedRow;
        },
        'agent_booking_cancel'
      );
    } catch (err) {
      // Transaction rolled back: reject instead of leaving a half-cancelled booking.
      if (err.status) {
        return sendError(res, err.status, err.message, err.code || 'cancellation_failed');
      }
      throw err;
    }

    // Post-commit side effect: notify BOTH parties. Best-effort, matching
    // the user-facing flows: a notification failure must not un-commit the
    // cancellation or surface as a cancellation failure.
    try {
      await notifyBothParties(updated, reason);
    } catch (e) {
      logger.warn('Agent booking cancel notifications failed', {
        bookingId,
        error: e.message,
      });
    }

    logger.info('Agent cancelled booking', {
      bookingId,
      adminId,
      from: booking.status,
      to: newStatus,
    });

    return res.json({
      success: true,
      data: bookingLifecycle.toCalendarBooking(updated),
    });
  } catch (err) {
    logger.error('Error agent-cancelling booking', { error: err.message });
    return sendError(res, 500, 'Failed to cancel booking');
  }
};
