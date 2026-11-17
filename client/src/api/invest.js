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

export { newIdempotencyKey };
