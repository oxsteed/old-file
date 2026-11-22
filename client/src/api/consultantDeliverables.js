import api from './axios';

// Group 10 Slice E (526-530): deliver work. Milestone board calls for the
// contractor dashboard (engagements + deliverable moves + draft delivery
// + documents) and the client status page (engagement session + accept +
// feedback + documents). Document upload is multipart, like the
// business-launch attachments.
export const deliverablesApi = {
  startEngagement: (requestId) => api.post(`/consulting/contractor/referrals/${encodeURIComponent(requestId)}/start-engagement`),
  listMyEngagements: (params = {}) => api.get('/consulting/contractor/engagements', { params }),
  listContractorDeliverables: (sessionId) => api.get(`/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/deliverables`),
  updateDeliverableStatus: (sessionId, deliverableId, status) => api.patch(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/status`,
    { status },
  ),
  deliverDraft: (sessionId, deliverableId, draftNote) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/deliver-draft`,
    { draft_note: draftNote },
  ),
  attachContractorDocument: (sessionId, deliverableId, form) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/documents`,
    form,
  ),
  listContractorDocuments: (sessionId, deliverableId) => api.get(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/documents`,
  ),
  downloadContractorDocument: (documentId) => api.get(
    `/consulting/contractor/documents/${encodeURIComponent(documentId)}/download`,
  ),
  getEngagementSession: (requestId) => api.get(
    `/consulting/business-launch/requests/${encodeURIComponent(requestId)}/session`,
  ),
  listClientDeliverables: (sessionId) => api.get(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/deliverables`,
  ),
  attachClientDocument: (sessionId, deliverableId, form) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/documents`,
    form,
  ),
  downloadClientDocument: (documentId) => api.get(
    `/consulting/business-launch/documents/${encodeURIComponent(documentId)}/download`,
  ),
  acceptDeliverable: (sessionId, deliverableId) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/accept`,
  ),
  submitFeedback: (sessionId, payload) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/feedback`,
    payload,
  ),
};
