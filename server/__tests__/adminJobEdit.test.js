'use strict';

require('./setup');

jest.mock('../services/jobEditService', () => ({
  applyJobEdit: jest.fn(),
  listJobRevisions: jest.fn(),
  rollbackJobRevision: jest.fn(),
}));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));

const express = require('express');
const request = require('supertest');
const svc = require('../services/jobEditService');
const { logAdminAction } = require('../services/auditService');
const ctrl = require('../controllers/adminJobEditController');
const { errorHandler } = require('../middleware/errorHandler');

const JOB_ID = '33333333-3333-4333-8333-333333333333';
function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); });
  a.patch('/admin/jobs/:jobId', ctrl.editJob);
  a.get('/admin/jobs/:jobId/revisions', ctrl.listRevisions);
  a.post('/admin/jobs/:jobId/revisions/:revisionId/rollback', ctrl.rollbackRevision);
  a.use(errorHandler);
  return a;
}
const result = { job: { id: JOB_ID, version: 8, location_lat: 1, status: 'accepted' }, changes: { notes: { from: 'a', to: 'b' } }, material: false, bidsFlagged: 0 };

beforeEach(() => jest.clearAllMocks());

test('admin edit requires a precondition', async () => {
  const res = await request(app()).patch(`/admin/jobs/${JOB_ID}`).send({ notes: 'b', reason: 'Customer asked by phone' });
  expect(res.status).toBe(428);
  expect(svc.applyJobEdit).not.toHaveBeenCalled();
});

test('admin edit passes source=admin and reason, audits, and strips coordinates', async () => {
  svc.applyJobEdit.mockResolvedValue(result);
  const res = await request(app()).patch(`/admin/jobs/${JOB_ID}`)
    .set('If-Match', `W/"job-${JOB_ID}-v7"`).send({ notes: 'b', reason: 'Customer asked by phone' });
  expect(res.status).toBe(200);
  expect(res.headers.etag).toBe(`W/"job-${JOB_ID}-v8"`);
  expect(svc.applyJobEdit).toHaveBeenCalledWith(expect.objectContaining({
    source: 'admin', reason: 'Customer asked by phone', expectedVersion: 7, input: { notes: 'b' },
  }));
  expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'job_edit', before: { notes: 'a' }, after: { notes: 'b' } }));
  expect(res.body.job.location_lat).toBeUndefined();
});

test('audit-log failure does not fail a committed edit', async () => {
  svc.applyJobEdit.mockResolvedValue(result);
  logAdminAction.mockRejectedValueOnce(new Error('db down'));
  const res = await request(app()).patch(`/admin/jobs/${JOB_ID}`)
    .set('If-Match', `W/"job-${JOB_ID}-v7"`).send({ notes: 'b', reason: 'Customer asked by phone' });
  expect(res.status).toBe(200);
});

test('rollback forwards revision id and surfaces service errors with the current ETag', async () => {
  const { JobEditError } = jest.requireActual('../services/jobEditService');
  const err = new JobEditError('stale', 412, 'precondition_failed');
  err.etag = `W/"job-${JOB_ID}-v9"`;
  svc.rollbackJobRevision.mockRejectedValue(err);
  const res = await request(app()).post(`/admin/jobs/${JOB_ID}/revisions/12/rollback`)
    .set('If-Match', `W/"job-${JOB_ID}-v8"`).send({ reason: 'Undo bad edit' });
  expect(res.status).toBe(412);
  expect(res.headers.etag).toBe(`W/"job-${JOB_ID}-v9"`);
  expect(svc.rollbackJobRevision).toHaveBeenCalledWith(expect.objectContaining({ revisionId: '12', expectedVersion: 8 }));
});

test('revision listing forwards paging', async () => {
  svc.listJobRevisions.mockResolvedValue({ revisions: [{ id: '3' }], next_before: '3' });
  const res = await request(app()).get(`/admin/jobs/${JOB_ID}/revisions?limit=10&before=20`);
  expect(res.body).toEqual({ revisions: [{ id: '3' }], next_before: '3' });
  expect(svc.listJobRevisions).toHaveBeenCalledWith(expect.objectContaining({ limit: '10', before: '20' }));
});
