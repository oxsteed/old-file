import api from './axios';

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
