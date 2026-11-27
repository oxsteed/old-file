'use strict';

// Group 1 (Customer), item 23 — receipt vault (G1-A2, checkpoint 3).
// Read-only: every read is scoped to the requesting customer.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const receiptsController = require('../controllers/receiptsController');

const router = express.Router();

router.get('/', requireAuth, receiptsController.listReceipts);
router.get('/helper-bookings/:bookingId', requireAuth, receiptsController.getHelperBookingReceipt);

module.exports = router;
