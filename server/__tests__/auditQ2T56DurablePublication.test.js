'use strict';

/**
 * auditQ2T56DurablePublication.test.js — Audit queue Q2, T56-F04.
 *
 * Original defect (Oct 2 audit): legal document drafts, approval, and live
 * labels were held in a process-local Map, so a restart or a second node
 * erased or disagreed on an approved document, and marking a draft "live"
 * did not update the public content (which loaded bundled locale content).
 *
 * The fix: drafts persist in legal_document_drafts, publication flows
 * through pending_review with maker/checker separation, and the public
 * terms endpoint serves the live database draft instead of the bundled
 * fallback. This test locks the public-content half through the real
 * route: a live draft must be what the public endpoint returns, and a
 * non-live draft must fall back to bundled content.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => next(),
}));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => next(),
  requirePermission: () => (req, _res, next) => next(),
}));
jest.mock('../middleware/rateLimiter', () => ({
  generalLimiter: (req, _res, next) => next(),
  strictLimiter: (req, _res, next) => next(),
}));
jest.mock('../controllers/legalDocumentsController', () => ({
  getAcceptanceHistory: jest.fn(),
  recordAcceptance: jest.fn(),
  getUserAcceptances: jest.fn(),
  listAllAcceptances: jest.fn(),
  getComplianceMetrics: jest.fn(),
  getAuditLog: jest.fn(),
  revokeAcceptance: jest.fn(),
}));
jest.mock('../controllers/ccpaController', () => ({
  createCCPARequest: jest.fn(),
  listCCPARequests: jest.fn(),
  getCCPARequest: jest.fn(),
  bulkMarkCCPACompleted: jest.fn(),
  updateCCPARequest: jest.fn(),
  sendCCPANotification: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../db', () => ({ query: jest.fn() }));

const db = require('../db');
const router = require('../routes/legalDocuments');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/legal', router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const LIVE_DRAFT = {
  id: 'terms_of_service',
  title: 'Terms of Service (2026 revision)',
  category: 'terms_of_service',
  version: 7,
  status: 'live',
  sections: [{ key: '1', title: 'Custom section', content: '<p>Custom published terms</p>' }],
  updated_at: '2026-10-30T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('T56-F04 durable publication', () => {
  test('public terms serve the live database draft, not bundled content', async () => {
    db.query.mockImplementation(async (text) => {
      if (String(text).includes('FROM legal_document_drafts')) return { rows: [LIVE_DRAFT] };
      return { rows: [] };
    });

    const res = await request(createApp()).get('/legal/documents/terms_of_service');

    expect(res.status).toBe(200);
    // State came from the database query, not process memory.
    expect(db.query).toHaveBeenCalledWith(
      'SELECT * FROM legal_document_drafts WHERE id = $1',
      ['terms_of_service'],
    );
    expect(res.body.document.version).toBe(7);
    expect(res.body.document.status).toBe('live');
    expect(res.body.document.title).toBe('Terms of Service (2026 revision)');
    expect(res.body.sections[0]).toMatchObject({ title: 'Custom section', content: '<p>Custom published terms</p>' });
  });

  test('a non-live draft falls back to bundled content', async () => {
    db.query.mockImplementation(async (text) => {
      if (String(text).includes('FROM legal_document_drafts')) {
        return { rows: [{ ...LIVE_DRAFT, status: 'draft', version: 6 }] };
      }
      return { rows: [] };
    });

    const res = await request(createApp()).get('/legal/documents/terms_of_service');

    expect(res.status).toBe(200);
    expect(res.body.document.version).toBe(1);
    expect(res.body.document.status).toBe('live');
    expect(res.body.document.title).toBe('Terms of Service');
  });
});
