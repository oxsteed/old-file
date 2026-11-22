import api from './axios';

// Group 10 Slice I (546-550): operate the practice. The inquiry
// pipeline report, availability utilization, outstanding deliverables
// view, permitted earnings report, and practice support intake for the
// contractor dashboard.
export const practiceApi = {
  getInquiryPipeline: () => api.get(
    '/consulting/contractor/practice/inquiry-pipeline',
  ),
  getUtilization: (params = {}) => api.get(
    '/consulting/contractor/practice/utilization',
    { params },
  ),
  getOutstandingDeliverables: () => api.get(
    '/consulting/contractor/practice/deliverables/outstanding',
  ),
  getEarnings: () => api.get(
    '/consulting/contractor/practice/earnings',
  ),
  listSupportIntakes: () => api.get(
    '/consulting/contractor/practice/support',
  ),
  createSupportIntake: (payload) => api.post(
    '/consulting/contractor/practice/support',
    payload,
  ),
};
