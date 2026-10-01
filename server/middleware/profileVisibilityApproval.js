// server/middleware/profileVisibilityApproval.js
// Workstream B: require a verified two-person approval before high-risk
// (bulk) or scheduled profile-visibility actions execute.
//
// The handler is created with enforceVisibilityApproval(actionType,
// { bulkThreshold }). The request body must carry approval_id; the
// middleware verifies the approval is 'approved' and that its fingerprint
// matches the normalized body payload (minus approval_id itself).
//
// On failure: 409 { approval_required: true, hint }.
// On success: req.visibilityApproval is set and the handler may call
// consumeApproval(approvalId) after executing.

'use strict';

const { verifyApprovalForAction } = require('../services/profileVisibilityApprovals');
const logger = require('../utils/logger');

const BULK_ACTIONS = ['bulk', 'scheduled'];

// Strip fields that are not part of the approved payload so the fingerprint
// verification compares what the reviewer actually reviewed.
function approvedPayloadFromBody(body) {
  const { approval_id, approvalId, ...rest } = body || {};
  return rest;
}

function enforceVisibilityApproval(actionType, { bulkThreshold = 10 } = {}) {
  return async (req, res, next) => {
    try {
      const body = req.body || {};
      const approvalId = body.approval_id || body.approvalId || null;

      // Single, in-threshold actions skip the approval gate.
      if (actionType === 'bulk' && Array.isArray(body.items) && body.items.length <= bulkThreshold) {
        return next();
      }
      if (!BULK_ACTIONS.includes(actionType)) {
        return next();
      }

      if (!approvalId) {
        return res.status(409).json({
          approval_required: true,
          hint: 'This action needs a second admin approval. Request one at POST /approvals/request, then retry with approval_id.',
        });
      }

      const payload = approvedPayloadFromBody(body);
      const approval = await verifyApprovalForAction({ approvalId, actionType, payload });
      if (!approval) {
        return res.status(409).json({
          approval_required: true,
          hint: 'The approval is missing, not approved, or does not match the requested payload. Request a fresh approval and retry.',
        });
      }

      req.visibilityApproval = approval;
      return next();
    } catch (err) {
      logger.error('profileVisibilityApproval middleware error', { err, actionType });
      return res.status(500).json({ error: 'Approval verification failed.' });
    }
  };
}

module.exports = { enforceVisibilityApproval };
