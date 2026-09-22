'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(),
  getSignedDownloadUrl: jest.fn(),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const disputeController = require('../controllers/disputeController');
const { getSignedDownloadUrl } = require('../utils/storage');

const USER_ID = '00000000-0000-4000-8000-000000000123';
const DISPUTE_ID = '41';
const REQUEST_ID = '00000000-0000-4000-8000-000000000789';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: USER_ID, role: 'customer' };
    next();
  });
  app.get('/api/disputes/:disputeId', disputeController.getDispute);
  app.post('/api/disputes/:disputeId/evidence', disputeController.submitEvidence);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  getSignedDownloadUrl.mockResolvedValue('https://cdn.example/evidence.pdf');
});

describe('dispute evidence and detail contracts', () => {
  test('returns evidence and messages expected by the dispute detail page', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID, opened_by: USER_ID, status: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'evidence-1', file_url: 'private://disputes/41/file.pdf', type: 'document' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'message-1', message: 'We are reviewing this.', is_admin_only: false }] });

    const res = await request(buildApp()).get(`/api/disputes/${DISPUTE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.evidence).toEqual([
      expect.objectContaining({ id: 'evidence-1', file_url: 'https://cdn.example/evidence.pdf' }),
    ]);
    expect(res.body.messages).toEqual([
      expect.objectContaining({ id: 'message-1', message: 'We are reviewing this.' }),
    ]);
    expect(getSignedDownloadUrl).toHaveBeenCalledWith('disputes/41/file.pdf', 900);
  });

  test('persists multipart-compatible content and replays it without a duplicate row', async () => {
    const evidence = {
      id: 'evidence-2',
      dispute_id: DISPUTE_ID,
      submitted_by: USER_ID,
      type: 'text',
      content: 'The helper left before completing the agreed work.',
      client_request_id: REQUEST_ID,
      submission_part: 'text',
    };

    mockQuery
      // First submission: authorization, preflight replay check, lock, replay check, insert.
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID, opened_by: USER_ID, status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [evidence] })
      // Retry: authorization and preflight recovery.
      .mockResolvedValueOnce({ rows: [{ id: DISPUTE_ID, opened_by: USER_ID, status: 'open' }] })
      .mockResolvedValueOnce({ rows: [evidence] });

    const app = buildApp();
    const first = await request(app)
      .post(`/api/disputes/${DISPUTE_ID}/evidence`)
      .set('Idempotency-Key', REQUEST_ID)
      .send({ content: evidence.content });
    const second = await request(app)
      .post(`/api/disputes/${DISPUTE_ID}/evidence`)
      .set('Idempotency-Key', REQUEST_ID)
      .send({ content: evidence.content });

    expect(first.status).toBe(201);
    expect(first.body).toEqual(expect.objectContaining({ idempotent: false }));
    expect(second.status).toBe(200);
    expect(second.body).toEqual(expect.objectContaining({ idempotent: true }));
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO dispute_evidence/.test(sql))).toHaveLength(1);
    expect(mockQuery.mock.calls.find(([sql]) => /INSERT INTO dispute_evidence/.test(sql))[1]).toContain(REQUEST_ID);
  });
});
