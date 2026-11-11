'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/storage', () => ({
  resolveLocalStoragePath: jest.fn(),
  downloadObjectToFile: jest.fn(),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
}));
jest.mock('../services/videoTranscodeWorker', () => ({
  sanitizeError: error => String(error || 'worker error'),
  ffmpegAvailable: jest.fn(() => true),
  probeDimensions: jest.fn(),
  transcodeOriginal: jest.fn(),
  requireStorageKey: jest.fn((key, label) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error(`${label} storage is unavailable`);
    return key;
  }),
}));
jest.mock('../services/csamCheckService', () => ({ checkMediaVideo: jest.fn() }));
jest.mock('../services/mediaDraftAttachments', () => ({ refreshPostState: jest.fn() }));

const pool = require('../db');
const storage = require('../utils/storage');
const worker = require('../services/mediaTranscodeWorker');
const restaurantWorker = require('../services/videoTranscodeWorker');

beforeEach(() => {
  pool.query.mockReset();
  restaurantWorker.ffmpegAvailable.mockReturnValue(true);
  restaurantWorker.probeDimensions.mockReset();
  restaurantWorker.transcodeOriginal.mockReset();
  storage.resolveLocalStoragePath.mockReset();
  storage.uploadFile.mockReset();
  storage.deleteFile.mockReset();
});

test('claims expired leases and fences completion to the lease token', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 'job', asset_id: 'asset', job_type: 'csam_check', lease_token: 'lease-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'asset', post_id: 'post', csam_status: 'passed', processing_status: 'ready',
      post_csam_status: 'passed', post_processing_status: 'ready', visibility: 'unlisted', deleted_at: null }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });

  await worker.runOnce();
  const [claimSql] = pool.query.mock.calls[0];
  expect(claimSql).toContain("j.status = 'running' AND j.lease_expires_at < NOW()");
  expect(claimSql).toContain('j.attempts < COALESCE(j.max_attempts, 5)');
  const [doneSql, doneParams] = pool.query.mock.calls[2];
  expect(doneSql).toContain('lease_token = NULL');
  expect(doneSql).toContain('AND lease_token = $2');
  expect(doneParams).toEqual(['job', 'lease-1']);
});

test('worker failures clear the lease and schedule bounded retry', async () => {
  restaurantWorker.ffmpegAvailable.mockReturnValue(false);
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 'job', asset_id: 'asset', job_type: 'transcode', lease_token: 'lease-2' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'asset', post_id: 'post', csam_status: 'cloudflare_deferred', processing_status: 'quarantine',
      post_csam_status: 'cloudflare_deferred', post_processing_status: 'quarantine', visibility: 'unlisted', deleted_at: null }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });

  await worker.runOnce();
  const [failureSql, failureParams] = pool.query.mock.calls[2];
  expect(failureSql).toContain("CASE WHEN attempts < COALESCE(max_attempts, 5) THEN 'pending' ELSE 'failed' END");
  expect(failureSql).toContain('next_attempt_at');
  expect(failureSql).toContain('AND lease_token = $3');
  expect(failureParams).toEqual(['job', 'ffmpeg unavailable', 'lease-2']);
});

test('transcode storage outages fail the asset instead of publishing null rendition keys', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-media-worker-test-'));
  const sourcePath = path.join(tmpDir, 'source.mp4');
  const outputPath = path.join(tmpDir, 'rendition.mp4');
  const posterPath = path.join(tmpDir, 'poster.jpg');
  fs.writeFileSync(sourcePath, 'source');
  fs.writeFileSync(outputPath, 'rendition');
  fs.writeFileSync(posterPath, 'poster');
  const job = { id: 'job-storage', asset_id: 'asset-storage', job_type: 'transcode', lease_token: 'lease-storage' };

  pool.query
    .mockResolvedValueOnce({ rows: [{
      id: 'asset-storage', post_id: 'post-storage', storage_key: 'private/source.mp4',
      csam_status: 'cloudflare_deferred', processing_status: 'quarantine',
      post_csam_status: 'cloudflare_deferred', post_processing_status: 'ready',
      visibility: 'unlisted', deleted_at: null,
    }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });
  storage.resolveLocalStoragePath.mockReturnValue(sourcePath);
  storage.uploadFile.mockResolvedValue(null);
  restaurantWorker.probeDimensions.mockResolvedValue({ w: 320, h: 240 });
  restaurantWorker.transcodeOriginal.mockResolvedValue({
    outputs: [{ path: outputPath, height: 720, width: 960, contentType: 'video/mp4' }],
    posterPath,
  });

  try {
    await worker.processTranscode(job);

    expect(pool.query.mock.calls[1][0]).toContain('SET processing_status = \'failed\'');
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('SET renditions'))).toBe(false);
    expect(storage.deleteFile).not.toHaveBeenCalled();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('flagged CSAM verdict completes the leased scan without publishing the asset', async () => {
  const csam = require('../services/csamCheckService');
  const previousMode = process.env.MEDIA_CSAM_MODE;
  const previousCertified = process.env.MEDIA_CSAM_CERTIFIED;
  process.env.MEDIA_CSAM_MODE = 'vendor';
  process.env.MEDIA_CSAM_CERTIFIED = 'true';
  csam.checkMediaVideo.mockResolvedValue('flagged');
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 'job', asset_id: 'asset', job_type: 'csam_check', lease_token: 'lease-flagged' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'asset', post_id: 'post', storage_key: 'private/video.mp4',
      csam_status: 'pending', processing_status: 'quarantine', post_csam_status: 'pending',
      post_processing_status: 'quarantine', visibility: 'unlisted', deleted_at: null }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });

  try {
    await worker.runOnce();

    expect(csam.checkMediaVideo).toHaveBeenCalledWith('asset', 'post', 'private/video.mp4');
    const [doneSql, doneParams] = pool.query.mock.calls[2];
    expect(doneSql).toContain("SET status = 'done'");
    expect(doneSql).toContain('AND lease_token = $2');
    expect(doneParams).toEqual(['job', 'lease-flagged']);
  } finally {
    if (previousMode === undefined) delete process.env.MEDIA_CSAM_MODE;
    else process.env.MEDIA_CSAM_MODE = previousMode;
    if (previousCertified === undefined) delete process.env.MEDIA_CSAM_CERTIFIED;
    else process.env.MEDIA_CSAM_CERTIFIED = previousCertified;
  }
});

test('keeps a stale worker from resetting a newer CSAM lease', async () => {
  const previousMode = process.env.MEDIA_CSAM_MODE;
  const previousCertified = process.env.MEDIA_CSAM_CERTIFIED;
  process.env.MEDIA_CSAM_MODE = 'vendor';
  process.env.MEDIA_CSAM_CERTIFIED = 'false';
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 'job', asset_id: 'asset', job_type: 'csam_check', lease_token: 'lease-current' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'asset', post_id: 'post', csam_status: 'pending', processing_status: 'quarantine',
      post_csam_status: 'pending', post_processing_status: 'quarantine', visibility: 'unlisted', deleted_at: null }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });

  try {
    await worker.runOnce();

    const [resetSql, resetParams] = pool.query.mock.calls[2];
    expect(resetSql).toContain('AND lease_token = $3');
    expect(resetParams).toEqual(['job', 'Media safety mode is disabled or vendor is not certified', 'lease-current']);
  } finally {
    if (previousMode === undefined) delete process.env.MEDIA_CSAM_MODE;
    else process.env.MEDIA_CSAM_MODE = previousMode;
    if (previousCertified === undefined) delete process.env.MEDIA_CSAM_CERTIFIED;
    else process.env.MEDIA_CSAM_CERTIFIED = previousCertified;
  }
});
