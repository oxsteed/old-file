'use strict';

// Domain 7 #12 (repro-first): the compliance queue pager uses the max of
// three unrelated counts with one shared offset, so paging desyncs the
// three lists. Each list must page independently: per-list offsets in,
// per-list totals out.
const express = require('express');
const request = require('supertest');
const { resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/identityVerificationService', () => ({
  listPendingVerifications: jest.fn(async (_client, { limit, offset }) => [{ page: 'verifications', limit, offset }]),
}));
jest.mock('../services/sanctionsScreeningService', () => ({
  listPendingSanctionHits: jest.fn(async (_client, { limit, offset }) => [{ page: 'sanctions', limit, offset }]),
}));

const complianceCaseService = require('../services/complianceCaseService');
const { listPendingVerifications } = require('../services/identityVerificationService');
const { listPendingSanctionHits } = require('../services/sanctionsScreeningService');

jest.mock('../services/oxsteedCreditAdminService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditAdminService');
  return { ...actual };
});
const oxsteedCreditCtrl = require('../controllers/oxsteedCreditController');

function fakeClient() {
  return {
    query: jest.fn(async (text) => {
      const sql = String(text);
      if (sql.includes('pending_verifications')) {
        return { rows: [{ pending_verifications: 500, pending_sanctions: 300, open_cases: 200 }] };
      }
      return {
        rows: [
          { id: 'c1', case_type: 'review', subject_type: 'customer', subject_id: 'u1', severity: 'high', status: 'open', sla_due_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date().toISOString() },
        ],
      };
    }),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('each list receives its own offset and reports its own total', async () => {
  const client = fakeClient();
  const queue = await complianceCaseService.getComplianceQueue(client, {
    limit: 50,
    verificationsOffset: 100,
    sanctionsOffset: 0,
    casesOffset: 50,
  });

  expect(listPendingVerifications).toHaveBeenCalledWith(client, { limit: 50, offset: 100 });
  expect(listPendingSanctionHits).toHaveBeenCalledWith(client, { limit: 50, offset: 0 });
  // The cases page query must carry the cases offset, not the shared one.
  const caseCall = client.query.mock.calls.find(([sql]) => String(sql).includes('oxsteed_credit_compliance_cases') && String(sql).includes('LIMIT'));
  expect(caseCall[1].slice(-2)).toEqual([50, 50]);
  expect(queue.pagination.verifications).toMatchObject({ limit: 50, offset: 100, total: 500 });
  expect(queue.pagination.sanctions).toMatchObject({ limit: 50, offset: 0, total: 300 });
  expect(queue.pagination.cases).toMatchObject({ limit: 50, offset: 50, total: 200 });
  expect(queue.counts).toMatchObject({ pendingVerifications: 500, pendingSanctions: 300, openCases: 200 });
  expect(queue.cases).toHaveLength(1);
});

test('shared limit/offset still pages every list together when no per-list offsets are given', async () => {
  const client = fakeClient();
  const queue = await complianceCaseService.getComplianceQueue(client, { limit: 50, offset: 50 });
  expect(listPendingVerifications).toHaveBeenCalledWith(client, { limit: 50, offset: 50 });
  expect(listPendingSanctionHits).toHaveBeenCalledWith(client, { limit: 50, offset: 50 });
  const caseCall = client.query.mock.calls.find(([sql]) => String(sql).includes('oxsteed_credit_compliance_cases') && String(sql).includes('LIMIT'));
  expect(caseCall[1].slice(-2)).toEqual([50, 50]);
  expect(queue.pagination.verifications).toMatchObject({ limit: 50, offset: 50, total: 500 });
  expect(queue.pagination.cases).toMatchObject({ limit: 50, offset: 50, total: 200 });
});

test('controller forwards per-list offsets from the query string', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
  app.get('/compliance-queue', oxsteedCreditCtrl.getAdminComplianceQueue);
  app.use(errorHandler);

  // getAdminComplianceQueue uses pool.connect(); point it at the fake client.
  const pool = require('../db');
  const client = fakeClient();
  pool.connect = jest.fn(async () => ({ ...client, query: client.query, release: jest.fn() }));

  const res = await request(app)
    .get('/compliance-queue?limit=50&verificationsOffset=100&sanctionsOffset=0&casesOffset=50');
  expect(res.status).toBe(200);
  expect(listPendingVerifications).toHaveBeenCalledWith(expect.anything(), { limit: 50, offset: 100 });
  expect(listPendingSanctionHits).toHaveBeenCalledWith(expect.anything(), { limit: 50, offset: 0 });
  expect(res.body.pagination.verifications).toMatchObject({ limit: 50, offset: 100, total: 500 });
  expect(res.body.pagination.sanctions).toMatchObject({ limit: 50, offset: 0, total: 300 });
  expect(res.body.pagination.cases).toMatchObject({ limit: 50, offset: 50, total: 200 });
});
