// Signup provisioning requests (PR #804 G-4 / G-23 / G-35).
// Server: server/routes/signupProvisioning.js. A decision records who
// decided and when; it grants nothing by itself.
import api from './axios';

export const listMyProvisioningRequests = () =>
  api.get('/me/signup-provisioning-requests').then((r) => r.data);

export const createPartnerApplicationRequest = (note) =>
  api.post('/me/signup-provisioning-requests', {
    kind: 'partner_application',
    ...(note ? { note } : {}),
  }).then((r) => r.data);

export const adminListProvisioningRequests = (params = {}) =>
  api.get('/admin/signup-provisioning-requests', { params }).then((r) => r.data);

export const adminDecideProvisioningRequest = (id, decision, note) =>
  api.post(`/admin/signup-provisioning-requests/${encodeURIComponent(id)}/${decision}`, {
    ...(note ? { note } : {}),
  }).then((r) => r.data);

export default {
  listMyProvisioningRequests,
  createPartnerApplicationRequest,
  adminListProvisioningRequests,
  adminDecideProvisioningRequest,
};
