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
  app.post('/api/learn/guides/:id/videos', learnController.submitGuideVideo);
  app.get('/api/learn/admin/video-submissions', learnController.adminListVideoSubmissions);
  app.post('/api/learn/admin/video-submissions/:id/block', learnController.adminBlockVideoSubmission);
  app.post('/api/learn/admin/video-submissions/:id/approve', learnController.adminApproveVideoSubmission);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });

  return app;
}

beforeEach(() => resetMocks());

describe('community guide video submissions', () => {
  test('rejects non-YouTube/Vimeo URLs without touching the DB', async () => {
    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'https://evil.example.com/video.mp4' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_video_url');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects javascript: URLs', async () => {
    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'javascript:alert(1)' });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('accepts a YouTube URL and stores a pending submission', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'fix-leaky-faucet', video_url: null }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-1', guide_id: 'fix-leaky-faucet',
          video_url: 'https://www.youtube.com/watch?v=abc123',
          video_provider: 'youtube', status: 'pending',
          created_at: new Date().toISOString(),
        }],
      });

    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'http://www.youtube.com/watch?v=abc123' });

    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe('pending');
    // URL upgraded to https and provider detected
    const insertSql = mockQuery.mock.calls[1][0];
    expect(insertSql).toContain('INSERT INTO learn_guide_video_submissions');
    expect(mockQuery.mock.calls[1][1][1]).toBe('https://www.youtube.com/watch?v=abc123');
    expect(mockQuery.mock.calls[1][1][2]).toBe('youtube');
  });

  test('409 when the guide already has a video', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'fix-leaky-faucet', video_url: 'https://www.youtube.com/watch?v=old' }],
    });

    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'https://www.youtube.com/watch?v=new' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('video_exists');
  });

  test('409 when a video is already pending for the guide', async () => {
    const uniqueViolation = new Error('duplicate key');
    uniqueViolation.code = '23505';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'fix-leaky-faucet', video_url: null }] })
      .mockRejectedValueOnce(uniqueViolation);

    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'https://vimeo.com/12345' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('video_pending_exists');
  });

  test('404 for an unknown guide', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/learn/guides/nope/videos')
      .send({ video_url: 'https://www.youtube.com/watch?v=abc123' });

    expect(res.status).toBe(404);
  });

  test('GET /learn/guides exposes video_pending', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'g1', title: 'T', category: 'c', difficulty: 'Easy', minutes: 10, featured: false, intro: '', steps: [], skills: [], tools: [], xp: 10, video_url: null, video_provider: null }],
      })
      .mockResolvedValueOnce({ rows: [{ guide_id: 'g1' }] });

    const res = await request(buildApp()).get('/api/learn/guides');

    expect(res.status).toBe(200);
    expect(res.body.guides[0].video_pending).toBe(true);
  });
});

describe('publishDueGuideVideos worker', () => {
  test('publishes submissions pending >= 24h', async () => {
    const due = {
      id: 'sub-1', guide_id: 'g1',
      video_url: 'https://www.youtube.com/watch?v=abc', video_provider: 'youtube',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [due] })          // due SELECT
      .mockResolvedValueOnce({ rows: [] })             // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 })          // UPDATE learn_guides
      .mockResolvedValueOnce({ rowCount: 1 })          // UPDATE submission -> live
      .mockResolvedValueOnce({ rows: [] });            // COMMIT

    const result = await learnController.publishDueGuideVideos();

    expect(result).toEqual({ published: 1, superseded: 0 });
    const guideUpdate = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE learn_guides'));
    expect(guideUpdate[1][0]).toBe(due.video_url);
  });

  test('marks superseded when the guide already has a video', async () => {
    const due = { id: 'sub-2', guide_id: 'g2', video_url: 'https://vimeo.com/1', video_provider: 'vimeo' };
    mockQuery
      .mockResolvedValueOnce({ rows: [due] })
      .mockResolvedValueOnce({ rows: [] })             // BEGIN
      .mockResolvedValueOnce({ rowCount: 0 })          // guide already has video
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });            // COMMIT

    const result = await learnController.publishDueGuideVideos();

    expect(result).toEqual({ published: 0, superseded: 1 });
    const subUpdate = mockQuery.mock.calls.find((c) => c[0].includes('learn_guide_video_submissions') && c[0].includes("SET status"));
    expect(subUpdate[1][0]).toBe('superseded');
  });

  test('fails open when the migration has not been applied', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));

    const result = await learnController.publishDueGuideVideos();

    expect(result.skipped).toBe(true);
  });

  test('does nothing when nothing is due', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await learnController.publishDueGuideVideos();

    expect(result).toEqual({ published: 0, superseded: 0 });
  });
});

describe('admin video submission decisions', () => {
  test('block marks the submission blocked', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'sub-1', guide_id: 'g1', video_url: 'https://www.youtube.com/watch?v=x', video_provider: 'youtube', status: 'pending' }],
      })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE -> blocked
      .mockResolvedValueOnce({ rows: [] });   // COMMIT

    const res = await request(buildApp()).post('/api/learn/admin/video-submissions/sub-1/block');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const update = mockQuery.mock.calls.find((c) => c[0].includes("SET status = 'blocked'"));
    expect(update).toBeTruthy();
  });

  test('approve attaches the video to the guide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'sub-1', guide_id: 'g1', video_url: 'https://www.youtube.com/watch?v=x', video_provider: 'youtube', status: 'pending' }],
      })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE learn_guides
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE submission -> live
      .mockResolvedValueOnce({ rows: [] });   // COMMIT

    const res = await request(buildApp()).post('/api/learn/admin/video-submissions/sub-1/approve');

    expect(res.status).toBe(200);
    const guideUpdate = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE learn_guides'));
    expect(guideUpdate).toBeTruthy();
  });

  test('deciding an already-decided submission returns 409', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{ id: 'sub-1', guide_id: 'g1', video_url: 'u', video_provider: 'youtube', status: 'live' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await request(buildApp()).post('/api/learn/admin/video-submissions/sub-1/block');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('video_already_decided');
  });
});
