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

// Review P3-6-F06: profile photos go through the dedicated server-pinned
// route. The purpose is fixed server-side and the upload replaces the live
// profile photo immediately, so the generic upload surface can stay
// private-only.
export async function uploadProfilePhoto(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post('/upload/profile-photo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data;
}
