// server/controllers/modePlatformApprovalController.js
//
// HTTP wrapper around modePlatformApprovalService. Two surfaces:
//
//   USER:
//     GET    /api/mode-approvals/me                  list my approvals
//     GET    /api/mode-approvals/me/:mode            get my approval for one mode
//     POST   /api/mode-approvals/me/:mode/request    submit application
//     GET    /api/mode-approvals/policies            list public policy info
//
//   ADMIN (super_admin):
//     GET    /api/admin/mode-policies                full policies (incl. schemas)
//     PATCH  /api/admin/mode-policies/:mode          edit a policy
//     GET    /api/admin/mode-approvals               pending queue
//     GET    /api/admin/mode-approvals/:id           one approval
//     POST   /api/admin/mode-approvals/:id/approve   approve
//     POST   /api/admin/mode-approvals/:id/reject    reject
//     POST   /api/admin/mode-approvals/:id/revoke    revoke a previously approved one

'use strict';

const svc = require('../services/modePlatformApprovalService');
const logger = require('../utils/logger');

// ── USER ─────────────────────────────────────────────────────────────────────

exports.listMine = async (req, res) => {
  try {
    const rows = await svc.listApprovalsForUser(req.user.id);
    res.json({ success: true, approvals: rows });
  } catch (err) {
    logger.error('listMine approvals error', { err: err.message });
    res.status(500).json({ error: 'failed' });
  }
};

exports.getMine = async (req, res) => {
  try {
    const { mode } = req.params;
    const approval = await svc.getApproval(req.user.id, mode);
    const policy = await svc.getPolicy(mode);
    res.json({
      success: true,
      approval,
      policy: policy ? {
        mode: policy.mode,
        requires_approval: policy.requires_approval,
        auto_approve: policy.auto_approve,
        gated_actions: policy.gated_actions,
        application_schema: policy.application_schema,
      } : null,
    });
  } catch (err) {
    logger.error('getMine approval error', { err: err.message });
    res.status(500).json({ error: 'failed' });
  }
};

exports.requestMine = async (req, res) => {
  try {
    const { mode } = req.params;
    const result = await svc.requestApproval({
      userId: req.user.id,
      mode,
      applicationData: req.body || {},
    });
    if (result.resolution === 'validation_failed') {
      return res.status(400).json({
        error: 'validation_failed',
        fields: result.errors,
      });
    }
    if (result.resolution === 'not_required') {
      return res.json({ success: true, status: 'not_required' });
    }
    res.json({
      success: true,
      resolution: result.resolution,
      approval: result.approval,
    });
  } catch (err) {
    logger.error('requestMine approval error', { err: err.message, code: err.code });
    if (err.code === 'policy_not_found') return res.status(404).json({ error: 'policy_not_found' });
    res.status(500).json({ error: 'failed' });
  }
};

exports.listPublicPolicies = async (_req, res) => {
  try {
    const rows = await svc.listPolicies();
    res.json({
      success: true,
      policies: rows.map(p => ({
        mode: p.mode,
        requires_approval: p.requires_approval,
        auto_approve: p.auto_approve,
        gated_actions: p.gated_actions,
        application_schema: p.application_schema,
      })),
    });
  } catch (err) {
    logger.error('listPublicPolicies error', { err: err.message });
    res.status(500).json({ error: 'failed' });
  }
};

// ── ADMIN ────────────────────────────────────────────────────────────────────

exports.adminListPolicies = async (_req, res) => {
  try {
    const rows = await svc.listPolicies();
    res.json({ success: true, policies: rows });
  } catch (err) {
    logger.error('adminListPolicies error', { err: err.message });
    res.status(500).json({ error: 'failed' });
  }
};

exports.adminUpdatePolicy = async (req, res) => {
  try {
    const { mode } = req.params;
    const { requires_approval, auto_approve, gated_actions, application_schema } = req.body;
    const updated = await svc.updatePolicy({
      mode,
      requires_approval,
      auto_approve,
      gated_actions,
      application_schema,
      updated_by_user_id: req.user.id,
    });
    if (!updated) return res.status(404).json({ error: 'policy_not_found' });
    res.json({ success: true, policy: updated });
  } catch (err) {
    logger.error('adminUpdatePolicy error', { err: err.message });
    res.status(500).json({ error: 'failed' });
  }
};

exports.adminListApprovals = async (req, res) => {
  try {
    const { mode } = req.query;
    const parsedLimit = parseInt(req.query.limit, 10);
    const parsedOffset = parseInt(req.query.offset, 10);
    const limit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 100;
    const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1_000_000) : 0;
    const rows = await svc.listPendingApprovals({ mode, limit, offset });
    res.json({ success: true, approvals: rows });
  } catch (err) {
    logger.error('adminListApprovals error', { err: err.message });
    res.status(500).json({ error: 'failed' });
  }
};

exports.adminDecide = (decision) => async (req, res) => {
  try {
    const approvalId = parseInt(req.params.id, 10);
    const { notes, rejection_reason } = req.body || {};
    const updated = await svc.decideApproval({
      reviewerId: req.user.id,
      approvalId,
      decision,
      notes,
      rejectionReason: rejection_reason,
    });
    res.json({ success: true, approval: updated });
  } catch (err) {
    logger.error('adminDecide approval error', { err: err.message, code: err.code });
    if (err.code === 'approval_not_found') return res.status(404).json({ error: 'not_found' });
    if (err.code === 'invalid_decision') return res.status(400).json({ error: 'invalid_decision' });
    res.status(500).json({ error: 'failed' });
  }
};
