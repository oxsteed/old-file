import api from './axios';

export async function getBusinessConversations(businessId, params = {}) {
  const response = await api.get(`/businesses/${businessId}/messages`, { params });
  return response.data;
}

export async function getBusinessConversation(businessId, conversationId) {
  const response = await api.get(`/businesses/${businessId}/messages/${conversationId}`);
  return response.data;
}

export async function sendBusinessMessage(businessId, conversationId, body) {
  const response = await api.post(`/businesses/${businessId}/messages/${conversationId}`, body);
  return response.data;
}

export async function archiveBusinessConversation(businessId, conversationId) {
  const response = await api.post(`/businesses/${businessId}/messages/${conversationId}/archive`);
  return response.data;
}

export async function restoreBusinessConversation(businessId, conversationId) {
  const response = await api.post(`/businesses/${businessId}/messages/${conversationId}/restore`);
  return response.data;
}

export async function uploadBusinessMessageAttachment(businessId, conversationId, file) {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post(
    `/businesses/${businessId}/messages/${conversationId}/attachments`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data;
}
