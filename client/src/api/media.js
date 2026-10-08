import axios from 'axios';

const api = axios.create({ baseURL: '/api/media' });

export const getFeed = (params = {}) => api.get('/feed', { params }).then(r => r.data);
export const searchMedia = (params = {}) => api.get('/search', { params }).then(r => r.data);
export const searchMediaEntities = (params = {}) => api.get('/entities', { params }).then(r => r.data);
export const getPost = (id) => api.get(`/posts/${id}`).then(r => r.data);
export const getReplies = (id, sort = 'latest') => api.get(`/posts/${id}/replies`, { params: { sort } }).then(r => r.data);
export const getQuotes = (id) => api.get(`/posts/${id}/quotes`).then(r => r.data);
export const createPost = (data) => api.post('/posts', data).then(r => r.data);
export const replacePostLinks = (id, links) => api.put(`/posts/${id}/links`, { links }).then(r => r.data);
export const linkAsset = (postId, external_url) => api.post('/assets/link', { post_id: postId, external_url }).then(r => r.data);
export const uploadPhoto = (postId, file, onUploadProgress) => {
  const form = new FormData();
  form.append('post_id', postId);
  form.append('file', file);
  return api.post('/assets/photo-uploads', form, { onUploadProgress }).then(r => r.data);
};
export const uploadVideo = (postId, file, onUploadProgress) => {
  const form = new FormData();
  form.append('post_id', postId);
  form.append('file', file);
  return api.post('/assets/video-uploads', form, { onUploadProgress }).then(r => r.data);
};
export const toggleLike = (id) => api.post(`/posts/${id}/like`).then(r => r.data);
export const toggleBookmark = (id) => api.post(`/posts/${id}/bookmark`).then(r => r.data);
export const toggleRepost = (id) => api.post(`/posts/${id}/repost`).then(r => r.data);
export const recordView = (id) => api.post(`/posts/${id}/view`).then(r => r.data);
export const flagPost = (id, data) => api.post(`/posts/${id}/flags`, data).then(r => r.data);
export const getCommunities = () => api.get('/communities').then(r => r.data);
export const getCommunity = (slug) => api.get(`/communities/${encodeURIComponent(slug)}`).then(r => r.data);
export const joinCommunity = (id) => api.post(`/communities/${id}/join`).then(r => r.data);
export const leaveCommunity = (id) => api.delete(`/communities/${id}/join`).then(r => r.data);
export const getActor = (handle) => api.get(`/actors/${handle}`).then(r => r.data);
