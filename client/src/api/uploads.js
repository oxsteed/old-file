import api from './axios';

export async function uploadAppAsset(file, purpose = 'general') {
  const formData = new FormData();
  formData.append('file', file);
  if (purpose) {
    formData.append('purpose', purpose);
  }

  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data;
}
