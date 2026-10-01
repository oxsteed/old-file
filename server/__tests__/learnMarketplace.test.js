'use strict';

/**
 * learnMarketplace.test.js — Phase 2 controller endpoints:
 * manual re-tag, AI suggestion review queue, click tracking, marketplace stats.
 * The learnTagging service is mocked; the pg pool is the shared jest mock.
 */

jest.mock('../services/learnTagging', () => ({
  tagGuideWithAI: jest.fn(),
  tagGuideInBackground: jest.fn(),
  LEARN_CATEGORIES: ['plumbing', 'electrical'],
}));

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const learnController = require('../controllers/learnController');
const learnTagging = require('../services/learnTagging');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  });

  app.post('/api/admin/learn/guides/:id/tag', learnController.adminTagGuide);
  app.get('/api/admin/learn/ai-suggestions', learnController.adminListAiSuggestions);
  app.post('/api/admin/learn/ai-suggestions/:id/approve', learnController.adminApproveSuggestion);
  app.post('/api/admin/learn/ai-suggestions/:id/reject', learnController.adminRejectSuggestion);
  app.post('/api/learn/track', learnController.trackMarketplaceClick);
  app.get('/api/admin/learn/marketplace-stats', learnController.adminMarketplaceStats);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });
  return app;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

const pendingTool = (overrides = {}) => ({
  id: 'sug-1',
  guide_id: 'g1',
  kind: 'tool',
  name: 'Adjustable wrench',
  detail: 'Tighten fittings',
  suggested_rent_url: '/tool-rentals?search=adjustable-wrench',
  suggested_buy_url: 'https://example.com/wrench',
  matched_rental_slug: 'adjustable-wrench',
  matched_direct_category: null,
  confidence: 0.95,
  status: 'pending',
  ...overrides,
});

function mockApproveDb({ suggestion, tools }) {
  mockQuery.mockImplementation(async (text) => {
    if (text.startsWith('BEGIN') || text.startsWith('COMMIT') || text.startsWith('ROLLBACK')) {
      return {};
    }
    if (text.includes('FROM learn_guide_ai_suggestions') && text.includes('FOR UPDATE')) {
      return { rows: [suggestion] };
    }
    if (text.includes('SELECT tools FROM learn_guides')) {
      return { rows: [{ tools }] };
    }
    if (text.includes('UPDATE learn_guides SET tools')) {
      return { rowCount: 1 };
    }
    if (text.includes('UPDATE learn_guides SET category')) {
      return { rowCount: 1 };
    }
    if (text.includes('UPDATE learn_guide_ai_suggestions')) {
      return { rowCount: 1 };
    }
    return { rows: [] };
  });
}

describe('adminTagGuide', () => {
  test('runs tagging and returns the result', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1' }] });
    learnTagging.tagGuideWithAI.mockResolvedValue({ ok: true, guide_id: 'g1', created: 3 });
    const res = await request(buildApp()).post('/api/admin/learn/guides/g1/tag');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, guide_id: 'g1', ok: true, created: 3 });
  });

  test('404 when the guide does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).post('/api/admin/learn/guides/nope/tag');
    expect(res.status).toBe(404);
  });
});

describe('adminListAiSuggestions', () => {
  test('lists pending suggestions with guide titles', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...pendingTool(), guide_title: 'Fix a Leaky Faucet' }] });
    const res = await request(buildApp()).get('/api/admin/learn/ai-suggestions');
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(1);
    expect(res.body.suggestions[0].guide_title).toBe('Fix a Leaky Faucet');
    // Default status filter is pending.
    expect(mockQuery.mock.calls[0][1]).toEqual(['pending', null]);
  });

  test('rejects an invalid status filter', async () => {
    const res = await request(buildApp()).get('/api/admin/learn/ai-suggestions?status=bogus');
    expect(res.status).toBe(400);
  });
});

describe('adminApproveSuggestion', () => {
  test('approving a tool appends it to guide.tools', async () => {
    mockApproveDb({ suggestion: pendingTool(), tools: [] });
    const res = await request(buildApp()).post('/api/admin/learn/ai-suggestions/sug-1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, approved: true });

    const toolsUpdate = mockQuery.mock.calls.find(([text]) => text.includes('UPDATE learn_guides SET tools'));
    expect(toolsUpdate).toBeDefined();
    const merged = JSON.parse(toolsUpdate[1][0]);
    expect(merged).toEqual([
      {
        name: 'Adjustable wrench',
        rent: '/tool-rentals?search=adjustable-wrench',
        buy: 'https://example.com/wrench',
      },
    ]);

    const markApproved = mockQuery.mock.calls.find(([text]) =>
      text.includes("SET status = 'approved'")
    );
    expect(markApproved).toBeDefined();
    expect(markApproved[1]).toEqual(['admin-1', 'sug-1']);
  });

  test('does not duplicate a tool that already exists (case-insensitive)', async () => {
    mockApproveDb({
      suggestion: pendingTool(),
      tools: [{ name: 'ADJUSTABLE WRENCH', rent: null, buy: null }],
    });
    const res = await request(buildApp()).post('/api/admin/learn/ai-suggestions/sug-1/approve');
    expect(res.status).toBe(200);
    const toolsUpdate = mockQuery.mock.calls.find(([text]) =>
      text.includes('UPDATE learn_guides SET tools')
    );
    expect(toolsUpdate).toBeUndefined();
  });

  test('approving a service sets the guide category', async () => {
    mockApproveDb({
      suggestion: pendingTool({ kind: 'service', name: 'Plumbing', matched_direct_category: 'plumbing' }),
      tools: [],
    });
    const res = await request(buildApp()).post('/api/admin/learn/ai-suggestions/sug-1/approve');
    expect(res.status).toBe(200);
    const catUpdate = mockQuery.mock.calls.find(([text]) =>
      text.includes('UPDATE learn_guides SET category')
    );
    expect(catUpdate).toBeDefined();
    expect(catUpdate[1]).toEqual(['plumbing', 'g1']);
  });

  test('422 when a service suggestion has no valid category', async () => {
    mockApproveDb({
      suggestion: pendingTool({ kind: 'service', name: 'Rocket science', matched_direct_category: null }),
      tools: [],
    });
    const res = await request(buildApp()).post('/api/admin/learn/ai-suggestions/sug-1/approve');
    expect(res.status).toBe(422);
  });

  test('409 when the suggestion is no longer pending', async () => {
    mockApproveDb({ suggestion: pendingTool({ status: 'approved' }), tools: [] });
    const res = await request(buildApp()).post('/api/admin/learn/ai-suggestions/sug-1/approve');
    expect(res.status).toBe(409);
  });
});

describe('adminRejectSuggestion', () => {
  test('marks a pending suggestion rejected', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(buildApp()).post('/api/admin/learn/ai-suggestions/sug-1/reject');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, rejected: true });
  });

  test('404 when nothing was pending', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(buildApp()).post('/api/admin/learn/ai-suggestions/sug-1/reject');
    expect(res.status).toBe(404);
  });
});

describe('trackMarketplaceClick', () => {
  test('stores a valid click', async () => {
    mockQuery.mockImplementation(async (text) => {
      if (text.includes('FROM learn_guides')) return { rows: [{ '1': 1 }] };
      return { rowCount: 1 };
    });
    const res = await request(buildApp())
      .post('/api/learn/track')
      .send({ guide_id: 'g1', kind: 'rent', target: '/tool-rentals?search=x' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, tracked: true });
    const insert = mockQuery.mock.calls.find(([text]) => text.includes('INSERT INTO learn_marketplace_clicks'));
    expect(insert[1]).toEqual(['g1', 'rent', '/tool-rentals?search=x', 'admin-1']);
  });

  test('400 on an invalid kind', async () => {
    const res = await request(buildApp())
      .post('/api/learn/track')
      .send({ guide_id: 'g1', kind: 'bogus' });
    expect(res.status).toBe(400);
  });

  test('404 when the guide does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .post('/api/learn/track')
      .send({ guide_id: 'nope', kind: 'buy' });
    expect(res.status).toBe(404);
  });
});

describe('adminMarketplaceStats', () => {
  test('returns clicks per guide per kind', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ guide_id: 'g1', guide_title: 'Fix a Leaky Faucet', kind: 'rent', clicks: 12 }],
    });
    const res = await request(buildApp()).get('/api/admin/learn/marketplace-stats');
    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual([
      { guide_id: 'g1', guide_title: 'Fix a Leaky Faucet', kind: 'rent', clicks: 12 },
    ]);
  });
});
