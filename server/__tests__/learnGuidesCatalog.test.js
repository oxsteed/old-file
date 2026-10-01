'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const learnController = require('../controllers/learnController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  });

  app.get('/api/learn/guides', learnController.getGuides);
  app.get('/api/admin/learn/guides', learnController.adminListGuides);
  app.post('/api/admin/learn/guides', learnController.adminCreateGuide);
  app.put('/api/admin/learn/guides/:id', learnController.adminUpdateGuide);
  app.delete('/api/admin/learn/guides/:id', learnController.adminDeleteGuide);
  app.patch('/api/admin/learn/submissions/:id', learnController.adminReviewSubmission);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });

  return app;
}

beforeEach(() => resetMocks());

const dbGuideRow = (overrides = {}) => ({
  id: 'fix-leaky-faucet',
  title: 'Fix a Leaky Faucet',
  category: 'plumbing',
  difficulty: 'Easy',
  minutes: 30,
  featured: true,
  intro: 'A dripping faucet...',
  steps: ['Turn off water', 'Remove handle'],
  skills: ['Basic disassembly'],
  tools: [{ name: 'Wrench', rent: null, buy: null }],
  xp: 10,
  video_url: null,
  video_provider: null,
  status: 'published',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('learn guides catalog (DB-backed)', () => {
  test('getGuides returns published rows from learn_guides', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [dbGuideRow(), dbGuideRow({ id: 'unclog-drain', featured: false })],
    });
    const res = await request(buildApp()).get('/api/learn/guides');
    expect(res.status).toBe(200);
    expect(res.body.guides).toHaveLength(2);
    expect(res.body.guides[0]).toMatchObject({
      id: 'fix-leaky-faucet',
      title: 'Fix a Leaky Faucet',
      steps: ['Turn off water', 'Remove handle'],
    });
    expect(res.body.guides[0]).toHaveProperty('video_url', null);
    expect(res.body.guides[0]).toHaveProperty('video_provider', null);
  });

  test('getGuides falls back to the JSON catalog when the table is missing', async () => {
    mockQuery.mockRejectedValueOnce(new Error('relation "learn_guides" does not exist'));
    const res = await request(buildApp()).get('/api/learn/guides');
    expect(res.status).toBe(200);
    expect(res.body.guides.length).toBeGreaterThan(100);
    expect(res.body.guides[0]).toHaveProperty('id');
  });

  test('getGuides falls back to the JSON catalog when the table is empty', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/learn/guides');
    expect(res.status).toBe(200);
    expect(res.body.guides.length).toBeGreaterThan(100);
  });

  test('admin CRUD round-trip', async () => {
    const app = buildApp();

    // Create
    mockQuery.mockResolvedValueOnce({ rows: [dbGuideRow({ id: 'test-guide', title: 'Test Guide' })] });
    const created = await request(app)
      .post('/api/admin/learn/guides')
      .send({ id: 'test-guide', title: 'Test Guide', category: 'plumbing', difficulty: 'Easy' });
    expect(created.status).toBe(201);
    expect(created.body.guide).toMatchObject({ id: 'test-guide', title: 'Test Guide' });

    // List
    mockQuery.mockResolvedValueOnce({ rows: [dbGuideRow({ id: 'test-guide' })] });
    const listed = await request(app).get('/api/admin/learn/guides');
    expect(listed.status).toBe(200);
    expect(listed.body.guides).toHaveLength(1);

    // Update
    mockQuery.mockResolvedValueOnce({
      rows: [dbGuideRow({ id: 'test-guide', title: 'Renamed', status: 'draft' })],
    });
    const updated = await request(app)
      .put('/api/admin/learn/guides/test-guide')
      .send({ title: 'Renamed', status: 'draft' });
    expect(updated.status).toBe(200);
    expect(updated.body.guide.title).toBe('Renamed');

    // Delete
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    const deleted = await request(app).delete('/api/admin/learn/guides/test-guide');
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
  });

  test('admin create rejects invalid ids and duplicates', async () => {
    const app = buildApp();

    const badId = await request(app)
      .post('/api/admin/learn/guides')
      .send({ id: 'Bad ID!!', title: 'x', category: 'plumbing' });
    expect(badId.status).toBe(400);

    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    mockQuery.mockRejectedValueOnce(dup);
    const conflict = await request(app)
      .post('/api/admin/learn/guides')
      .send({ id: 'fix-leaky-faucet', title: 'x', category: 'plumbing' });
    expect(conflict.status).toBe(409);
  });

  test('admin update with no fields is rejected', async () => {
    const res = await request(buildApp())
      .put('/api/admin/learn/guides/test-guide')
      .send({});
    expect(res.status).toBe(400);
  });

  test('approving a submission publishes it to the catalog', async () => {
    const submission = {
      id: 7,
      title: 'Install a Ceiling Fan',
      category: 'electrical',
      difficulty: 'Medium',
      estimated_minutes: 90,
      intro: 'Swap a light for a fan.',
      steps: ['Cut power', 'Mount bracket', 'Wire fan'],
      skills: ['Basic wiring'],
      tools: [{ name: 'Screwdriver', buy_url: null, rent_url: null }],
      video_url: 'https://www.youtube.com/watch?v=abc123',
    };
    mockQuery.mockImplementation(async (text) => {
      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') ||
          text.includes('SAVEPOINT') || text.includes('ROLLBACK TO')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM guide_submissions WHERE id')) return { rows: [submission] };
      if (text.includes('UPDATE guide_submissions')) return { rows: [{ id: 7, status: 'approved' }] };
      if (text.includes('FROM learn_guides WHERE id')) return { rows: [] };
      if (text.includes('INSERT INTO learn_guides')) return { rows: [{ id: 'install-a-ceiling-fan' }] };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .patch('/api/admin/learn/submissions/7')
      .send({ action: 'approve' });

    expect(res.status).toBe(200);
    expect(res.body.submission.status).toBe('approved');
    expect(res.body.published_guide_id).toBe('install-a-ceiling-fan');

    const insertCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO learn_guides'));
    expect(insertCall).toBeDefined();
    const vals = insertCall[1];
    expect(vals[0]).toBe('install-a-ceiling-fan'); // slug from title
    expect(vals[11]).toBe('youtube');              // video provider detected
    expect(insertCall[0]).toContain("'published'");
  });

  test('approval succeeds even when the catalog publish fails', async () => {
    const submission = {
      id: 8,
      title: 'Patch Drywall',
      category: 'carpentry',
      difficulty: 'Easy',
      estimated_minutes: 45,
      intro: 'Fix a hole.',
      steps: ['Cut patch', 'Apply compound'],
      skills: ['Sanding'],
      tools: [],
      video_url: null,
    };
    mockQuery.mockImplementation(async (text) => {
      if (text.startsWith('BEGIN') || text.startsWith('COMMIT') ||
          text.includes('SAVEPOINT') || text.includes('ROLLBACK TO')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM guide_submissions WHERE id')) return { rows: [submission] };
      if (text.includes('UPDATE guide_submissions')) return { rows: [{ id: 8, status: 'approved' }] };
      // Catalog table missing — publish blows up, approval must survive.
      if (text.includes('learn_guides')) throw new Error('relation "learn_guides" does not exist');
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .patch('/api/admin/learn/submissions/8')
      .send({ action: 'approve' });

    expect(res.status).toBe(200);
    expect(res.body.submission.status).toBe('approved');
    expect(res.body.published_guide_id).toBeNull();
  });

  test('rejecting a submission does not publish', async () => {
    const submission = { id: 9, title: 'x', category: 'plumbing' };
    mockQuery.mockImplementation(async (text) => {
      if (text.startsWith('BEGIN') || text.startsWith('COMMIT')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM guide_submissions WHERE id')) return { rows: [submission] };
      if (text.includes('UPDATE guide_submissions')) return { rows: [{ id: 9, status: 'rejected' }] };
      return { rows: [], rowCount: 0 };
    });

    const res = await request(buildApp())
      .patch('/api/admin/learn/submissions/9')
      .send({ action: 'reject' });

    expect(res.status).toBe(200);
    expect(res.body.submission.status).toBe('rejected');
    expect(res.body.published_guide_id).toBeNull();
    expect(mockQuery.mock.calls.some((c) => c[0].includes('INSERT INTO learn_guides'))).toBe(false);
  });
});
