import api from './axios';

export const getFeed = (params = {}) => api.get('/media/feed', { params }).then(r => r.data);
export const searchMedia = (params = {}) => api.get('/media/search', { params }).then(r => r.data);
export const searchMediaEntities = (params = {}) => api.get('/media/entities', { params }).then(r => r.data);
export const getPost = (id) => api.get(`/media/posts/${id}`).then(r => r.data);
export const getDrafts = () => api.get('/media/posts/drafts').then(r => r.data);
export const getDraft = (id) => api.get(`/media/posts/${id}/draft`).then(r => r.data);
export const getBookmarks = () => api.get('/media/posts/bookmarks').then(r => r.data);
export const getReplies = (id, sort = 'latest') => api.get(`/media/posts/${id}/replies`, { params: { sort } }).then(r => r.data);
export const getQuotes = (id) => api.get(`/media/posts/${id}/quotes`).then(r => r.data);
export const createPost = (data) => api.post('/media/posts', data).then(r => r.data);
export const updateDraft = (id, data) => api.patch(`/media/posts/${id}/draft`, data).then(r => r.data);
export const publishPost = (id) => api.post(`/media/posts/${id}/publish`).then(r => r.data);
export const updatePost = (id, data) => api.patch(`/media/posts/${id}`, data).then(r => r.data);
export const deletePost = (id) => api.delete(`/media/posts/${id}`).then(r => r.data);
export const replacePostLinks = (id, links) => api.put(`/media/posts/${id}/links`, { links }).then(r => r.data);
export const linkAsset = (postId, external_url, replace = false) => api.post('/media/assets/link', { post_id: postId, external_url, replace_assets: replace }).then(r => r.data);
export const uploadPhoto = (postId, file, onUploadProgress, replace = false) => {
  const form = new FormData();
  form.append('post_id', postId);
  form.append('replace_assets', String(replace));
  form.append('file', file);
  return api.post('/media/assets/photo-uploads', form, { onUploadProgress }).then(r => r.data);
};
export const uploadVideo = (postId, file, onUploadProgress, replace = false) => {
  const form = new FormData();
  form.append('post_id', postId);
  form.append('replace_assets', String(replace));
  form.append('file', file);
  return api.post('/media/assets/video-uploads', form, { onUploadProgress }).then(r => r.data);
};
export const toggleLike = (id) => api.post(`/media/posts/${id}/like`).then(r => r.data);
export const toggleBookmark = (id) => api.post(`/media/posts/${id}/bookmark`).then(r => r.data);
export const toggleRepost = (id) => api.post(`/media/posts/${id}/repost`).then(r => r.data);
export const recordShare = (id) => api.post(`/media/posts/${id}/share`).then(r => r.data);
export const recordView = (id) => api.post(`/media/posts/${id}/view`).then(r => r.data);
export const flagPost = (id, data) => api.post(`/media/posts/${id}/flags`, data).then(r => r.data);
export const getCommunities = () => api.get('/media/communities').then(r => r.data);
export const getCommunity = (slug) => api.get(`/media/communities/${encodeURIComponent(slug)}`).then(r => r.data);
export const joinCommunity = (id) => api.post(`/media/communities/${id}/join`).then(r => r.data);
export const leaveCommunity = (id) => api.delete(`/media/communities/${id}/join`).then(r => r.data);
export const getActor = (handle) => api.get(`/media/actors/${handle}`).then(r => r.data);
export const toggleFollow = (actorId) => api.post(`/media/actors/${actorId}/follow`).then(r => r.data);
export const getMediaVerification = () => api.get('/media/verification').then(r => r.data);
export const submitMediaVerification = (data) => api.post('/media/verification/requests', data).then(r => r.data);
export const getCreatorGigs = (params = {}) => api.get('/media/creator/gigs', { params }).then(r => r.data);
export const createCreatorGig = (data) => api.post('/media/creator/gigs', data).then(r => r.data);
export const applyToCreatorGig = (gigId, data) => api.post(`/media/creator/gigs/${gigId}/applications`, data).then(r => r.data);
export const getCreatorApplications = (gigId) => api.get(`/media/creator/gigs/${gigId}/applications`).then(r => r.data);
export const getMyCreatorApplications = () => api.get('/media/creator/applications').then(r => r.data);
export const awardCreatorApplication = (applicationId) => api.post(`/media/creator/applications/${applicationId}/award`).then(r => r.data);
export const cancelCreatorGig = (gigId) => api.post(`/media/creator/gigs/${gigId}/cancel`).then(r => r.data);
export const submitCreatorDeliverable = (applicationId, data) => api.post(`/media/creator/applications/${applicationId}/deliverables`, data).then(r => r.data);
export const reviewCreatorDeliverable = (deliverableId, status) => api.patch(`/media/creator/deliverables/${deliverableId}`, { status }).then(r => r.data);
export const createCreatorTip = (data) => {
  const { idempotencyKey, ...payload } = data || {};
  return api.post('/media/creator/tips', payload, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  }).then(r => r.data);
};
export const settleCreatorTip = (tipId) => api.post(`/media/creator/tips/${tipId}/settle`).then(r => r.data);
export const createCreatorSponsorship = (data) => {
  const { idempotencyKey, ...payload } = data || {};
  return api.post('/media/creator/sponsorships', payload, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  }).then(r => r.data);
};
export const getCreatorSponsorships = () => api.get('/media/creator/sponsorships').then(r => r.data);
export const getCreatorPayments = () => api.get('/media/creator/payments').then(r => r.data);
export const acceptCreatorSponsorship = (sponsorshipId) => api.post(`/media/creator/sponsorships/${sponsorshipId}/accept`).then(r => r.data);
export const submitCreatorSponsorshipDeliverable = (sponsorshipId, data) => api.post(`/media/creator/sponsorships/${sponsorshipId}/deliverables`, data).then(r => r.data);
export const settleCreatorSponsorship = (sponsorshipId) => api.post(`/media/creator/sponsorships/${sponsorshipId}/settle`).then(r => r.data);
export const cancelCreatorSponsorship = (sponsorshipId) => api.post(`/media/creator/sponsorships/${sponsorshipId}/cancel`).then(r => r.data);
export const createCreatorBoost = (postId, data) => {
  const { idempotencyKey, ...payload } = data || {};
  return api.post(`/media/posts/${postId}/boosts`, payload, {
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  }).then(r => r.data);
};
export const settleCreatorBoost = (boostId) => api.post(`/media/creator/boosts/${boostId}/settle`).then(r => r.data);
export const cancelCreatorBoost = (boostId) => api.post(`/media/creator/boosts/${boostId}/cancel`).then(r => r.data);
export const openCreatorDispute = (kind, id, data, idempotencyKey) => api.post(`/media/creator/disputes/${kind}/${id}`, data, { headers: { 'Idempotency-Key': idempotencyKey } }).then(r => r.data);
export const getMediaCreatorDisputes = (params = {}) => api.get('/admin/media/creator-disputes', { params }).then(r => r.data);
export const reviewMediaCreatorDispute = (disputeId, reason) => api.post(`/admin/media/creator-disputes/${disputeId}/review`, { reason }).then(r => r.data);
export const resolveMediaCreatorDispute = (disputeId, data) => api.post(`/admin/media/creator-disputes/${disputeId}/resolve`, data).then(r => r.data);
