/**
 * Static i18n key maps for the campaign draft approval lifecycle.
 *
 * Keys are written out literally (no template-string lookups) so the static
 * i18n gate in `npm run verify:i18n` sees every key. Server responses carry
 * `code` values; the UI maps them to these catalog keys with an English
 * fallback message attached by the server.
 */

export const APPROVAL_STATE_KEYS = {
  draft: 'logistics.campaigns.approval.draft',
  pending_review: 'logistics.campaigns.approval.pendingReview',
  revisions_requested: 'logistics.campaigns.approval.revisionsRequested',
  approved: 'logistics.campaigns.approval.approved',
  rejected: 'logistics.campaigns.approval.rejected',
};

export const APPROVAL_DECISION_KEYS = {
  submitted_for_review: 'logistics.campaigns.approval.decision_submitted_for_review',
  approved: 'logistics.campaigns.approval.decision_approved',
  revisions_requested: 'logistics.campaigns.approval.decision_revisions_requested',
  rejected: 'logistics.campaigns.approval.decision_rejected',
  withdrawn: 'logistics.campaigns.approval.decision_withdrawn',
};

export const APPROVAL_BLOCKER_KEYS = {
  missing_title: 'logistics.campaigns.approval.blocker_missing_title',
  missing_description: 'logistics.campaigns.approval.blocker_missing_description',
  missing_lane: 'logistics.campaigns.approval.blocker_missing_lane',
  missing_moq: 'logistics.campaigns.approval.blocker_missing_moq',
  missing_close_date: 'logistics.campaigns.approval.blocker_missing_close_date',
  close_date_past: 'logistics.campaigns.approval.blocker_close_date_past',
  missing_pricing: 'logistics.campaigns.approval.blocker_missing_pricing',
  business_verification_required: 'logistics.campaigns.approval.blocker_business_verification_required',
  lane_access_blocked: 'logistics.campaigns.approval.blocker_lane_access_blocked',
};

export const APPROVAL_STATE_FALLBACK = {
  draft: 'Draft',
  pending_review: 'Pending review',
  revisions_requested: 'Revisions requested',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const REVIEW_OPS_LOGISTICS_ROLES = ['sourcing_operator', 'logistics_coordinator'];
