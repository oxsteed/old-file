'use strict';
jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../utils/storage', () => ({ uploadFile: jest.fn(), deleteFile: jest.fn(), getSignedDownloadUrl: jest.fn() }));
jest.mock('file-type', () => ({ fileTypeFromBuffer: jest.fn(async () => ({ mime: 'image/jpeg' })) }));
jest.mock('../services/fileScanService', () => ({ scanBuffer: jest.fn(async () => ({ clean: true, provider: 'clamav' })) }));
const sharp = require('sharp');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const storage = require('../utils/storage');
const uploads = require('../controllers/mediaAssetController');
let draft;
let client;
let committed;
let photo;
let app;
beforeAll(async () => { photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'orange' } }).jpeg().toBuffer(); });
beforeEach(() => {
  jest.clearAllMocks();
  committed = false;
  draft = { id: 'draft', visibility: 'unlisted', csam_status: 'passed', processing_status: 'draft', is_verified: true };
  client = { release: jest.fn(), query: jest.fn(async (sql) => {
    if (sql.includes('SELECT p.id')) return { rows: [draft] };
    if (sql.includes('INSERT INTO media_post_assets')) return { rows: [{ id: 'asset', storage_key: 'original.jpg', thumbnail_key: 'thumb.jpg' }] };
    if (sql === 'COMMIT') committed = true;
    return { rows: [] };
  }) };
  pool.query.mockImplementation(async (sql) => ({ rows: sql.includes('SELECT p.id') ? [{ ...draft }] :
    committed ? [{ storage_key: 'original.jpg', thumbnail_key: 'thumb.jpg' }] : [] }));
  pool.connect.mockResolvedValue(client);
  storage.uploadFile.mockReset().mockResolvedValueOnce('original.jpg').mockResolvedValueOnce('thumb.jpg');
  storage.getSignedDownloadUrl.mockReset().mockImplementation(async key => `/signed/${key}`);
  app = express();
  app.post('/photos', (req, _res, next) => { req.user = { id: 'owner' }; next(); },
    uploads.mediaPhotoUploadHandler, uploads.uploadPhoto);
});
const send = () => request(app).post('/photos').field('post_id', 'draft').field('replace_assets', 'true')
  .attach('file', photo, { filename: 'photo.jpg', contentType: 'image/jpeg' });

test('a thumbnail-storage failure cleans up the already-stored original', async () => {
  storage.uploadFile.mockReset().mockResolvedValueOnce('original.jpg').mockRejectedValueOnce(new Error('Unavailable storage'));
  expect((await send()).status).toBe(500);
  expect(storage.deleteFile).toHaveBeenCalledWith('original.jpg');
  expect(pool.connect).not.toHaveBeenCalled();
});
test('URL-signing failure after persistence preserves committed files for retry', async () => {
  storage.getSignedDownloadUrl.mockRejectedValueOnce(new Error('Signing unavailable'));
  expect((await send()).status).toBe(500);
  expect(committed).toBe(true);
  expect(storage.deleteFile).not.toHaveBeenCalled();
});
test('publication during scanning fails the locked recheck and cleans unused objects', async () => {
  client.query.mockImplementation(async sql => ({ rows: sql.includes('SELECT p.id') ? [{ ...draft, visibility: 'public' }] : [] }));
  const result = await send();
  expect(result.status).toBe(409);
  expect(result.body.code).toBe('media_draft_required');
  expect(storage.deleteFile).toHaveBeenCalledWith('original.jpg');
  expect(storage.deleteFile).toHaveBeenCalledWith('thumb.jpg');
});
test('uncertain commit response checks durable references before cleanup', async () => {
  const previous = client.query.getMockImplementation();
  client.query.mockImplementation(async sql => {
    if (sql === 'COMMIT') { committed = true; throw new Error('Lost commit response'); }
    return previous(sql);
  });
  expect((await send()).status).toBe(500);
  expect(committed).toBe(true);
  expect(storage.deleteFile).not.toHaveBeenCalled();
});
test('cleanup defers when persistence cannot be determined during an outage', async () => {
  storage.uploadFile.mockReset().mockResolvedValueOnce('original.jpg').mockRejectedValueOnce(new Error('Storage outage'));
  pool.query.mockImplementation(async sql => {
    if (sql.includes('SELECT p.id')) return { rows: [draft] };
    throw new Error('DB outage');
  });
  expect((await send()).status).toBe(500);
  expect(storage.deleteFile).not.toHaveBeenCalled();
});
