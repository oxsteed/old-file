import api from './axios';

export async function getDirectProfile(locale) {
  const response = await api.get('/direct/profile', { params: locale ? { lang: locale } : undefined });
  return response.data;
}

export async function getDirectCatalog(locale) {
  const response = await api.get('/direct/catalog', { params: locale ? { lang: locale } : undefined });
  return response.data;
}

export async function uploadDirectAsset(file, { purpose = 'quote', draftId = null, requestId = null } = {}) {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('purpose', purpose);
  if (draftId) formData.append('draftId', draftId);
  if (requestId) formData.append('requestId', requestId);

  const response = await api.post('/direct/uploads', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function submitDirectRequest(payload) {
  const response = await api.post('/direct/requests', payload);
  return response.data;
}

export async function lookupPublicDirectQuote(payload) {
  const response = await api.post('/direct/public/lookup', payload);
  return response.data;
}

export async function sendPublicDirectQuoteCode(payload) {
  const response = await api.post('/direct/public/lookup/send-code', payload);
  return response.data;
}

export async function verifyPublicDirectQuoteCode(payload) {
  const response = await api.post('/direct/public/lookup/verify-code', payload);
  return response.data;
}

export async function getDirectHistory() {
  const response = await api.get('/direct/history');
  return response.data;
}

export async function getDirectAccount() {
  const response = await api.get('/direct/account');
  return response.data;
}

export async function saveDirectLocation(locationId, payload) {
  const response = await api[locationId ? 'patch' : 'post'](
    locationId ? `/direct/account/locations/${locationId}` : '/direct/account/locations',
    payload
  );
  return response.data;
}

export async function deleteDirectLocation(locationId) {
  const response = await api.delete(`/direct/account/locations/${locationId}`);
  return response.data;
}

export async function getDirectRequest(id) {
  const response = await api.get(`/direct/requests/${id}`);
  return response.data;
}

export async function getDirectRequestMessages(id) {
  const response = await api.get(`/direct/requests/${id}/messages`);
  return response.data;
}

export async function sendDirectMessage(id, message) {
  const response = await api.post(`/direct/requests/${id}/messages`, { message });
  return response.data;
}

export async function acceptDirectRequest(id) {
  const response = await api.post(`/direct/requests/${id}/accept`);
  return response.data;
}

export async function rejectDirectRequest(id, reason) {
  const response = await api.post(`/direct/requests/${id}/reject`, { reason });
  return response.data;
}

export async function scheduleDirectRequest(id, payload) {
  const response = await api.post(`/direct/requests/${id}/schedule`, payload);
  return response.data;
}

export async function changeDirectRequest(id, payload) {
  const response = await api.post(`/direct/requests/${id}/change`, payload);
  return response.data;
}

export async function submitDirectProof(id, payload) {
  const response = await api.post(`/direct/requests/${id}/proof`, payload);
  return response.data;
}

export async function confirmDirectProof(id, payload) {
  const response = await api.post(`/direct/requests/${id}/proof-confirm`, payload);
  return response.data;
}

export async function getDirectAdminDashboard() {
  const response = await api.get('/direct/admin/dashboard');
  return response.data;
}

export async function getDirectAdminInbox(params = {}) {
  const response = await api.get('/direct/admin/inbox', { params });
  return response.data;
}

export async function getDirectAdminRequest(id) {
  const response = await api.get(`/direct/admin/requests/${id}`);
  return response.data;
}

export async function updateDirectAdminRequest(id, payload) {
  const response = await api.patch(`/direct/admin/requests/${id}`, payload);
  return response.data;
}

export async function getDirectAdminCustomer(userId) {
  const response = await api.get(`/direct/admin/customers/${userId}`);
  return response.data;
}

export async function getDirectAdminSettings() {
  const response = await api.get('/direct/admin/settings');
  return response.data;
}

export async function getDirectAdminCatalog() {
  const response = await api.get('/direct/admin/catalog');
  return response.data;
}

export async function createDirectAdminCatalogCategory(payload) {
  const response = await api.post('/direct/admin/catalog/categories', payload);
  return response.data;
}

export async function updateDirectAdminCatalogCategory(id, payload) {
  const response = await api.patch(`/direct/admin/catalog/categories/${id}`, payload);
  return response.data;
}

export async function createDirectAdminCatalogService(payload) {
  const response = await api.post('/direct/admin/catalog/services', payload);
  return response.data;
}

export async function updateDirectAdminCatalogService(id, payload) {
  const response = await api.patch(`/direct/admin/catalog/services/${id}`, payload);
  return response.data;
}

export async function createDirectAdminCatalogTool(payload) {
  const response = await api.post('/direct/admin/catalog/tools', payload);
  return response.data;
}

export async function updateDirectAdminCatalogTool(id, payload) {
  const response = await api.patch(`/direct/admin/catalog/tools/${id}`, payload);
  return response.data;
}

export async function archiveDirectAdminCatalogEntity(entity, id) {
  const response = await api.patch(`/direct/admin/catalog/${entity}/${id}/archive`);
  return response.data;
}

export async function previewDirectAdminCatalogAI(prompt) {
  const response = await api.post('/direct/admin/catalog/ai/preview', { prompt });
  return response.data;
}

export async function applyDirectAdminCatalogAI(draft) {
  const response = await api.post('/direct/admin/catalog/ai/apply', { draft });
  return response.data;
}

export async function updateDirectAdminSettings(payload) {
  const response = await api.put('/direct/admin/settings', payload);
  return response.data;
}

export async function getDirectAdminReports() {
  const response = await api.get('/direct/admin/reports');
  return response.data;
}

export async function getDirectAdminTeam() {
  const response = await api.get('/direct/admin/team');
  return response.data;
}

export async function sendDirectAdminTestEmail(payload) {
  const response = await api.post('/direct/admin/email-test', payload);
  return response.data;
}
