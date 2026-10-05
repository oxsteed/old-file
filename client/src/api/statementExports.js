import api from './axios';

const root = '/statements/exports';
const jobPath = id => `${root}/${encodeURIComponent(String(id))}`;
const data = response => response.data?.data;

export const requestStatementExport = (input, idempotencyKey) => api.post(root, input, {
  headers: { 'Idempotency-Key': idempotencyKey },
}).then(data);
export const getStatementExport = (id, { signal } = {}) => api.get(jobPath(id), { signal }).then(data);
export const cancelStatementExport = id => api.post(`${jobPath(id)}/cancel`).then(data);
export const retryStatementExport = id => api.post(`${jobPath(id)}/retry`).then(data);
export const getStatementExportManifest = (id, { signal } = {}) => api.get(`${jobPath(id)}/manifest`, { signal }).then(data);
export const downloadStatementExportFile = (id, fileId) => api.get(`${jobPath(id)}/files/${encodeURIComponent(fileId)}`, { responseType: 'blob' });
