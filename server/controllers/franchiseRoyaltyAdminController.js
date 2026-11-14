'use strict';

// Domain 8 #13: admin read surface for the franchise royalty
// failure outbox (franchise_royalty_failures). Failed accruals used
// to be visible only by querying the table directly; parked rows
// (10 failed attempts) are now listed here for operator review.

const pool = require('../db');
const { listRoyaltyFailures } = require('../services/franchiseRoyaltyService');

const STATUSES = new Set(['open', 'parked', 'resolved', 'all']);

async function listFailures(req, res, next) {
  try {
    const status = String(req.query.status || 'open');
    if (!STATUSES.has(status)) {
      return res.status(400).json({
        error: `Unknown royalty failure status: ${status}`,
        code: 'invalid_status',
      });
    }
    const result = await listRoyaltyFailures(pool, {
      status,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = { listRoyaltyFailures: listFailures };
