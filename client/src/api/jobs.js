import api from './axios';

// G1-B8: customer-initiated refund requests on a job the caller owns.
// The request always queues for platform-admin approval in the Money
// Approvals flow; the requester can never execute the refund.
export const requestCustomerJobRefund = (jobId, payload) =>
  api.post(`/jobs/${jobId}/refund-request`, payload, {
    headers: { 'Idempotency-Key': payload?.idempotencyKey || `customer-job-refund-${jobId}-${Date.now()}` },
  }).then(r => r.data);
export const listCustomerJobRefundRequests = (jobId) =>
  api.get(`/jobs/${jobId}/refund-requests`).then(r => r.data?.requests || []);
