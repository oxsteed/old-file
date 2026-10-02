// client/src/api/modePlatformApprovals.js
//
// Thin axios wrappers for the mode-platform-approval endpoints (migration
// 272 + server/routes/modePlatformApprovals.js).

import api from './axios';

// ── User ────────────────────────────────────────────────────────────────────

export const listMyApprovals = () =>
  api.get('/mode-approvals/me').then(r => r.data);

export const getMyApproval = (mode) =>
  api.get(`/mode-approvals/me/${mode}`).then(r => r.data);

export const requestApproval = (mode, applicationData) =>
  api.post(`/mode-approvals/me/${mode}/request`, applicationData || {}).then(r => r.data);

export const listPublicPolicies = () =>
  api.get('/mode-approvals/policies').then(r => r.data);

// ── Admin (super-admin) ─────────────────────────────────────────────────────

export const adminListPolicies = () =>
  api.get('/admin/mode-policies').then(r => r.data);

export const adminUpdatePolicy = (mode, patch) =>
  api.patch(`/admin/mode-policies/${mode}`, patch).then(r => r.data);

export const adminListPolicyRevisions = (mode, params = {}) =>
  api.get(`/admin/mode-policies/${mode}/revisions`, { params }).then(r => r.data);

export const adminListPolicyCoverage = () =>
  api.get('/admin/mode-policies/coverage').then(r => r.data);

export const adminRollbackPolicy = (mode, payload) =>
  api.post(`/admin/mode-policies/${mode}/rollback`, payload).then(r => r.data);

export const adminListApprovals = (params = {}) =>
  api.get('/admin/mode-approvals', { params }).then(r => r.data);

export const adminApprove = (approvalId, notes) =>
  api.post(`/admin/mode-approvals/${approvalId}/approve`, { notes }).then(r => r.data);

export const adminReject = (approvalId, rejectionReason) =>
  api.post(`/admin/mode-approvals/${approvalId}/reject`, { rejection_reason: rejectionReason }).then(r => r.data);

export const adminRevoke = (approvalId, notes) =>
  api.post(`/admin/mode-approvals/${approvalId}/revoke`, { notes }).then(r => r.data);

export default {
  listMyApprovals,
  getMyApproval,
  requestApproval,
  listPublicPolicies,
  adminListPolicies,
  adminUpdatePolicy,
  adminListPolicyRevisions,
  adminListPolicyCoverage,
  adminRollbackPolicy,
  adminListApprovals,
  adminApprove,
  adminReject,
  adminRevoke,
};
