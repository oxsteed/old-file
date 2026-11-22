import api from './axios';

// Group 10 Slice G (536-540): maintain confidentiality. Participants,
// confidentiality acknowledgment, document sharing, and the engagement
// record export, for the contractor dashboard (engagements board), the
// client status page (milestone board), the admin session detail page,
// and the consulting portal (participating engagements).
export const confidentialityApi = {
  listContractorParticipants: (sessionId) => api.get(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/participants`,
  ),
  addContractorParticipant: (sessionId, payload) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/participants`,
    payload,
  ),
  removeContractorParticipant: (sessionId, participantId) => api.delete(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}`,
  ),
  getContractorConfidentiality: (sessionId) => api.get(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/confidentiality`,
  ),
  acknowledgeContractorConfidentiality: (sessionId) => api.post(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/confidentiality/acknowledge`,
  ),
  updateContractorDocumentSharing: (sessionId, deliverableId, documentId, payload) => api.patch(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/documents/${encodeURIComponent(documentId)}`,
    payload,
  ),
  exportContractorRecord: (sessionId) => api.get(
    `/consulting/contractor/sessions/${encodeURIComponent(sessionId)}/export`,
    { responseType: 'blob' },
  ),
  listClientParticipants: (sessionId) => api.get(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/participants`,
  ),
  getClientConfidentiality: (sessionId) => api.get(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/confidentiality`,
  ),
  acknowledgeClientConfidentiality: (sessionId) => api.post(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/confidentiality/acknowledge`,
  ),
  updateClientDocumentSharing: (sessionId, deliverableId, documentId, payload) => api.patch(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/documents/${encodeURIComponent(documentId)}`,
    payload,
  ),
  exportClientRecord: (sessionId) => api.get(
    `/consulting/business-launch/sessions/${encodeURIComponent(sessionId)}/export`,
    { responseType: 'blob' },
  ),
  listParticipatingSessions: () => api.get(
    '/consulting/business-launch/sessions/participating',
  ),
  listAdminParticipants: (sessionId) => api.get(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/participants`,
  ),
  getAdminConfidentiality: (sessionId) => api.get(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/confidentiality`,
  ),
  updateAdminDocumentSharing: (sessionId, deliverableId, documentId, payload) => api.patch(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/deliverables/${encodeURIComponent(deliverableId)}/documents/${encodeURIComponent(documentId)}`,
    payload,
  ),
  exportAdminRecord: (sessionId) => api.get(
    `/consulting/admin/sessions/${encodeURIComponent(sessionId)}/export`,
    { responseType: 'blob' },
  ),
};

export function downloadEngagementRecord(blob, sessionId) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `engagement-${sessionId}-record.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
