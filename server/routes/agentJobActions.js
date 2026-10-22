'use strict';

/**
 * Agent workspace resolution actions (support admin surface).
 *
 * Mounted by the parent at `/api/admin` (see server/index.js), giving:
 *   POST /api/admin/jobs/:jobId/cancel
 *
 * Every money-moving action on this router is grant-gated. Job cancellation
 * can move money (cancellation fees are collected from the customer and paid
 * to the helper), so it requires the `issue_refunds` grant — the same grant
 * used by the other agent money actions wired in Customer360Panel.jsx
 * (payment refunds, marketplace order refunds/cancels, job payment refunds).
 */

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const agentJobActions = require('../controllers/agentJobActions');
const { strictLimiter } = require('../middleware/rateLimiter');

// Audit fix (finding 24): step-up challenge issuance for post-acceptance
// agent cancels (fees may apply). The cancel route below verifies it.
router.post(
  '/stepup-challenges/agent-job-cancel',
  strictLimiter,
  requireAdmin,
  rejectImpersonated,
  requirePermission('issue_refunds'),
  agentJobActions.issueAgentJobCancelStepupChallenge
);

router.post(
  '/jobs/:jobId/cancel',
  strictLimiter,
  requireAdmin,
  requirePermission('issue_refunds'),
  agentJobActions.cancelJobAsAgent
);

module.exports = router;
