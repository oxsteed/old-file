// OxSteed Invest API client (routes under /api/invest; see
// docs/oxsteed-invest/api.md). No route is invented here: every call maps
// to a documented route, and every write that requires one sends an
// Idempotency-Key.
import api from './axios';

const newIdempotencyKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

const idemHeaders = (key) => ({ headers: { 'Idempotency-Key': key || newIdempotencyKey() } });

export async function listOpportunities(sort = 'publication_date') {
  const { data } = await api.get('/invest/opportunities', { params: { sort } });
  return data;
}

export async function getOpportunity(id) {
  const { data } = await api.get(`/invest/opportunities/${id}`);
  return data;
}

export async function listQuestions(opportunityId) {
  const { data } = await api.get(`/invest/opportunities/${opportunityId}/questions`);
  return data;
}

export async function askQuestion(opportunityId, question) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/questions`, { question });
  return data;
}

export async function listDocuments(opportunityId) {
  const { data } = await api.get(`/invest/opportunities/${opportunityId}/documents`);
  return data;
}

export async function listAgreementVersions(opportunityId) {
  const { data } = await api.get(`/invest/opportunities/${opportunityId}/agreement-versions`);
  return data;
}

export async function listApplications() {
  const { data } = await api.get('/invest/applications');
  return data;
}

export async function createApplication(opportunityId, agreementVersionId) {
  const body = { opportunityId };
  if (agreementVersionId) body.agreementVersionId = agreementVersionId;
  const { data } = await api.post('/invest/applications', body, idemHeaders());
  return data;
}

export async function updateApplication(id, eligibility) {
  const { data } = await api.patch(`/invest/applications/${id}`, { eligibility });
  return data;
}

export async function submitApplication(id) {
  const { data } = await api.post(`/invest/applications/${id}/submit`, {});
  return data;
}

export async function withdrawApplication(id) {
  const { data } = await api.post(`/invest/applications/${id}/withdraw`, {});
  return data;
}

export async function acceptAgreement(id) {
  const { data } = await api.post(`/invest/applications/${id}/accept-agreement`, {});
  return data;
}

export async function createCommitment(opportunityId, { applicationId, amountCents, agreementVersionId, idempotencyKey }) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/commitments`, {
    applicationId,
    amountCents,
    agreementVersionId,
    riskAcknowledged: true,
  }, idemHeaders(idempotencyKey));
  return data;
}

export async function cancelCommitment(id) {
  const { data } = await api.post(`/invest/commitments/${id}/cancel`, {});
  return data;
}

export async function getMyInvestments() {
  const { data } = await api.get('/invest/me');
  return data;
}

export async function createSupportRequest({ opportunityId, commitmentId, category, subject, details }) {
  const body = { category, subject, details };
  if (opportunityId) body.opportunityId = opportunityId;
  if (commitmentId) body.commitmentId = commitmentId;
  const { data } = await api.post('/invest/support-requests', body, idemHeaders());
  return data;
}

export async function listSupportRequests() {
  const { data } = await api.get('/invest/support-requests');
  return data;
}

export async function reconfirmAmendment(opportunityId, amendmentId) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/amendments/${amendmentId}/reconfirm`, {});
  return data;
}

// ── Entity fundraising (Track 4) ─────────────────────────────────────────
// Every call maps to a documented /api/invest route. A draft is private:
// creating one never publishes, and submitting it only sends it for review.

export async function listMyOpportunities(sort = 'publication_date') {
  const { data } = await api.get('/invest/opportunities', { params: { scope: 'mine', sort } });
  return data;
}

export async function createOpportunity({ businessId, title, purpose, targetCents, minimumCents, deadlineAt, valuationRule, useOfProceeds, intermediaryRef, details }) {
  const { data } = await api.post('/invest/opportunities', {
    businessId, title, purpose, targetCents, minimumCents, deadlineAt,
    valuationRule, useOfProceeds, intermediaryRef, details,
  });
  return data;
}

export async function updateOpportunity(id, { title, purpose, targetCents, minimumCents, deadlineAt, valuationRule, useOfProceeds, intermediaryRef, details, expectedVersion }) {
  const { data } = await api.put(`/invest/opportunities/${id}`, {
    title, purpose, targetCents, minimumCents, deadlineAt,
    valuationRule, useOfProceeds, intermediaryRef, details, expectedVersion,
  });
  return data;
}

export async function getOpportunityPreview(id) {
  const { data } = await api.get(`/invest/opportunities/${id}/preview`);
  return data;
}

export async function submitOpportunityForReview(id) {
  const { data } = await api.post(`/invest/opportunities/${id}/submit-for-review`, {});
  return data;
}

export async function createAgreementVersion(opportunityId, body) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/agreement-versions`, { body });
  return data;
}

export async function answerQuestion(opportunityId, questionId, answer) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/questions/${questionId}/answer`, { answer });
  return data;
}

export async function listUpdates(opportunityId) {
  const { data } = await api.get(`/invest/opportunities/${opportunityId}/updates`);
  return data;
}

export async function createUpdate(opportunityId, { title, body, dueAt }) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/updates`, { title, body, dueAt });
  return data;
}

export async function publishUpdate(opportunityId, updateId) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/updates/${updateId}/publish`, {});
  return data;
}

export async function listAmendments(opportunityId) {
  const { data } = await api.get(`/invest/opportunities/${opportunityId}/amendments`);
  return data;
}

export async function createAmendment(opportunityId, { changes, newAgreementVersionId }) {
  const body = { changes };
  if (newAgreementVersionId) body.newAgreementVersionId = newAgreementVersionId;
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/amendments`, body);
  return data;
}

export async function proposeAmendment(opportunityId, amendmentId, reconfirmationDeadlineAt) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/amendments/${amendmentId}/propose`, { reconfirmationDeadlineAt });
  return data;
}

export async function reviewAmendment(amendmentId, decision, { note, expectedVersion } = {}) {
  const { data } = await api.post(`/invest/amendments/${amendmentId}/${decision === 'effective' ? 'effective' : 'reject'}`, { note, expectedVersion });
  return data;
}

export async function failCloseOpportunity(opportunityId, reason) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/fail-close`, { reason });
  return data;
}

export async function recordPartnerEscrowConfirmation(commitmentId, { partnerRef, note }) {
  const { data } = await api.post(`/invest/commitments/${commitmentId}/escrow-confirmation`, { partnerRef, note });
  return data;
}

// ── Reviewer queue, closing, proceeds, distributions (Track 4) ───────────
// The server scopes the queue per review permission and refuses
// self-approval and stale versions; this client only sends the version
// it rendered and surfaces the server's 403/409.

export async function getReviewQueue(type) {
  const { data } = await api.get('/invest/review-queue', { params: type ? { type } : {} });
  return data;
}

export async function reviewApplication(id, { decision, identityVerified, authorityVerified, reviewNote, expectedVersion }) {
  const { data } = await api.post(`/invest/applications/${id}/review`, {
    decision, identityVerified, authorityVerified, reviewNote, expectedVersion,
  });
  return data;
}

export async function reviewOpportunity(id, { action, note, verificationSummary, expectedVersion }) {
  const { data } = await api.post(`/invest/opportunities/${id}/review`, {
    action, note, verificationSummary, expectedVersion,
  });
  return data;
}

export async function publishOpportunity(id, expectedVersion) {
  const { data } = await api.post(`/invest/opportunities/${id}/publish`, { expectedVersion });
  return data;
}

export async function approveClosingConditions(id) {
  const { data } = await api.post(`/invest/opportunities/${id}/closing-conditions/approve`, {});
  return data;
}

export async function recordClosingApproval(id, { stage, decision, note }) {
  const { data } = await api.post(`/invest/opportunities/${id}/closing-approvals`, { stage, decision, note });
  return data;
}

export async function closeOpportunity(id) {
  const { data } = await api.post(`/invest/opportunities/${id}/close`, {});
  return data;
}

export async function releaseProceeds(id) {
  const { data } = await api.post(`/invest/opportunities/${id}/release-proceeds`, {});
  return data;
}

export async function recordDistribution(opportunityId, { positionId, userId, amountCents }) {
  const { data } = await api.post(`/invest/opportunities/${opportunityId}/distributions`, {
    positionId, userId, amountCents,
  }, idemHeaders());
  return data;
}

export { newIdempotencyKey };
