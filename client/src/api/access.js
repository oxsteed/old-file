// Progressive account access (docs/progressive-access/SPEC.md) API client.
// Server: server/routes/progressiveAccess.js. Every write carries an
// Idempotency-Key so a double click or retry after a network drop never
// creates a second application or decision.
import api from './axios';
import { assertCurrentAuthEpoch, currentAuthEpoch } from './authSessionEpoch';

const newKey = () => {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};
const withKey = (key) => ({ headers: { 'Idempotency-Key': key || newKey() } });

export const accessAPI = {
  getAccess: async (accountId) => {
    const epoch = currentAuthEpoch();
    const { data } = await api.get('/me/access');
    assertCurrentAuthEpoch(epoch);
    // A cookie can change in another tab before this tab receives its session event.
    if (data?.accountId !== String(accountId)) {
      const error = new Error('Access belongs to a different authentication session.');
      error.code = 'AUTH_SESSION_CHANGED';
      throw error;
    }
    return data;
  },
  listPolicies: () => api.get('/me/access-policies').then((r) => r.data),
  getPolicy: (capability) => api.get(`/me/access-policies/${encodeURIComponent(capability)}`).then((r) => r.data),
  listRequests: (params = {}) => api.get('/me/access-requests', { params }).then((r) => r.data),
  getRequest: (id) => api.get(`/me/access-requests/${encodeURIComponent(id)}`).then((r) => r.data),
  createRequest: (body, key) => api.post('/me/access-requests', body, withKey(key)).then((r) => r.data),
  updateRequest: (id, { expectedVersion, answers }, key) => api
    .patch(`/me/access-requests/${encodeURIComponent(id)}`, { expectedVersion, answers }, withKey(key)).then((r) => r.data),
  transition: (id, action, { expectedVersion, answers } = {}, key) => api
    .post(`/me/access-requests/${encodeURIComponent(id)}/${action}`, { expectedVersion, answers }, withKey(key)).then((r) => r.data),

  // Reviewer (admin) endpoints.
  reviewQueue: (params = {}) => api.get('/admin/access-requests', { params }).then((r) => r.data),
  reviewGet: (id) => api.get(`/admin/access-requests/${encodeURIComponent(id)}`).then((r) => r.data),
  reviewDecide: (id, body, key) => api.post(`/admin/access-requests/${encodeURIComponent(id)}/decision`, body, withKey(key)).then((r) => r.data),
};

export const APPLICANT_ACTIONS = Object.freeze(['submit', 'resubmit', 'withdraw']);

export default accessAPI;
