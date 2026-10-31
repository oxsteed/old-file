'use strict';

/**
 * auditQ2QueuePagination.test.js — Audit queue Q2, queue pagination group.
 *
 * Original defects (Oct 2 audit): paginated server results were not fully
 * reachable from the report, support, and compliance screens. Operators saw
 * a total exceeding the reachable rows: the report list rendered only the
 * first page (T05-F01), the support inbox sent no pagination state
 * (T10-F02), and the compliance composite endpoint passed offset zero even
 * when another offset was requested and returned page lengths as counts
 * (T38-F02).
 *
 * The fixes: each queue honors the requested page/offset and returns the
 * full filtered total. Each test below requests a page beyond the first and
 * asserts the request actually reaches that page and the total is the full
 * queue count, not the page length.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../utils/scopeFilter', () => ({
  resolveScope: () => ({ type: 'global' }),
  userLocationScopeClause: () => ({ clause: '1=1', values: [], nextParam: 1 }),
}));
jest.mock('../services/supportTicketLifecycleService', () => ({}));
jest.mock('../services/supportNotificationService', () => ({}));
jest.mock('../utils/supportTicketEmail', () => ({}));
jest.mock('../middleware/regionAuth', () => ({ userMatchesAnyRegion: jest.fn(() => true) }));

const adminController = require('../controllers/adminController');
const supportController = require('../controllers/supportController');
const complianceCaseService = require('../services/complianceCaseService');

jest.mock('../services/identityVerificationService', () => ({
  listPendingVerifications: jest.fn(async (_client, { limit, offset }) => [{ page: 'verifications', limit, offset }]),
}));
jest.mock('../services/sanctionsScreeningService', () => ({
  listPendingSanctionHits: jest.fn(async (_client, { limit, offset }) => [{ page: 'sanctions', limit, offset }]),
}));

const {
  listPendingVerifications,
  listPendingSanctionHits,
} = require('../services/identityVerificationService');
const { listPendingSanctionHits: listSanctions } = require('../services/sanctionsScreeningService');

function createApp(handler, path) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '22222222-2222-4222-8222-222222222222', role: 'admin' };
    next();
  });
  app.get(path, handler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('T05-F01 report queue pagination', () => {
  test('page 2 of the report queue reaches offset 25 and reports the full total', async () => {
    mockQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('information_schema')) return { rows: [{ '1': 1 }] };
      if (sql.includes('LEFT JOIN users u_reporter')) {
        expect(params).toEqual(['pending', 25, 25]);
        return { rows: Array.from({ length: 25 }, (_, i) => ({ id: 26 + i })) };
      }
      if (sql.includes('SELECT COUNT(*) FROM content_reports')) return { rows: [{ count: '500' }] };
      return { rows: [] };
    });

    const res = await request(createApp(adminController.getReports, '/reports'))
      .get('/reports?status=pending&page=2&limit=25');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(500);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(25);
    expect(res.body.reports).toHaveLength(25);
    expect(res.body.reports[0].id).toBe(26);
  });
});

describe('T10-F02 support inbox pagination', () => {
  test('offset 50 reaches the second page and the total is the full filtered count', async () => {
    mockQuery.mockImplementation(async (text, params) => {
      const sql = String(text);
      if (sql.includes('FROM support_tickets t') && sql.includes('LIMIT')) {
        expect(params.slice(-2)).toEqual([50, 50]);
        return { rows: Array.from({ length: 50 }, (_, i) => ({ id: 51 + i, ticket_number: `T-${51 + i}` })) };
      }
      if (sql.includes('SELECT COUNT(*) AS total')) return { rows: [{ total: '300' }] };
      return { rows: [] };
    });

    const res = await request(createApp(supportController.listTickets, '/tickets'))
      .get('/tickets?limit=50&offset=50');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(300);
    expect(res.body.limit).toBe(50);
    expect(res.body.offset).toBe(50);
    expect(res.body.tickets).toHaveLength(50);
    expect(res.body.tickets[0].id).toBe(51);
  });
});

describe('T38-F02 compliance queue pagination', () => {
  test('offset passes through to every queue kind and counts are full totals', async () => {
    const client = {
      query: jest.fn(async (text) => {
        const sql = String(text);
        if (sql.includes('pending_verifications')) {
          return { rows: [{ pending_verifications: 500, pending_sanctions: 300, open_cases: 200 }] };
        }
        // listComplianceCases page query.
        return {
          rows: [
            { id: 'c1', case_type: 'review', subject_type: 'customer', subject_id: 'u1', severity: 'high', status: 'open', sla_due_at: new Date(Date.now() + 3600e3).toISOString(), created_at: new Date().toISOString() },
            { id: 'c2', case_type: 'review', subject_type: 'customer', subject_id: 'u2', severity: 'low', status: 'investigating', sla_due_at: new Date(Date.now() + 7200e3).toISOString(), created_at: new Date().toISOString() },
          ],
        };
      }),
    };

    const queue = await complianceCaseService.getComplianceQueue(client, { limit: 50, offset: 50 });

    expect(listPendingVerifications).toHaveBeenCalledWith(client, { limit: 50, offset: 50 });
    expect(listSanctions).toHaveBeenCalledWith(client, { limit: 50, offset: 50 });
    // The cases page query must carry the requested offset, not zero.
    const caseCall = client.query.mock.calls.find(([sql]) => String(sql).includes('oxsteed_credit_compliance_cases') && String(sql).includes('LIMIT'));
    expect(caseCall[1].slice(-2)).toEqual([50, 50]);
    // Counts are the full queue totals, not the 2-row page length.
    expect(queue.counts).toMatchObject({ pendingVerifications: 500, pendingSanctions: 300, openCases: 200 });
    expect(queue.pagination).toEqual({ limit: 50, offset: 50 });
    expect(queue.cases).toHaveLength(2);
  });
});
