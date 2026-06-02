'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const learnController = require('../controllers/learnController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123', role: 'helper' };
    next();
  });

  app.get('/api/learn/guides', learnController.getGuides);
  app.get('/api/learn/stats', learnController.getGuideStats);
  app.post('/api/learn/views', learnController.recordView);
  app.post('/api/learn/completions', learnController.recordCompletion);
  app.post('/api/learn/guides/submit', learnController.submitGuide);
  app.get('/api/learn/submissions/mine', learnController.getMySubmissions);
  app.get('/api/learn/product-links', learnController.getProductLinks);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });

  return app;
}

beforeEach(() => resetMocks());

describe('learn api', () => {
  test('GET /learn/guides exposes the shared guide catalog', async () => {
    const res = await request(buildApp()).get('/api/learn/guides');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.guides)).toBe(true);
    expect(res.body.guides.length).toBeGreaterThan(0);
    expect(res.body.guides[0]).toHaveProperty('id');
  });

  test('POST /learn/views records known guide views and ignores unknown ids', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const known = await request(buildApp())
      .post('/api/learn/views')
      .send({ guide_id: 'unclog-drain' });

    const unknown = await request(buildApp())
      .post('/api/learn/views')
      .send({ guide_id: 'not-a-real-guide' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO guide_view_events');
    expect(mockQuery.mock.calls[0][1]).toEqual(['unclog-drain', 'user-123']);
  });

  test('GET /learn/product-links fails open when override table is unavailable', async () => {
    mockQuery.mockRejectedValueOnce(new Error('relation does not exist'));

    const res = await request(buildApp()).get('/api/learn/product-links');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ products: [] });
  });

  test('POST /learn/guides/submit accepts the iOS creator submission payload', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 42, submitted_at: '2026-06-02T12:00:00.000Z' }],
      rowCount: 1,
    });

    const res = await request(buildApp())
      .post('/api/learn/guides/submit')
      .send({
        title: 'How to prep a service estimate',
        category: 'business',
        difficulty: 'Easy',
        summary: 'A concise guide for preparing a clean customer estimate.',
        steps: ['Gather the job scope', 'Price labor and materials'],
        tools: ['Tape measure', 'Estimate template'],
        media_urls: ['https://cdn.oxsteed.com/guide/photo.jpg'],
        video_url: 'https://cdn.oxsteed.com/guide/video.mp4',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.submission.id).toBe(42);
    expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO guide_submissions');
    expect(mockQuery.mock.calls[0][1][2]).toBe('business');
    expect(JSON.parse(mockQuery.mock.calls[0][1][7])).toEqual(['business']);
    expect(JSON.parse(mockQuery.mock.calls[0][1][8])[0]).toEqual({
      name: 'Tape measure',
      buy_url: null,
      rent_url: null,
    });
    expect(mockQuery.mock.calls[0][1][10]).toContain('Media: https://cdn.oxsteed.com/guide/photo.jpg');
  });

  test('POST /learn/guides/submit rejects incomplete guides before insert', async () => {
    const res = await request(buildApp())
      .post('/api/learn/guides/submit')
      .send({
        title: 'Too short',
        category: 'business',
        difficulty: 'Easy',
        summary: 'Only one step is not enough.',
        steps: ['Do one thing'],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('GET /learn/submissions/mine returns the caller submission review status', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 42,
        title: 'How to prep a service estimate',
        category: 'business',
        difficulty: 'Easy',
        status: 'pending',
        reviewer_note: null,
        submitted_at: '2026-06-02T12:00:00.000Z',
        updated_at: '2026-06-02T12:00:00.000Z',
      }],
      rowCount: 1,
    });

    const res = await request(buildApp()).get('/api/learn/submissions/mine');

    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(1);
    expect(res.body.submissions[0]).toMatchObject({
      id: 42,
      title: 'How to prep a service estimate',
      category: 'business',
      status: 'pending',
    });
    expect(mockQuery.mock.calls[0][0]).toContain('FROM guide_submissions');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-123']);
  });
});
