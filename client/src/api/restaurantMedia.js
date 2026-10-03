// client/src/api/restaurantMedia.js
//
// Restaurant Media tab (TikTok-style video feed) API helpers.
// Endpoints: GET /restaurants/:id/media, POST ..., POST .../:mediaId/like,
// DELETE .../:mediaId, POST .../:mediaId/flags.

import api from './axios';

// Extract the machine error code from an axios failure so the UI can map
// it to localized copy. Looks at body.code, body.error.code, and
// body.error (string form), in that order.
export const mediaErrorCode = (err) => {
  const data = err?.response?.data;
  if (!data) return err?.code === 'ERR_NETWORK' ? 'network' : 'unknown';
  if (typeof data.code === 'string' && data.code) return data.code;
  const e = data.error;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e.code === 'string' && e.code) return e.code;
  return 'unknown';
};

export const listRestaurantMedia = (restaurantId, { page = 1, pageSize = 10 } = {}) =>
  api.get(`/restaurants/${restaurantId}/media`, { params: { page, pageSize } }).then((r) => {
    const items = Array.isArray(r.data?.items) ? r.data.items : [];
    const total = Number(r.data?.total ?? 0) || 0;
    const p = Number(r.data?.page ?? page) || 1;
    const ps = Number(r.data?.pageSize ?? pageSize) || pageSize;
    return {
      media: items,
      page: p,
      pageSize: ps,
      hasMore: p * ps < total,
      viewerCanModerate: Boolean(r.data?.viewer_can_moderate),
    };
  });

export const postRestaurantMedia = (restaurantId, { video_url, caption, dish_ids }) =>
  api.post(`/restaurants/${restaurantId}/media`, { video_url, caption, dish_ids }).then((r) => r.data);

export const toggleRestaurantMediaLike = (restaurantId, mediaId) =>
  api.post(`/restaurants/${restaurantId}/media/${mediaId}/like`).then((r) => ({
    liked: Boolean(r.data?.liked),
    like_count: Number(r.data?.like_count ?? 0) || 0,
  }));

export const deleteRestaurantMedia = (restaurantId, mediaId) =>
  api.delete(`/restaurants/${restaurantId}/media/${mediaId}`).then((r) => r.data);

export const flagRestaurantMedia = (restaurantId, mediaId, { reason, note }) =>
  api.post(`/restaurants/${restaurantId}/media/${mediaId}/flags`, { reason, note }).then((r) => r.data);
