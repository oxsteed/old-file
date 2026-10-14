'use strict';

/**
 * ADM-026: removing an accepted bid leaves the job with no accepted bid,
 * which makes the job uncancellable (jobCancellationService throws
 * 'No accepted bid found', 409). removeBid must refuse accepted bids:
 * - pre-check 409s on status === 'accepted' with code bid_accepted_remove_blocked
 * - the atomic UPDATE excludes 'accepted' too (TOCTOU: bid accepted mid-flight)
 * - the client no longer offers the button (client-only, covered by review)
 */

const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');

jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => { req.user = { id: 'admin-1' }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
}));

const adminCtrl = require('../controllers/adminController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
  app.post('/admin/bids/:bidId/remove', adminCtrl.removeBid);
  return app;
}
const app = buildApp();

/**
 * @param {string} beforeStatus status returned by the pre-check SELECT
 * @param {object} [opts]
 * @param {boolean} [opts.updateSucceeds] whether the atomic UPDATE returns a row
 * @param {string} [opts.freshStatus] status returned by the post-race re-read
 */
function mockBidFlow(beforeStatus, opts = {}) {
  const updateSucceeds = opts.updateSucceeds ?? !['accepted', 'removed'].includes(beforeStatus);
  const freshStatus = opts.freshStatus ?? beforeStatus;
  mockQuery.mockImplementation(async (text) => {
    const t = String(text || '');
    if (t.includes('information_schema')) return { rows: [{}], rowCount: 1 };
    if (t.includes('FROM bids b JOIN jobs')) {
      return {
        rows: [{ id: 'bid-1', job_id: 'job-1', status: beforeStatus, job_title: 'Test job', helper_id: 'helper-1' }],
        rowCount: 1,
      };
    }
    if (t.includes('SELECT status FROM bids WHERE id')) {
      return { rows: [{ status: freshStatus }], rowCount: 1 };
    }
    if (t.includes("UPDATE bids SET status = 'removed'")) {
      if (updateSucceeds) return { rows: [{ id: 'bid-1', status: 'removed' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function updateCalls() {
  return mockQuery.mock.calls.filter(([text]) =>
    String(text || '').includes("UPDATE bids SET status = 'removed'")
  );
}

beforeEach(() => { resetMocks(); });

test('accepted bid is rejected with 409 and no UPDATE is issued', async () => {
  mockBidFlow('accepted');
  const res = await request(app).post('/admin/bids/bid-1/remove').send({ reason: 'spam' });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('bid_accepted_remove_blocked');
  expect(updateCalls()).toHaveLength(0);
});

test('pending bid removal still succeeds', async () => {
  mockBidFlow('pending');
  const res = await request(app).post('/admin/bids/bid-1/remove').send({ reason: 'spam' });
  expect(res.status).toBe(200);
  expect(updateCalls()).toHaveLength(1);
  // The atomic guard must exclude accepted bids, not just removed ones.
  expect(updateCalls()[0][0]).toContain("NOT IN ('removed', 'accepted')");
});

test('already-removed bid still returns 400', async () => {
  mockBidFlow('removed');
  const res = await request(app).post('/admin/bids/bid-1/remove').send({ reason: 'spam' });
  expect(res.status).toBe(400);
});

test('race: bid accepted between pre-check and UPDATE returns 409, not 500', async () => {
  mockBidFlow('pending', { updateSucceeds: false, freshStatus: 'accepted' });
  const res = await request(app).post('/admin/bids/bid-1/remove').send({ reason: 'spam' });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('bid_accepted_remove_blocked');
});

test('race: bid removed by another admin returns 409 with race code', async () => {
  mockBidFlow('pending', { updateSucceeds: false, freshStatus: 'removed' });
  const res = await request(app).post('/admin/bids/bid-1/remove').send({ reason: 'spam' });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('bid_remove_race');
});

test('missing reason still returns 400 before any status check', async () => {
  mockBidFlow('pending');
  const res = await request(app).post('/admin/bids/bid-1/remove').send({});
  expect(res.status).toBe(400);
});
