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

// Bulk export: one background job per item, polled with the same helpers as
// single exports, then zipped server-side into one package.
export const requestBulkStatementExport = (items, idempotencyKey) => api.post(`${root}/bulk`, { items }, {
  headers: { 'Idempotency-Key': idempotencyKey },
}).then(data);
export const downloadBulkStatementPackage = jobIds => api.post(`${root}/bulk/package`, { jobIds }, { responseType: 'blob' });

// Export history: the caller's previous export jobs from the existing
// statement_export_jobs records.
export const listStatementExports = ({ page = 1, pageSize = 20 } = {}) => api.get(root, { params: { page, pageSize } }).then(data);

// Accounting download (OFX/QFX/QBO): synchronous, returns the file bytes.
export const downloadAccountingExport = input => api.post(`${root}/accounting`, input, { responseType: 'blob' });

// Private per-user notes on statement entries.
const notesRoot = `${root}/notes`;
export const listStatementNotes = (params = {}) => api.get(notesRoot, { params }).then(data);
export const saveStatementNote = payload => api.post(notesRoot, payload).then(data);
export const deleteStatementNote = id => api.delete(`${notesRoot}/${encodeURIComponent(String(id))}`).then(data);
export const statementNoteAttachmentUrl = id => `/api${notesRoot}/${encodeURIComponent(String(id))}/attachment`;
