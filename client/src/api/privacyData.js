// Customer 360 upgrade 11: the signed-in customer's "your data" summary and
// the verified self-serve export (password, then an emailed code).
import api from './axios';

export const privacyDataAPI = {
  yourData: () => api.get('/privacy/your-data'),
  requestExportCode: (password) => api.post('/privacy/export/verification/request', { password }),
  verifyExportCode: (challengeToken, code) => api.post('/privacy/export/verification/verify', { challengeToken, code }),
  downloadExport: (exportToken) => api.get('/privacy/export', { responseType: 'blob', headers: { 'X-Export-Verification-Token': exportToken } }),
};

export default privacyDataAPI;
