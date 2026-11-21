import api from './axios';

// Group 10 Slice F (531-535): handle changes. Change requests (scope
// revision, deadline adjustment, additional fee) with approval and
// history, plus engagement pause/resume, for the contractor dashboard
// (engagements board) and the client status page (milestone board).
export const changesApi = {
  listContractorChangeRequests: (sessionId) => api.get(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/change-requests`,
  ),
  createContractorChangeRequest: (sessionId, payload) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/change-requests`,
    payload,
  ),
  approveContractorChangeRequest: (sessionId, requestId, decisionReason) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(requestId)}/approve`,
    decisionReason ? { decision_reason: decisionReason } : {},
  ),
  rejectContractorChangeRequest: (sessionId, requestId, decisionReason) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(requestId)}/reject`,
    { decision_reason: decisionReason },
  ),
  withdrawContractorChangeRequest: (sessionId, requestId) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(requestId)}/withdraw`,
  ),
  getContractorHistory: (sessionId) => api.get(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/history`,
  ),
  pauseContractorEngagement: (sessionId, reason) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/pause`,
    { reason },
  ),
  resumeContractorEngagement: (sessionId) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/resume`,
  ),
  listClientChangeRequests: (sessionId) => api.get(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/change-requests`,
  ),
  createClientChangeRequest: (sessionId, payload) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/change-requests`,
    payload,
  ),
  approveClientChangeRequest: (sessionId, requestId, decisionReason) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(requestId)}/approve`,
    decisionReason ? { decision_reason: decisionReason } : {},
  ),
  rejectClientChangeRequest: (sessionId, requestId, decisionReason) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(requestId)}/reject`,
    { decision_reason: decisionReason },
  ),
  withdrawClientChangeRequest: (sessionId, requestId) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(requestId)}/withdraw`,
  ),
  getClientHistory: (sessionId) => api.get(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/history`,
  ),
  pauseClientEngagement: (sessionId, reason) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/pause`,
    { reason },
  ),
  resumeClientEngagement: (sessionId) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/resume`,
  ),
};
