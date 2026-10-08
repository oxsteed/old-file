import api from './axios';

export const getFeed = (params = {}) => api.get('/media/feed', { params }).then(r => r.data);
export const searchMedia = (params = {}) => api.get('/media/search', { params }).then(r => r.data);
export const searchMediaEntities = (params = {}) => api.get('/media/entities', { params }).then(r => r.data);
export const getPost = (id) => api.get(`/media/posts/${id}`).then(r => r.data);
export const getReplies = (id, sort = 'latest') => api.get(`/media/posts/${id}/replies`, { params: { sort } }).then(r => r.data);
export const getQuotes = (id) => api.get(`/media/posts/${id}/quotes`).then(r => r.data);
export const createPost = (data) => api.post('/media/posts', data).then(r => r.data);
export const replacePostLinks = (id, links) => api.put(`/media/posts/${id}/links`, { links }).then(r => r.data);
export const linkAsset = (postId, external_url) => api.post('/media/assets/link', { post_id: postId, external_url }).then(r => r.data);
export const uploadPhoto = (postId, file, onUploadProgress) => {
  const form = new FormData();
  form.append('post_id', postId);
  form.append('file', file);
  return api.post('/media/assets/photo-uploads', form, { onUploadProgress }).then(r => r.data);
};
export const uploadVideo = (postId, file, onUploadProgress) => {
  const form = new FormData();
  form.append('post_id', postId);
  form.append('file', file);
  return api.post('/media/assets/video-uploads', form, { onUploadProgress }).then(r => r.data);
};
export const toggleLike = (id) => api.post(`/media/posts/${id}/like`).then(r => r.data);
export const toggleBookmark = (id) => api.post(`/media/posts/${id}/bookmark`).then(r => r.data);
export const toggleRepost = (id) => api.post(`/media/posts/${id}/repost`).then(r => r.data);
export const recordView = (id) => api.post(`/media/posts/${id}/view`).then(r => r.data);
export const flagPost = (id, data) => api.post(`/media/posts/${id}/flags`, data).then(r => r.data);
export const getCommunities = () => api.get('/media/communities').then(r => r.data);
export const getCommunity = (slug) => api.get(`/media/communities/${encodeURIComponent(slug)}`).then(r => r.data);
export const joinCommunity = (id) => api.post(`/media/communities/${id}/join`).then(r => r.data);
export const leaveCommunity = (id) => api.delete(`/media/communities/${id}/join`).then(r => r.data);
export const getActor = (handle) => api.get(`/media/actors/${handle}`).then(r => r.data);
