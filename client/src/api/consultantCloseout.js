import api from './axios';

// Group 10 Slice H (541-545): close the engagement. The final
// deliverable checklist, closeout confirmation, follow-up schedule,
// client feedback request, and archive, for the contractor dashboard
// (engagements board), the client status page (milestone board), and
// the admin session detail page.
export const closeoutApi = {
  getContractorCloseout: (sessionId) => api.get(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/closeout`,
  ),
  confirmContractorCloseout: (sessionId, payload = {}) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/closeout/confirm`,
    payload,
  ),
  createContractorFollowUp: (sessionId, payload) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/follow-ups`,
    payload,
  ),
  updateContractorFollowUp: (sessionId, followUpId, payload) => api.patch(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/follow-ups/${encodeURIComponent(followUpId)}`,
    payload,
  ),
  listContractorFollowUps: (params = {}) => api.get(
    '/consulting/contractor/follow-ups',
    { params },
  ),
  requestContractorFeedback: (sessionId, payload = {}) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/feedback-request`,
    payload,
  ),
  archiveContractorEngagement: (sessionId) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/archive`,
  ),
  unarchiveContractorEngagement: (sessionId) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/unarchive`,
  ),
  getClientCloseout: (sessionId) => api.get(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/closeout`,
  ),
  confirmClientCloseout: (sessionId, payload = {}) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/closeout/confirm`,
    payload,
  ),
  getAdminCloseout: (sessionId) => api.get(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/closeout`,
  ),
  confirmAdminCloseout: (sessionId, payload = {}) => api.post(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/closeout/confirm`,
    payload,
  ),
  archiveAdminEngagement: (sessionId) => api.post(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/archive`,
  ),
  unarchiveAdminEngagement: (sessionId) => api.post(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/unarchive`,
  ),
};
