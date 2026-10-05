'use strict';

// Admin controller for restaurant wallet-earnings payouts.
// Every mutation needs the explicit manage_financials grant (super-admin
// bypasses the grant but not the audit trail, keyed on admin identity).

const db = require('../db');
const payoutService = require('../services/restaurantPayoutService');

exports.listQueue = async (req, res, next) => {
  try {
    const client = await db.connect();
    try {
      const payouts = await payoutService.listAdminQueue(client, {
        status: (req.query.status || 'requested').toString(),
        limit: req.query.limit,
      });
      res.json({ payouts });
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

exports.approve = async (req, res, next) => {
  try {
    const payout = await payoutService.approvePayout({
      payoutId: req.params.payoutId,
      adminUserId: req.user.id,
      reviewNote: req.body.reviewNote || req.body.review_note,
    });
    res.json({ payout });
  } catch (err) {
    next(err);
  }
};

exports.reject = async (req, res, next) => {
  try {
    const payout = await payoutService.rejectPayout({
      payoutId: req.params.payoutId,
      adminUserId: req.user.id,
      reviewNote: req.body.reviewNote || req.body.review_note,
    });
    res.json({ payout });
  } catch (err) {
    next(err);
  }
};
