'use strict';

/**
 * server/controllers/attentionInboxController.js
 *
 * GET /api/businesses/attention — the Business Attention Inbox.
 * Authenticated, read-only, paginated. All access checks happen inside
 * collectAttention (re-resolved on every request); this controller only
 * validates query shape and maps errors to HTTP status codes.
 */

const { collectAttention } = require('../services/attention');
const { sendError } = require('../utils/apiError');

async function getAttentionInbox(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return sendError(res, 401, 'Authentication required.', 'auth_required');
    }
    const result = await collectAttention({
      userId: req.user.id,
      businessId: req.query.businessId,
      category: req.query.category,
      urgency: req.query.urgency,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json(result);
  } catch (err) {
    if (err.statusCode) {
      return sendError(res, err.statusCode, err.message, err.code || 'error');
    }
    return next(err);
  }
}

module.exports = { getAttentionInbox };
