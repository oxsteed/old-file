'use strict';

const fs = require('fs');
const path = require('path');
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
  app.post('/api/learn/videos/:videoId/vote', learnController.toggleVideoVote);
  app.post('/api/learn/videos/:videoId/flags', learnController.flagVideo);
  app.get('/api/learn/admin/video-submissions', learnController.adminListVideoSubmissions);
  app.post('/api/learn/admin/video-submissions/:id/block', learnController.adminBlockVideoSubmission);
  app.post('/api/learn/admin/video-submissions/:id/approve', learnController.adminApproveVideoSubmission);
  app.get('/api/learn/admin/video-flags', learnController.adminListVideoFlags);
  app.post('/api/learn/admin/video-flags/:id/dismiss', learnController.adminDismissVideoFlag);
  app.post('/api/learn/admin/video-flags/:id/move', learnController.adminMoveVideoFlag);
  app.post('/api/learn/admin/video-flags/:id/delete', learnController.adminDeleteVideoFlag);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });

  return app;
}

beforeEach(() => resetMocks());

const GUIDE_ROW = {
  id: 'fix-leaky-faucet', title: 'Fix a leaky faucet', category: 'plumbing',
  difficulty: 'Easy', minutes: 30, featured: false, intro: '', steps: [],
  skills: [], tools: [], xp: 10, video_url: null, video_provider: null,
};

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
      .mockResolvedValueOnce({ rows: [{ id: 'fix-leaky-faucet' }] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate-URL check: none
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
    const insertSql = mockQuery.mock.calls[2][0];
    expect(insertSql).toContain('INSERT INTO learn_guide_video_submissions');
    expect(mockQuery.mock.calls[2][1][1]).toBe('https://www.youtube.com/watch?v=abc123');
    expect(mockQuery.mock.calls[2][1][2]).toBe('youtube');
  });

  test('allows a second video when the guide already has videos (playlist)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'fix-leaky-faucet' }] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate-URL check: none
      .mockResolvedValueOnce({
        rows: [{ id: 'sub-2', guide_id: 'fix-leaky-faucet', status: 'pending' }],
      });

    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'https://www.youtube.com/watch?v=new' });

    expect(res.status).toBe(201);
  });

  test('409 when the same URL is already live on the guide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'fix-leaky-faucet' }] })
      .mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // duplicate-URL check: hit

    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'https://www.youtube.com/watch?v=old' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('video_duplicate');
  });

  test('409 when the same URL is already pending (unique violation)', async () => {
    const uniqueViolation = new Error('duplicate key');
    uniqueViolation.code = '23505';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'fix-leaky-faucet' }] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate-URL check: none
      .mockRejectedValueOnce(uniqueViolation);

    const res = await request(buildApp())
      .post('/api/learn/guides/fix-leaky-faucet/videos')
      .send({ video_url: 'https://vimeo.com/12345' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('video_duplicate');
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
      .mockResolvedValueOnce({ rows: [GUIDE_ROW] })
      .mockResolvedValueOnce({ rows: [{ guide_id: 'fix-leaky-faucet' }] })
      .mockResolvedValueOnce({ rows: [] }); // playlist: none

    const res = await request(buildApp()).get('/api/learn/guides');

    expect(res.status).toBe(200);
    expect(res.body.guides[0].video_pending).toBe(true);
    expect(res.body.guides[0].videos).toEqual([]);
  });

  test('GET /learn/guides returns the playlist with the pinned admin video first', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          ...GUIDE_ROW,
          video_url: 'https://www.youtube.com/watch?v=admin',
          video_provider: 'youtube',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // pending
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'v1', guide_id: 'fix-leaky-faucet',
            video_url: 'https://www.youtube.com/watch?v=a', video_provider: 'youtube',
            votes: 5, viewer_voted: true,
          },
          {
            id: 'v2', guide_id: 'fix-leaky-faucet',
            video_url: 'https://vimeo.com/2', video_provider: 'vimeo',
            votes: 2, viewer_voted: false,
          },
        ],
      });

    const res = await request(buildApp()).get('/api/learn/guides');

    expect(res.status).toBe(200);
    const videos = res.body.guides[0].videos;
    expect(videos).toHaveLength(3);
    expect(videos[0].pinned).toBe(true);
    expect(videos[0].url).toBe('https://www.youtube.com/watch?v=admin');
    expect(videos[1].id).toBe('v1');
    expect(videos[1].votes).toBe(5);
    expect(videos[1].viewerVoted).toBe(true);
    expect(videos[1].pinned).toBe(false);
    // legacy single-video fields stay populated for the native app
    expect(res.body.guides[0].video_url).toBe('https://www.youtube.com/watch?v=admin');
  });
});

describe('publishDueGuideVideos worker', () => {
  test('publishes submissions pending >= 24h into the playlist', async () => {
    const due = {
      id: 'sub-1', guide_id: 'g1',
      video_url: 'https://www.youtube.com/watch?v=abc', video_provider: 'youtube',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [due] })          // due SELECT
      .mockResolvedValueOnce({ rows: [] })             // BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'v-1' }] }) // INSERT playlist
      .mockResolvedValueOnce({ rowCount: 1 })          // UPDATE submission -> live
      .mockResolvedValueOnce({ rows: [] });            // COMMIT

    const result = await learnController.publishDueGuideVideos();

    expect(result).toEqual({ published: 1, superseded: 0 });
    const insert = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO learn_guide_videos'));
    expect(insert).toBeTruthy();
    expect(insert[1][0]).toBe('g1');
    expect(insert[1][1]).toBe(due.video_url);
    // The single-video column is no longer overwritten
    expect(mockQuery.mock.calls.find((c) => c[0].includes('UPDATE learn_guides'))).toBeUndefined();
  });

  test('marks superseded when the link is already in the playlist', async () => {
    const due = { id: 'sub-2', guide_id: 'g2', video_url: 'https://vimeo.com/1', video_provider: 'vimeo' };
    mockQuery
      .mockResolvedValueOnce({ rows: [due] })
      .mockResolvedValueOnce({ rows: [] })             // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // ON CONFLICT DO NOTHING
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });            // COMMIT

    const result = await learnController.publishDueGuideVideos();

    expect(result).toEqual({ published: 0, superseded: 1 });
    const subUpdate = mockQuery.mock.calls.find((c) => c[0].includes('learn_guide_video_submissions') && c[0].includes('SET status'));
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

  test('approve appends the video to the playlist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [{
          id: 'sub-1', guide_id: 'g1', video_url: 'https://www.youtube.com/watch?v=x',
          video_provider: 'youtube', status: 'pending', submitted_by: 'user-9',
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'v-1' }] }) // INSERT playlist
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE submission -> live
      .mockResolvedValueOnce({ rows: [] });   // COMMIT

    const res = await request(buildApp()).post('/api/learn/admin/video-submissions/sub-1/approve');

    expect(res.status).toBe(200);
    const insert = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO learn_guide_videos'));
    expect(insert).toBeTruthy();
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

describe('video votes ("most helpful")', () => {
  test('votes on a community video', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'v1' }] })  // video exists
      .mockResolvedValueOnce({ rows: [] })              // no existing vote
      .mockResolvedValueOnce({ rows: [] })              // INSERT vote
      .mockResolvedValueOnce({ rows: [{ votes: 1 }] }); // count

    const res = await request(buildApp()).post('/api/learn/videos/v1/vote');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ voted: true, votes: 1 });
  });

  test('toggles an existing vote off', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'v1' }] })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // existing vote
      .mockResolvedValueOnce({ rows: [] })                  // DELETE
      .mockResolvedValueOnce({ rows: [{ votes: 0 }] });

    const res = await request(buildApp()).post('/api/learn/videos/v1/vote');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ voted: false, votes: 0 });
    const del = mockQuery.mock.calls.find((c) => c[0].includes('DELETE FROM learn_guide_video_votes'));
    expect(del).toBeTruthy();
  });

  test('rejects votes on the pinned admin video without touching the DB', async () => {
    const res = await request(buildApp()).post('/api/learn/videos/admin:g1/vote');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('video_vote_pinned');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('404 for an unknown video', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).post('/api/learn/videos/nope/vote');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('video_not_found');
  });
});

describe('video flags', () => {
  test('flags a video with a valid reason', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'v1' }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/learn/videos/v1/flags')
      .send({ reason: 'unrelated', note: 'this is about sinks' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const insert = mockQuery.mock.calls[1][0];
    expect(insert).toContain('INSERT INTO learn_guide_video_flags');
    expect(mockQuery.mock.calls[1][1][2]).toBe('unrelated');
  });

  test('rejects an invalid reason without touching the DB', async () => {
    const res = await request(buildApp())
      .post('/api/learn/videos/v1/flags')
      .send({ reason: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_flag_reason');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('409 on a duplicate open flag', async () => {
    const dup = new Error('duplicate key');
    dup.code = '23505';
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'v1' }] })
      .mockRejectedValueOnce(dup);

    const res = await request(buildApp())
      .post('/api/learn/videos/v1/flags')
      .send({ reason: 'spam' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('flag_duplicate');
  });

  test('rejects flags on the pinned admin video', async () => {
    const res = await request(buildApp())
      .post('/api/learn/videos/admin:g1/flags')
      .send({ reason: 'spam' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('video_flag_pinned');
  });
});

describe('admin video flag decisions', () => {
  test('lists flags', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'f1', reason: 'unrelated', video_id: 'v1', open_flags: 2 }],
    });

    const res = await request(buildApp()).get('/api/learn/admin/video-flags');

    expect(res.status).toBe(200);
    expect(res.body.flags).toHaveLength(1);
    expect(res.body.flags[0].open_flags).toBe(2);
  });

  test('dismiss closes the flag', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'f1', video_id: 'v1', status: 'open' }] })
      .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE -> dismissed
      .mockResolvedValueOnce({ rows: [] });   // COMMIT

    const res = await request(buildApp()).post('/api/learn/admin/video-flags/f1/dismiss');

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find((c) => c[0].includes("status = 'dismissed'"));
    expect(update).toBeTruthy();
  });

  test('move transfers the video to the right guide and resolves its flags', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'f1', video_id: 'v1', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'g2' }] }) // target guide exists
      .mockResolvedValueOnce({ rowCount: 1 })         // UPDATE video guide_id
      .mockResolvedValueOnce({ rowCount: 1 })         // resolve open flags
      .mockResolvedValueOnce({ rows: [] });           // COMMIT

    const res = await request(buildApp())
      .post('/api/learn/admin/video-flags/f1/move')
      .send({ guide_id: 'g2' });

    expect(res.status).toBe(200);
    const move = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE learn_guide_videos SET guide_id'));
    expect(move).toBeTruthy();
    expect(move[1]).toEqual(['g2', 'v1']);
  });

  test('move to an unknown guide returns 404', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'f1', video_id: 'v1', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] }) // no target guide
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await request(buildApp())
      .post('/api/learn/admin/video-flags/f1/move')
      .send({ guide_id: 'nope' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('guide_not_found');
  });

  test('delete removes the video', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'f1', video_id: 'v1', status: 'open' }] })
      .mockResolvedValueOnce({ rowCount: 1 }) // DELETE video
      .mockResolvedValueOnce({ rowCount: 1 }) // resolve open flags
      .mockResolvedValueOnce({ rows: [] });   // COMMIT

    const res = await request(buildApp()).post('/api/learn/admin/video-flags/f1/delete');

    expect(res.status).toBe(200);
    const del = mockQuery.mock.calls.find((c) => c[0].startsWith('DELETE FROM learn_guide_videos'));
    expect(del).toBeTruthy();
  });

  test('deciding an already-decided flag returns 409', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'f1', video_id: 'v1', status: 'dismissed' }] })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const res = await request(buildApp()).post('/api/learn/admin/video-flags/f1/dismiss');

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('video_flag_already_decided');
  });
});

describe('migration 631', () => {
  test('exists, sorts after 630, and defines the playlist schema', () => {
    const dir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const f630 = files.find((f) => f.startsWith('630_'));
    const f631 = files.find((f) => f.startsWith('631_'));
    expect(f630).toBeTruthy();
    expect(f631).toBeTruthy();
    expect(files.indexOf(f631)).toBeGreaterThan(files.indexOf(f630));
    const sql = fs.readFileSync(path.join(dir, f631), 'utf8');
    for (const table of ['learn_guide_videos', 'learn_guide_video_votes', 'learn_guide_video_flags']) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain('DROP INDEX IF EXISTS uq_lgvs_guide_pending');
    expect(sql).toContain('uq_lgvs_guide_url_pending');
  });
});
