'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/storage', () => ({
  resolveLocalStoragePath: jest.fn(), downloadObjectToFile: jest.fn(),
  uploadFile: jest.fn(async (_buffer, prefix, name) => `${prefix}/${name}`),
  deleteFile: jest.fn(), getSignedDownloadUrl: jest.fn(async (key) => `/signed/${key}`),
}));
jest.mock('../services/csamCheckService', () => ({ checkMediaVideo: jest.fn() }));
jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn(async () => ({ mime: 'video/mp4' })) }));
jest.mock('../services/fileScanService', () => ({ scanBuffer: jest.fn() }));
jest.mock('../services/videoTranscodeWorker', () => ({
  ffmpegAvailable: jest.fn(() => true), probeDimensions: jest.fn(async () => ({ width: 640, height: 480 })),
  transcodeOriginal: jest.fn(), sanitizeError: jest.fn((message) => message),
}));
const pool = require('../db');
const storage = require('../utils/storage');
const csam = require('../services/csamCheckService');
const converter = require('../services/videoTranscodeWorker');
const worker = require('../services/mediaTranscodeWorker');
const policy = require('../services/mediaSafetyPolicy');
const media = require('../controllers/mediaController');
const uploads = require('../controllers/mediaAssetController');
const scanner = require('../services/fileScanService');

const originalMode = process.env.MEDIA_CSAM_MODE;
const originalCertified = process.env.MEDIA_CSAM_CERTIFIED;
let sourceDir;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.MEDIA_CSAM_MODE = 'cloudflare';
  process.env.MEDIA_CSAM_CERTIFIED = 'false';
});
afterEach(async () => {
  if (sourceDir) await fs.rm(sourceDir, { recursive: true, force: true });
  sourceDir = null;
});
afterAll(() => {
  if (originalMode === undefined) delete process.env.MEDIA_CSAM_MODE;
  else process.env.MEDIA_CSAM_MODE = originalMode;
  if (originalCertified === undefined) delete process.env.MEDIA_CSAM_CERTIFIED;
  else process.env.MEDIA_CSAM_CERTIFIED = originalCertified;
});

function response() { return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }; }
function clearedAsset() {
  return { id: 'asset', post_id: 'post', asset_type: 'video', storage_key: 'original.mp4',
    processing_status: 'ready', csam_status: 'cloudflare_deferred', renditions: [{ storage_key: 'ready.mp4' }] };
}

test('new installs default to interim mode; certified installs keep vendor mode; unknown settings fail closed', () => {
  delete process.env.MEDIA_CSAM_MODE;
  expect(policy.mode()).toBe('cloudflare');
  expect(policy.assetReady(clearedAsset())).toBe(true);
  process.env.MEDIA_CSAM_CERTIFIED = 'true';
  expect(policy.mode()).toBe('vendor');
  expect(policy.assetReady(clearedAsset())).toBe(false);
  for (const mode of ['disabled', 'typo']) {
    process.env.MEDIA_CSAM_MODE = mode;
    expect(policy.videoAllowed()).toBe(false);
    expect(policy.assetReady({ ...clearedAsset(), csam_status: 'passed' })).toBe(false);
  }
});

test('public capabilities report the effective policy without credentials', async () => {
  const app = express();
  app.use('/api/media', require('../routes/media'));
  const res = await request(app).get('/api/media/capabilities');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body).toEqual({
    video_safety_mode: 'cloudflare', video_policy_allows_publication: true,
    upload_identity_required: true, malware_scan_required: true, transcode_required: true,
  });
});

test.each([
  [{ clean: true, provider: 'clamav' }, 202],
  [{ clean: false, provider: 'clamav' }, 400],
  [{ clean: true, provider: 'static', skipped: true }, 503],
  [new Error('Scanner unavailable'), 503],
])('interim video upload still requires a real clean malware scan %#', async (scan, expected) => {
  sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-upload-policy-test-'));
  const original = path.join(sourceDir, 'original.mp4');
  await fs.writeFile(original, 'harmless mock upload');
  pool.query.mockImplementation(async (sql) => ({ rows: sql.includes('identity_verified')
    ? [{ identity_verified: true }] : [{ id: 'post' }] }));
  if (scan instanceof Error) scanner.scanBuffer.mockRejectedValueOnce(scan);
  else scanner.scanBuffer.mockResolvedValueOnce(scan);
  const client = { query: jest.fn(async (sql) => ({ rows: sql.includes('INSERT INTO media_post_assets')
    ? [{ ...clearedAsset(), processing_status: 'quarantine', csam_status: 'pending' }] : [] })), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  const res = response();
  await uploads.videoUpload({ user: { id: 'owner' }, body: { post_id: 'post' },
    file: { path: original, mimetype: 'video/mp4', originalname: 'original.mp4' } }, res);
  expect(res.status).toHaveBeenCalledWith(expected);
  if (expected === 202) {
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      safety_mode: 'cloudflare', public_video_available: true, status: 'quarantine',
      asset: expect.objectContaining({ csam_status: 'pending', processing_status: 'quarantine' }),
    }));
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  } else {
    expect(pool.connect).not.toHaveBeenCalled();
    expect(storage.uploadFile).not.toHaveBeenCalled();
  }
  await expect(fs.access(original)).rejects.toThrow();
});

test('interim worker processes a pending original without fabricating a vendor pass', async () => {
  sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-policy-test-'));
  const original = path.join(sourceDir, 'original.mp4');
  await fs.writeFile(original, 'harmless test fixture');
  storage.resolveLocalStoragePath.mockReturnValue(original);
  converter.transcodeOriginal.mockImplementation(async ({ tmpDir }) => {
    const video = path.join(tmpDir, 'ready.mp4');
    const poster = path.join(tmpDir, 'poster.jpg');
    await fs.writeFile(video, 'test rendition');
    await fs.writeFile(poster, 'test poster');
    return { outputs: [{ path: video, height: 480, width: 640, contentType: 'video/mp4' }], posterPath: poster };
  });
  const asset = { ...clearedAsset(), processing_status: 'quarantine', csam_status: 'pending',
    post_csam_status: 'pending', post_processing_status: 'quarantine', visibility: 'unlisted' };
  const jobs = [{ id: 'scan', asset_id: 'asset', job_type: 'csam_check' }, { id: 'convert', asset_id: 'asset', job_type: 'transcode' }];
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('WITH next AS')) return { rows: [jobs.shift()].filter(Boolean) };
    if (sql.includes('SELECT a.id')) return { rows: [asset] };
    if (sql.includes("SET csam_status = 'cloudflare_deferred'")) asset.csam_status = 'cloudflare_deferred';
    if (sql.includes('SET renditions')) asset.processing_status = 'ready';
    if (sql.includes('UPDATE media_posts p SET')) asset.post_csam_status = asset.csam_status;
    return { rows: [] };
  });
  await worker.runOnce();
  await worker.runOnce();
  expect(csam.checkMediaVideo).not.toHaveBeenCalled();
  expect(converter.transcodeOriginal).toHaveBeenCalledTimes(1);
  expect(asset).toMatchObject({ processing_status: 'ready', csam_status: 'cloudflare_deferred' });
  expect(pool.query.mock.calls.some(([sql]) => /SET csam_status = 'passed'/.test(sql))).toBe(false);
  expect(policy.assetReady(asset)).toBe(true);
});

test.each(['flagged', 'unavailable'])('interim processing never clears an existing %s verdict', async (status) => {
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('WITH next AS')) return { rows: [{ id: 'scan', asset_id: 'asset', job_type: 'csam_check' }] };
    if (sql.includes('SELECT a.id')) return { rows: [{ ...clearedAsset(), csam_status: status }] };
    return { rows: [] };
  });
  await worker.runOnce();
  expect(pool.query.mock.calls.some(([sql]) => sql.includes('UPDATE media_post_assets'))).toBe(false);
  expect(csam.checkMediaVideo).not.toHaveBeenCalled();
});

test('conversion failure updates the draft state so the owner can replace the file', async () => {
  sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-convert-failure-test-'));
  const original = path.join(sourceDir, 'original.mp4');
  await fs.writeFile(original, 'harmless fixture');
  storage.resolveLocalStoragePath.mockReturnValue(original);
  converter.transcodeOriginal.mockRejectedValueOnce(new Error('Conversion failed'));
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('WITH next AS')) return { rows: [{ id: 'convert', asset_id: 'asset', job_type: 'transcode' }] };
    if (sql.includes('SELECT a.id')) return { rows: [{ ...clearedAsset(), processing_status: 'quarantine',
      post_csam_status: 'cloudflare_deferred', post_processing_status: 'quarantine', visibility: 'unlisted' }] };
    return { rows: [] };
  });
  await worker.runOnce();
  const queries = pool.query.mock.calls.map(([sql]) => sql);
  expect(queries.some((sql) => sql.includes("SET processing_status = 'failed'"))).toBe(true);
  expect(queries.some((sql) => sql.includes('UPDATE media_posts p SET'))).toBe(true);
  expect(queries.some((sql) => sql.includes("SET visibility = 'public'"))).toBe(false);
});

test('future vendor mode waits for certification and does not transcode an interim asset', async () => {
  process.env.MEDIA_CSAM_MODE = 'vendor';
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('WITH next AS')) return { rows: [{ id: 'scan', asset_id: 'asset', job_type: 'csam_check' }] };
    if (sql.includes('SELECT a.id')) return { rows: [{ ...clearedAsset(), csam_status: 'pending' }] };
    return { rows: [] };
  });
  await worker.runOnce();
  expect(csam.checkMediaVideo).not.toHaveBeenCalled();
  expect(converter.transcodeOriginal).not.toHaveBeenCalled();
  expect(policy.assetReady(clearedAsset())).toBe(false);
});

test.each(['pass', 'unavailable', 'flagged'])('certified vendor mode handles %s without falling back to Cloudflare', async (verdict) => {
  process.env.MEDIA_CSAM_MODE = 'vendor';
  process.env.MEDIA_CSAM_CERTIFIED = 'true';
  csam.checkMediaVideo.mockResolvedValue(verdict);
  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('WITH next AS')) return { rows: [{ id: 'scan', asset_id: 'asset', job_type: 'csam_check' }] };
    if (sql.includes('SELECT a.id')) return { rows: [{ ...clearedAsset(), csam_status: 'pending' }] };
    return { rows: [] };
  });
  await worker.runOnce();
  expect(csam.checkMediaVideo).toHaveBeenCalledTimes(1);
  expect(pool.query.mock.calls.some(([sql]) => sql.includes("SET csam_status = 'passed'"))).toBe(verdict === 'pass');
  expect(pool.query.mock.calls.some(([sql]) => sql.includes("SET csam_status = 'cloudflare_deferred'"))).toBe(false);
});

test.each([
  ['cloudflare', true, 'cloudflare_deferred', 'ready', [{ storage_key: 'ready.mp4' }], 200],
  ['vendor', true, 'cloudflare_deferred', 'ready', [{ storage_key: 'ready.mp4' }], 409],
  ['cloudflare', false, 'cloudflare_deferred', 'ready', [{ storage_key: 'ready.mp4' }], 409],
  ['cloudflare', true, 'flagged', 'ready', [{ storage_key: 'ready.mp4' }], 409],
  ['cloudflare', true, 'cloudflare_deferred', 'quarantine', [{ storage_key: 'ready.mp4' }], 409],
  ['cloudflare', true, 'cloudflare_deferred', 'ready', [], 409],
])('draft publication honors mode=%s identity=%s verdict=%s processing=%s', async (mode, identity, verdict, processing, renditions, expected) => {
  process.env.MEDIA_CSAM_MODE = mode;
  const post = { id: 'post', visibility: 'unlisted', processing_status: processing, csam_status: verdict,
    current_actor_verified: true, identity_verified: identity };
  const asset = { ...clearedAsset(), csam_status: verdict, processing_status: processing, renditions };
  const client = { query: jest.fn(async (sql) => {
    if (sql.includes('SELECT p.*')) return { rows: [post] };
    if (sql.includes('SELECT id, asset_type')) return { rows: [asset] };
    if (sql.includes('UPDATE media_posts')) return { rows: [{ ...post, visibility: 'public' }] };
    return { rows: [] };
  }), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  pool.query.mockImplementation(async () => ({ rows: [] }));
  const res = response();
  await media.publishPost({ params: { id: 'post' }, user: { id: 'owner' } }, res);
  if (expected === 200) {
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ published: true }));
  } else {
    expect(res.status).toHaveBeenCalledWith(409);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE media_posts'))).toBe(false);
  }
});
