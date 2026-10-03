'use strict';

/**
 * server/routes/agentBookingActions.js
 *
 * Support-agent resolution actions on bookings (used by the admin
 * Customer360 panel). All routes require an authenticated admin and the
 * `issue_refunds` grant, matching the other Customer360 money-moving
 * resolution actions (payment / order / job refunds).
 *
 * Mount (server/index.js): app.use('/api/agent/bookings', require('./routes/agentBookingActions'));
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const agentBookingActions = require('../controllers/agentBookingActions');

const router = express.Router();

// Agent cancels a pending or accepted booking. Reason required, idempotent,
// actor recorded as the admin; both parties are notified.
router.post(
  '/:bookingId/cancel',
  requireAuth,
  requireAdmin,
  requirePermission('issue_refunds'),
  agentBookingActions.cancelBooking
);

module.exports = router;
