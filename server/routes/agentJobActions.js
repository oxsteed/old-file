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
const agentJobActions = require('../controllers/agentJobActions');

router.post(
  '/jobs/:jobId/cancel',
  requireAdmin,
  requirePermission('issue_refunds'),
  agentJobActions.cancelJobAsAgent
);

module.exports = router;
