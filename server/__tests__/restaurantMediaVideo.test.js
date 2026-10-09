'use strict';

/**
 * __tests__/restaurantMediaVideo.test.js
 *
 * Restaurant Media video upload pipeline (migration 665):
 * quarantine-first uploads, CSAM gate, ffmpeg transcode worker, retry, DMCA.
 *
 * VIDEO_UPLOAD_MAX_BYTES is set to 1KB at the top (before the controller is
 * required) so the 200MB cap path is exercised without a 200MB fixture; the
 * production default stays 200MB.
 */

process.env.VIDEO_UPLOAD_MAX_BYTES = '1024';

const express = require('express');
const request = require('supertest');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/fileScanService', () => ({
  scanBuffer: jest.fn(),
}));

const fileScanService = require('../services/fileScanService');
const fileTypeMock = jest.requireMock('file-type');
const videoCtrl = require('../controllers/restaurantMediaVideoController');
const worker = require('../services/videoTranscodeWorker');
const csamCheckService = require('../services/csamCheckService');
const storage = require('../utils/storage');

const RESTAURANT_ROW = { id: 42, business_id: 7, owner_user_id: 'user-owner' };
const MEDIA_UUID = '11111111-1111-4111-8111-111111111111';
const CLEAN_SCAN = { clean: true, skipped: false, provider: 'clamav' };

function buildApp({ user = { id: 'user-123' } } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = { ...user };
    next();
  });
  app.post(
    '/api/restaurants/:restaurantId/media/video-uploads',
    videoCtrl.videoUploadLimiter,
    videoCtrl.videoUploadHandler,
    videoCtrl.postVideoUpload
  );
  app.post(
    '/api/restaurants/:restaurantId/media/:mediaId/retry',
    videoCtrl.retryVideoProcessing
  );
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });
  return app;
}

// Route mockQuery by SQL substring. Handlers return {rows, rowCount}.
function routeQueries(handlers) {
  mockQuery.mockImplementation(async (sql) => {
    const q = String(sql);
    for (const [pattern, fn] of handlers) {
      if (q.includes(pattern)) return fn(q);
    }
    return { rows: [], rowCount: 0 };
  });
}

function mockRestaurantFound() {
  return [['discovery_status', () => ({ rows: [RESTAURANT_ROW], rowCount: 1 })]];
}

function mockUploadInsert() {
  return [
    ['INSERT INTO restaurant_media\n', () => ({
      rows: [{
        id: MEDIA_UUID, media_type: 'video_upload',
        processing_status: 'quarantine', csam_status: 'pending',
        created_at: new Date().toISOString(),
      }],
      rowCount: 1,
    })],
    ['INSERT INTO restaurant_media_processing_jobs', () => ({ rows: [], rowCount: 2 })],
  ];
}

const capturedInserts = [];
function captureInserts() {
  capturedInserts.length = 0;
  const orig = mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async (sql, params) => {
    capturedInserts.push({ sql: String(sql), params });
    return orig ? orig(sql, params) : { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  resetMocks();
  capturedInserts.length = 0;
  fileScanService.scanBuffer.mockReset();
  fileScanService.scanBuffer.mockResolvedValue(CLEAN_SCAN);
  fileTypeMock.fileTypeFromBuffer.mockReset();
  fileTypeMock.fileTypeFromBuffer.mockResolvedValue({ mime: 'video/mp4', ext: 'mp4' });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.CSAM_VENDOR;
  delete process.env.CSAM_THORN_API_KEY;
  delete process.env.CSAM_THORN_BASE_URL;
});

function tinyMp4Buffer(size = 512) {
  // Not a real video; magic bytes are mocked via file-type in these tests.
  return Buffer.alloc(size, 0x01);
}

// ── Upload: happy path + quarantine gate ─────────────────────────────────────

describe('POST video-uploads', () => {
  function mockUploadDb() {
    routeQueries([
      ...mockRestaurantFound(),
      ...mockUploadInsert(),
      ['FROM food_menu_items', () => ({
        rows: [
          { id: 7, name: 'Pasta', price_cents: 1000, currency_code: 'USD' },
          { id: 9, name: 'Salad', price_cents: 800, currency_code: 'USD' },
        ],
        rowCount: 2,
      })],
    ]);
  }

  test('202 with quarantine status; row starts quarantined with both jobs enqueued', async () => {
    mockUploadDb();
    captureInserts();
    const uploadSpy = jest.spyOn(storage, 'uploadFile').mockResolvedValue('restaurant-media/videos/abc.mp4');

    const app = buildApp({ user: { id: 'uploader-1' } });
    const res = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .field('caption', '  fresh pasta  ')
      .field('dish_ids', JSON.stringify([7, 7, 9]))
      .attach('file', tinyMp4Buffer(), { filename: 'clip.mp4', contentType: 'video/mp4' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      id: MEDIA_UUID, media_type: 'video_upload', processing_status: 'quarantine',
    });

    const mediaInsert = capturedInserts.find((c) => c.sql.includes('INSERT INTO restaurant_media\n'));
    expect(mediaInsert).toBeDefined();
    // Quarantine gate at the write layer: never visible until both gates pass.
    expect(mediaInsert.sql).toContain(`'video_upload'`);
    expect(mediaInsert.sql).toContain(`'upload'`);
    expect(mediaInsert.sql).toContain(`'quarantine'`);
    expect(mediaInsert.sql).toContain(`'pending'`);
    expect(mediaInsert.sql).toContain('quarantined_at');
    expect(mediaInsert.params).toEqual([42, 'uploader-1', 'restaurant-media/videos/abc.mp4', 'fresh pasta']);

    const jobInsert = capturedInserts.find((c) => c.sql.includes('INSERT INTO restaurant_media_processing_jobs'));
    expect(jobInsert.sql).toContain(`'csam_check'`);
    expect(jobInsert.sql).toContain(`'transcode'`);

    // The public list predicate (status='visible' AND processing_status='ready',
    // enforced by the list endpoint) excludes this row while it is quarantined.
    expect(mediaInsert.sql).not.toContain(`'ready'`);

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    uploadSpy.mockRestore();
  });

  test('dish snapshot validation mirrors link posts (cap 10, must belong)', async () => {
    mockUploadDb();
    const app = buildApp({ user: { id: 'uploader-dish' } });
    const tooMany = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .field('dish_ids', JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
      .attach('file', tinyMp4Buffer(), { filename: 'c.mp4', contentType: 'video/mp4' });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe('media_too_many_dishes');

    routeQueries([
      ...mockRestaurantFound(),
      ['FROM food_menu_items', () => ({ rows: [{ id: 7 }], rowCount: 1 })],
    ]);
    const notFound = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .field('dish_ids', JSON.stringify([7, 999]))
      .attach('file', tinyMp4Buffer(), { filename: 'c.mp4', contentType: 'video/mp4' });
    expect(notFound.status).toBe(400);
    expect(notFound.body.code).toBe('media_dish_not_found');
  });

  test('caption over 280 chars rejected', async () => {
    mockUploadDb();
    const app = buildApp({ user: { id: 'uploader-cap' } });
    const res = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .field('caption', 'x'.repeat(281))
      .attach('file', tinyMp4Buffer(), { filename: 'c.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_caption_too_long');
  });

  test('MIME spoof rejected (reported mp4, detected executable)', async () => {
    mockUploadDb();
    fileTypeMock.fileTypeFromBuffer.mockResolvedValue({ mime: 'application/x-sh', ext: 'sh' });
    const app = buildApp({ user: { id: 'uploader-spoof1' } });
    const res = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .attach('file', tinyMp4Buffer(), { filename: 'evil.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_file_type_not_allowed');
  });

  test('MIME mismatch rejected (reported mp4, detected webm)', async () => {
    mockUploadDb();
    fileTypeMock.fileTypeFromBuffer.mockResolvedValue({ mime: 'video/webm', ext: 'webm' });
    const app = buildApp({ user: { id: 'uploader-spoof2' } });
    const res = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .attach('file', tinyMp4Buffer(), { filename: 'clip.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_file_spoofed');
  });

  test('oversize rejected at the multer cap; never stored', async () => {
    mockUploadDb();
    const uploadSpy = jest.spyOn(storage, 'uploadFile');
    const app = buildApp({ user: { id: 'uploader-big' } });
    const res = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .attach('file', tinyMp4Buffer(2048), { filename: 'big.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('media_file_too_large');
    expect(uploadSpy).not.toHaveBeenCalled();
    uploadSpy.mockRestore();
  });

  test('scanner unavailable => 503, never stored', async () => {
    mockUploadDb();
    fileScanService.scanBuffer.mockRejectedValue(new Error('clamd down'));
    const uploadSpy = jest.spyOn(storage, 'uploadFile');
    const app = buildApp({ user: { id: 'uploader-scan1' } });
    const res = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .attach('file', tinyMp4Buffer(), { filename: 'c.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('media_scan_unavailable');
    expect(uploadSpy).not.toHaveBeenCalled();
    uploadSpy.mockRestore();
  });

  test('scanner skipped (no real scanner) => rejected, never stored', async () => {
    mockUploadDb();
    fileScanService.scanBuffer.mockResolvedValue({ clean: true, skipped: true, provider: 'static' });
    const uploadSpy = jest.spyOn(storage, 'uploadFile');
    const app = buildApp({ user: { id: 'uploader-scan2' } });
    const res = await request(app)
      .post('/api/restaurants/42/media/video-uploads')
      .attach('file', tinyMp4Buffer(), { filename: 'c.mp4', contentType: 'video/mp4' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_scan_rejected');
    expect(uploadSpy).not.toHaveBeenCalled();
    uploadSpy.mockRestore();
  });

  test('3/day rate limit: 4th upload => 429', async () => {
    mockUploadDb();
    const uploadSpy = jest.spyOn(storage, 'uploadFile').mockResolvedValue('restaurant-media/videos/x.mp4');
    const app = buildApp({ user: { id: 'uploader-limited' } });
    const codes = [];
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/restaurants/42/media/video-uploads')
        .attach('file', tinyMp4Buffer(), { filename: `c${i}.mp4`, contentType: 'video/mp4' });
      codes.push(res.status);
    }
    expect(codes).toEqual([202, 202, 202, 429]);
    uploadSpy.mockRestore();
  }, 30000);
});

// ── CSAM gate ────────────────────────────────────────────────────────────────

describe('csam gate', () => {
  const CSAM_JOB = {
    id: 'job-csam-1', media_id: MEDIA_UUID, job_type: 'csam_check',
    status: 'running', attempts: 1,
  };

  test("unavailable (no vendor keys) => job done, video stays quarantined", async () => {
    delete process.env.CSAM_VENDOR;
    const seen = [];
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      seen.push(q);
      if (q.includes('WITH next AS')) return { rows: [CSAM_JOB], rowCount: 1 };
      if (q.includes('SELECT id, storage_key')) {
        return { rows: [{ id: MEDIA_UUID, storage_key: 'k', csam_status: 'pending', processing_status: 'quarantine' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const job = await worker.runOnce();
    expect(job && job.job_type).toBe('csam_check');
    const doneUpdate = seen.find((q) => q.includes(`SET status = 'done'`));
    expect(doneUpdate).toBeDefined();
    const passUpdate = seen.find((q) => q.includes(`SET csam_status = 'pass'`));
    expect(passUpdate).toBeUndefined();
    const readyUpdate = seen.find((q) => q.includes(`processing_status = 'ready'`));
    expect(readyUpdate).toBeUndefined();
  });

  test("flagged (mocked vendor) => blocked, audit entry written, never published", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ match: true }),
    });
    process.env.CSAM_VENDOR = 'thorn';
    process.env.CSAM_THORN_API_KEY = 'test-key';

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oxsteed-csam-'));
    const filePath = path.join(tmpDir, 'clip.mp4');
    await fs.writeFile(filePath, Buffer.from('fake-video-bytes'));
    const resolveSpy = jest.spyOn(storage, 'resolveLocalStoragePath').mockReturnValue(filePath);

    const auditInserts = [];
    const mediaUpdates = [];
    const federatedUpdates = [];
    mockQuery.mockImplementation(async (sql, params) => {
      const q = String(sql);
      if (q.includes('UPDATE restaurant_media SET csam_status')) {
        mediaUpdates.push({ q, params });
        return { rows: [], rowCount: 1 };
      }
      if (q.includes('UPDATE media_posts') && q.includes('source_restaurant_media_id')) {
        federatedUpdates.push({ q, params });
        return { rows: [], rowCount: 1 };
      }
      if (q.includes('INSERT INTO admin_audit_log')) {
        auditInserts.push({ q, params });
        return { rows: [], rowCount: 1 };
      }
      if (q.trim() === 'BEGIN' || q.trim() === 'COMMIT' || q.trim() === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    try {
      const verdict = await csamCheckService.checkVideo(MEDIA_UUID, 'restaurant-media/videos/abc.mp4');
      expect(verdict).toBe('flagged');
      expect(mediaUpdates).toHaveLength(1);
      expect(mediaUpdates[0].q).toContain(`csam_status = 'flagged'`);
      // Never published: no processing_status change to 'ready' anywhere.
      expect(mediaUpdates[0].q).not.toContain('ready');
      expect(federatedUpdates).toHaveLength(1);
      expect(federatedUpdates[0].q).toContain("visibility = 'removed'");
      expect(federatedUpdates[0].params).toEqual([MEDIA_UUID]);
      expect(auditInserts).toHaveLength(1);
      const auditParams = auditInserts[0].params;
      expect(auditParams[1]).toBe('restaurant_media_csam_flagged');
      expect(auditParams[2]).toBe('restaurant_media');
      expect(auditParams[5]).toContain('never published');
    } finally {
      global.fetch = realFetch;
      resolveSpy.mockRestore();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('no vendor configured => unavailable without any network call', async () => {
    const realFetch = global.fetch;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;
    try {
      const verdict = await csamCheckService.checkVideo(MEDIA_UUID, 'k');
      expect(verdict).toBe('unavailable');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });
});

// ── Transcode worker ─────────────────────────────────────────────────────────

describe('transcode worker', () => {
  const TRANSCODE_JOB = {
    id: 'job-trans-1', media_id: MEDIA_UUID, job_type: 'transcode',
    status: 'running', attempts: 1,
  };

  async function makeRealVideo() {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oxsteed-vidtest-'));
    const srcPath = path.join(tmpDir, 'src.mp4');
    await new Promise((resolve, reject) => {
      execFile('/usr/bin/ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', srcPath,
      ], (err) => (err ? reject(err) : resolve()));
    });
    const buf = await fs.readFile(srcPath);
    const key = await storage.uploadFile(buf, 'restaurant-media/test', 'src.mp4', 'video/mp4');
    return { tmpDir, key };
  }

  test('transcode success with real ffmpeg: renditions + ready', async () => {
    const { tmpDir, key } = await makeRealVideo();
    const storedKeys = [key];
    const seen = [];
    let renditionsJson = null;
    let thumbnailKey = null;
    mockQuery.mockImplementation(async (sql, params) => {
      const q = String(sql);
      seen.push(q);
      if (q.includes('WITH next AS')) return { rows: [TRANSCODE_JOB], rowCount: 1 };
      if (q.includes('SELECT id, storage_key')) {
        return {
          rows: [{ id: MEDIA_UUID, storage_key: key, csam_status: 'pass', processing_status: 'quarantine' }],
          rowCount: 1,
        };
      }
      if (q.includes('SET renditions')) {
        renditionsJson = params[1];
        thumbnailKey = params[2];
        storedKeys.push(...JSON.parse(params[1]).map((r) => r.storage_key), params[2]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    try {
      const job = await worker.runOnce();
      expect(job && job.job_type).toBe('transcode');

      expect(renditionsJson).toBeTruthy();
      const renditions = JSON.parse(renditionsJson);
      expect(renditions).toHaveLength(2);
      // 320x240 (4:3) source -> 960x720 and 640x480.
      expect(renditions[0]).toMatchObject({ width: 960, height: 720 });
      expect(renditions[1]).toMatchObject({ width: 640, height: 480 });
      for (const r of renditions) {
        expect(typeof r.storage_key).toBe('string');
        expect(r.size_bytes).toBeGreaterThan(0);
        expect(Object.keys(r).sort()).toEqual(['height', 'size_bytes', 'storage_key', 'width']);
      }
      expect(typeof thumbnailKey).toBe('string');

      const doneUpdate = seen.find((q) => q.includes(`SET status = 'done'`));
      expect(doneUpdate).toBeDefined();
    } finally {
      for (const k of storedKeys) {
        try { await storage.deleteFile(k); } catch { /* best effort */ }
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60000);

  test('transcode skipped when csam gate has not passed', async () => {
    const seen = [];
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      seen.push(q);
      if (q.includes('WITH next AS')) return { rows: [TRANSCODE_JOB], rowCount: 1 };
      if (q.includes('SELECT id, storage_key')) {
        return {
          rows: [{ id: MEDIA_UUID, storage_key: 'k', csam_status: 'pending', processing_status: 'quarantine' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const job = await worker.runOnce();
    expect(job && job.job_type).toBe('transcode');
    // Job left queued; no ffmpeg work, no ready/failed transition.
    const requeued = seen.find((q) => q.includes(`SET status = 'queued'`));
    expect(requeued).toBeDefined();
    expect(seen.find((q) => q.includes(`processing_status = 'ready'`))).toBeUndefined();
    expect(seen.find((q) => q.includes(`processing_status = 'failed'`))).toBeUndefined();
  });

  test('idempotent re-run of a done job is a no-op', async () => {
    let calls = 0;
    mockQuery.mockImplementation(async (sql) => {
      calls += 1;
      if (String(sql).includes('FROM restaurant_media_processing_jobs WHERE id')) {
        return { rows: [{ id: 'job-done', status: 'done', job_type: 'transcode' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const result = await worker.processJobById('job-done');
    expect(result).toMatchObject({ processed: false, reason: 'already_done' });
    expect(calls).toBe(1);
  });

  test('worker does not start when VIDEO_WORKER_ENABLED is not 1', () => {
    delete process.env.VIDEO_WORKER_ENABLED;
    expect(worker.startVideoTranscodeWorker()).toMatchObject({ started: false, reason: 'disabled' });
    expect(worker.ffmpegAvailable()).toBe(true); // /usr/bin/ffmpeg exists
  });

  test('worker starts when enabled and ffmpeg exists', () => {
    process.env.VIDEO_WORKER_ENABLED = '1';
    try {
      const res = worker.startVideoTranscodeWorker();
      expect(res.started).toBe(true);
    } finally {
      worker.stopVideoTranscodeWorker();
      delete process.env.VIDEO_WORKER_ENABLED;
    }
  });
});

// ── Retry endpoint ───────────────────────────────────────────────────────────

describe('POST retry', () => {
  function mockRetryDb({ mediaRow, failedJobs }) {
    routeQueries([
      ['SELECT id, user_id, media_type, processing_status', () => ({ rows: [mediaRow], rowCount: 1 })],
      ['FROM restaurant_media\n          WHERE id = $1 FOR UPDATE', () => ({
        rows: [{ id: mediaRow.id, processing_status: mediaRow.processing_status, csam_status: mediaRow.csam_status }],
        rowCount: 1,
      })],
      ['FROM restaurant_media_processing_jobs\n          WHERE media_id', () => ({
        rows: failedJobs, rowCount: failedJobs.length,
      })],
      ['INSERT INTO restaurant_media_processing_jobs', () => ({ rows: [], rowCount: 1 })],
    ]);
  }

  test('failed => requeued; csam failure resets csam_status to pending', async () => {
    mockRetryDb({
      mediaRow: {
        id: MEDIA_UUID, user_id: 'uploader-1', media_type: 'video_upload',
        processing_status: 'failed', csam_status: 'pending', processing_error: 'boom',
      },
      failedJobs: [{ job_type: 'csam_check' }],
    });
    captureInserts();
    const app = buildApp({ user: { id: 'uploader-1' } });
    const res = await request(app).post(`/api/restaurants/42/media/${MEDIA_UUID}/retry`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: MEDIA_UUID, processing_status: 'quarantine', csam_status: 'pending', retried: true,
    });
    const reset = capturedInserts.find((c) => c.sql.includes(`processing_status = 'quarantine'`));
    expect(reset).toBeDefined();
    expect(reset.params).toEqual([MEDIA_UUID, 'pending']);
    const requeue = capturedInserts.find((c) => c.sql.includes('INSERT INTO restaurant_media_processing_jobs'));
    expect(requeue.params).toEqual([MEDIA_UUID, 'csam_check']);
  });

  test('retry is idempotent: non-failed video returns current state', async () => {
    routeQueries([
      ['SELECT id, user_id, media_type, processing_status', () => ({
        rows: [{
          id: MEDIA_UUID, user_id: 'uploader-1', media_type: 'video_upload',
          processing_status: 'quarantine', csam_status: 'pending', processing_error: null,
        }],
        rowCount: 1,
      })],
      ['WHERE id = $1 FOR UPDATE', () => ({
        rows: [{ id: MEDIA_UUID, processing_status: 'quarantine', csam_status: 'pending' }],
        rowCount: 1,
      })],
      ['AND job_type = \'csam_check\'', () => ({ rows: [], rowCount: 0 })],
      ['INSERT INTO restaurant_media_processing_jobs', () => ({ rows: [], rowCount: 1 })],
    ]);
    const app = buildApp({ user: { id: 'uploader-1' } });
    const res = await request(app).post(`/api/restaurants/42/media/${MEDIA_UUID}/retry`);
    expect(res.status).toBe(200);
    // No active csam job + quarantine/pending => the unavailable check is re-queued.
    expect(res.body).toMatchObject({ processing_status: 'quarantine', retried: true });
  });

  test('non-owner => 403', async () => {
    routeQueries([
      ['SELECT id, user_id, media_type, processing_status', () => ({
        rows: [{
          id: MEDIA_UUID, user_id: 'someone-else', media_type: 'video_upload',
          processing_status: 'failed', csam_status: 'pending', processing_error: null,
        }],
        rowCount: 1,
      })],
      ['FROM food_restaurants fr', () => ({ rows: [], rowCount: 0 })],
    ]);
    const app = buildApp({ user: { id: 'stranger' } });
    const res = await request(app).post(`/api/restaurants/42/media/${MEDIA_UUID}/retry`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('media_forbidden');
  });

  test('flagged video cannot be retried', async () => {
    routeQueries([
      ['SELECT id, user_id, media_type, processing_status', () => ({
        rows: [{
          id: MEDIA_UUID, user_id: 'uploader-1', media_type: 'video_upload',
          processing_status: 'quarantine', csam_status: 'flagged', processing_error: null,
        }],
        rowCount: 1,
      })],
    ]);
    const app = buildApp({ user: { id: 'uploader-1' } });
    const res = await request(app).post(`/api/restaurants/42/media/${MEDIA_UUID}/retry`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('media_csam_blocked');
  });
});

// ── DMCA takedown ────────────────────────────────────────────────────────────

describe('DMCA takedown review', () => {
  test('remove + takedownReason dmca hides media, records DMCA, audits', async () => {
    const seen = [];
    const auditParams = [];
    mockQuery.mockImplementation(async (sql, params) => {
      const q = String(sql);
      seen.push(q);
      if (q.includes('FROM restaurant_media_flags WHERE id')) {
        return { rows: [{ id: 'flag-1', media_id: MEDIA_UUID, status: 'open' }], rowCount: 1 };
      }
      if (q.includes('FROM restaurant_media WHERE id')) {
        return { rows: [{ id: MEDIA_UUID, status: 'visible', media_type: 'video_upload' }], rowCount: 1 };
      }
      if (q.includes('INSERT INTO admin_audit_log')) {
        auditParams.push(params);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const req = {
      params: { flagId: 'flag-1' },
      body: { action: 'remove', takedownReason: 'dmca' },
      user: { id: 'admin-1' },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await videoCtrl.adminDmcaTakedownReview(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, takedown: 'dmca' });

    const hide = seen.find((q) => q.includes(`UPDATE restaurant_media SET status = 'hidden'`));
    expect(hide).toBeDefined();
    const reviewNote = seen.find((q) => q.includes(`note = 'DMCA takedown'`));
    expect(reviewNote).toBeDefined();
    const resolveAll = seen.filter((q) => q.includes(`SET status = 'resolved'`));
    expect(resolveAll.length).toBe(2);

    expect(auditParams).toHaveLength(1);
    const p = auditParams[0];
    expect(p[1]).toBe('restaurant_media_remove');
    expect(p[2]).toBe('restaurant_media');
    expect(p[5]).toContain('DMCA takedown');
  });

  test('already-decided flag => 409', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM restaurant_media_flags WHERE id')) {
        return { rows: [{ id: 'flag-1', media_id: MEDIA_UUID, status: 'resolved' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const req = {
      params: { flagId: 'flag-1' }, body: { action: 'remove', takedownReason: 'dmca' },
      user: { id: 'admin-1' }, ip: '127.0.0.1', headers: {},
    };
    const next = jest.fn();
    await videoCtrl.adminDmcaTakedownReview(req, { json: jest.fn() }, next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.code).toBe('media_flag_already_decided');
    expect(err.statusCode).toBe(409);
  });
});
