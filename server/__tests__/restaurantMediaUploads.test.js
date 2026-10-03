'use strict';

const express = require('express');
const request = require('supertest');
const multer = require('multer');
const sharp = require('sharp');
const { mockQuery, resetMocks } = require('./setup');
const mediaController = require('../controllers/restaurantMediaController');
const fileScanService = require('../services/fileScanService');
const storage = require('../utils/storage');
const { fileTypeFromBuffer } = require('file-type');
const { stripExif, stripExifFallback, isSharpAvailable } = require('../utils/stripExif');

jest.mock('../services/fileScanService');
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(async (buffer, folder, name) => `mock-key/${name}`),
  getSignedDownloadUrl: jest.fn(
    async (key) => `/api/storage/files/${encodeURIComponent(key)}?exp=9999999999&sig=testsig`
  ),
  deleteFile: jest.fn(async () => {}),
}));

const RESTAURANT_ROW = { id: 42, business_id: 7, owner_user_id: 'user-owner' };
const EXIF_SIG = Buffer.from('Exif\0\0', 'ascii');

let userSeq = 0;
function buildApp({ user, extraUserFields = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = user === undefined ? { id: `photo-user-${++userSeq}` } : user;
    if (u) {
      req.user = { ...u, ...extraUserFields };
      if (extraUserFields.isAdmin) req.isAdmin = true;
      if (extraUserFields.isSuperAdmin) req.isSuperAdmin = true;
    }
    next();
  });

  app.get('/api/restaurants/:restaurantId/media', mediaController.listRestaurantMedia);
  app.get('/api/restaurants/:restaurantId/media/mine', mediaController.listMyRestaurantMedia);
  app.post('/api/restaurants/:restaurantId/media/photo-uploads',
    mediaController.mediaSubmitLimiter,
    mediaController.photoUpload,
    mediaController.postRestaurantMediaPhoto);

  // Mirrors server/middleware/errorHandler.js for MulterError mapping.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({
        code: tooLarge ? 'file_too_large' : 'invalid_upload',
        message: err.message,
      });
    }
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
    });
  });

  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function jpegWithGpsExif() {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 200, b: 30 } },
  })
    .withMetadata({
      exif: {
        IFD0: { Copyright: 'exif-proof' },
        GPS: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '40/1 26/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '74/1 0/1 0/1',
        },
      },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function plainPng() {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
  }).png().toBuffer();
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Splice a tEXt metadata chunk into a PNG (sharp never writes one, so the
// fixture proves the fallback actually removes metadata).
function pngWithTextChunk(png) {
  const keyword = Buffer.from('Title\0sneaky-metadata', 'ascii');
  const chunk = Buffer.alloc(12 + keyword.length);
  chunk.writeUInt32BE(keyword.length, 0);
  chunk.write('tEXt', 4);
  keyword.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + keyword.length)), 8 + keyword.length);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

// Append an EXIF chunk to a WebP RIFF container, fixing the RIFF size.
function webpWithExifChunk(webp) {
  const exifData = Buffer.concat([EXIF_SIG, Buffer.from('A'.repeat(16), 'ascii')]);
  const chunk = Buffer.alloc(8 + exifData.length + (exifData.length % 2));
  chunk.write('EXIF', 0);
  chunk.writeUInt32LE(exifData.length, 4);
  exifData.copy(chunk, 8);
  const out = Buffer.concat([webp, chunk]);
  out.writeUInt32LE(webp.readUInt32LE(4) + chunk.length, 4);
  return out;
}

function mockSuccessfulPhotoPost({ caption = 'Great noodles', dishRows = [], dishIds = [] } = {}) {
  const mediaRow = {
    id: 'media-1', media_type: 'photo_upload', provider: 'upload', caption,
    storage_key: 'mock-key/photo.jpg', thumbnail_key: 'mock-key/thumb.jpg',
    processing_status: 'ready', created_at: new Date().toISOString(),
  };
  mockQuery.mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }); // getPublicRestaurant
  if (dishIds.length) {
    mockQuery.mockResolvedValueOnce({ rows: dishRows }); // dish lookup (skipped when no dish_ids)
  }
  mockQuery.mockResolvedValueOnce({}); // BEGIN
  mockQuery.mockResolvedValueOnce({ rows: [mediaRow] }); // INSERT media
  if (dishRows.length) {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT media_items (skipped when no dishes)
  }
  mockQuery.mockResolvedValueOnce({}); // COMMIT
  return mediaRow;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  fileTypeFromBuffer.mockReset();
  fileTypeFromBuffer.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
  fileScanService.scanBuffer.mockReset();
  fileScanService.scanBuffer.mockResolvedValue({ clean: true, skipped: false, provider: 'clamav' });
});

// ── stripExif: bytes-level proof ─────────────────────────────────────────────

describe('stripExif', () => {
  test('sharp is available (primary path under test)', () => {
    expect(isSharpAvailable()).toBe(true);
  });

  test('strips EXIF/GPS from a JPEG: bytes proof', async () => {
    const input = await jpegWithGpsExif();
    // Proof the fixture really carries EXIF: the APP1 marker is present and
    // sharp's parser sees the EXIF segment.
    expect(input.includes(EXIF_SIG)).toBe(true);
    expect((await sharp(input).metadata()).exif.length).toBeGreaterThan(0);

    const output = await stripExif(input);

    expect(output.includes(EXIF_SIG)).toBe(false);
    expect((await sharp(output).metadata()).exif || null).toBeNull();
    // The pixels survive: still a decodable JPEG.
    expect((await sharp(output).metadata()).format).toBe('jpeg');
  });

  test('pure-JS fallback strips EXIF/GPS from a JPEG: bytes proof', async () => {
    const input = await jpegWithGpsExif();
    expect(input.includes(EXIF_SIG)).toBe(true);

    const output = await stripExifFallback(input);

    expect(output.includes(EXIF_SIG)).toBe(false);
    expect((await sharp(output).metadata()).exif || null).toBeNull();
    expect((await sharp(output).metadata()).format).toBe('jpeg');
  });

  test('fallback strips a tEXt chunk from a PNG and keeps it decodable', async () => {
    const tagged = pngWithTextChunk(await plainPng());
    expect(tagged.includes(Buffer.from('tEXt'))).toBe(true);

    const output = await stripExifFallback(tagged);

    expect(output.includes(Buffer.from('tEXt'))).toBe(false);
    expect((await sharp(output).metadata()).format).toBe('png');
  });

  test('fallback strips an EXIF chunk from WebP and repairs the RIFF size', async () => {
    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).webp().toBuffer();
    const tagged = webpWithExifChunk(webp);
    expect(tagged.includes(EXIF_SIG)).toBe(true);

    const output = await stripExifFallback(tagged);

    expect(output.includes(EXIF_SIG)).toBe(false);
    expect(output.readUInt32LE(4)).toBe(output.length - 8); // RIFF size field is consistent
    expect((await sharp(output).metadata()).format).toBe('webp');
  });

  test('sharp path strips PNG/WebP metadata too', async () => {
    const taggedPng = pngWithTextChunk(await plainPng());
    const outPng = await stripExif(taggedPng);
    expect(outPng.includes(Buffer.from('tEXt'))).toBe(false);

    const webp = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).webp().toBuffer();
    const outWebp = await stripExif(webp);
    expect((await sharp(outWebp).metadata()).format).toBe('webp');
  });

  test('rejects empty input instead of passing bytes through', async () => {
    await expect(stripExif(Buffer.alloc(0))).rejects.toThrow();
    expect(() => stripExifFallback(Buffer.alloc(0))).toThrow();
  });
});

// ── POST photo-uploads: happy path ───────────────────────────────────────────

describe('postRestaurantMediaPhoto', () => {
  test('stores stripped original + thumbnail and snapshots dishes in-transaction', async () => {
    const dishRows = [{ id: 10, name: 'Ramen', price_cents: 1250, currency_code: 'USD' }];
    mockSuccessfulPhotoPost({ dishRows, dishIds: [10] });
    const photo = await jpegWithGpsExif();

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .field('caption', 'Great noodles')
      .field('dish_ids', JSON.stringify([10]))
      .attach('file', photo, 'photo.jpg');

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.media.media_type).toBe('photo_upload');
    expect(res.body.media.processing_status).toBe('ready');

    // Original stored first, thumbnail second; the stored original carries no EXIF.
    expect(storage.uploadFile).toHaveBeenCalledTimes(2);
    const [storedOriginal] = storage.uploadFile.mock.calls[0];
    expect(Buffer.isBuffer(storedOriginal)).toBe(true);
    expect(storedOriginal.includes(EXIF_SIG)).toBe(false);

    const insertCall = mockQuery.mock.calls.find(
      (c) => c[0].includes('INSERT INTO restaurant_media') && !c[0].includes('restaurant_media_items')
    );
    expect(insertCall).toBeDefined();
    const params = insertCall[1];
    expect(params[3]).toBe('mock-key/photo.jpg'); // storage_key
    expect(params[4]).toBe('mock-key/thumb.jpg'); // thumbnail_key
    expect(insertCall[0]).toContain(`'photo_upload'`);
    expect(insertCall[0]).toContain(`'ready'`);
    expect(insertCall[0]).toContain(`'not_required'`);
    const renditions = JSON.parse(params[5]);
    expect(renditions).toHaveLength(1);
    expect(renditions[0].storage_key).toBe('mock-key/thumb.jpg');
    expect(renditions[0].width).toBe(64);
    expect(renditions[0].height).toBe(64);
    expect(renditions[0].size_bytes).toBeGreaterThan(0);

    // Dish snapshot taken in-transaction with the post-time name/price.
    const itemCall = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO restaurant_media_items'));
    expect(itemCall[1]).toEqual(['media-1', 10, 'Ramen', 1250, 'USD']);
  });

  test('response URLs are re-signed, not raw storage keys', async () => {
    mockSuccessfulPhotoPost();
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(201);
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('mock-key/photo.jpg');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('mock-key/thumb.jpg');
    expect(res.body.media.url).toContain('sig=');
    expect(res.body.media.url).toContain('exp=');
    expect(res.body.media.thumbnail_url).toContain('sig=');
  });

  test('rejects a missing file', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .field('caption', 'no file');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_photo_required');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('rejects a caption over 280 chars', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .field('caption', 'x'.repeat(281))
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_caption_too_long');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('rejects more than 10 tagged dishes', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .field('dish_ids', JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_too_many_dishes');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('rejects malformed dish_ids JSON', async () => {
    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .field('dish_ids', 'not-json')
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_invalid_dish_ids');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('rejects dishes that do not belong to this restaurant (nothing stored)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }) // getPublicRestaurant
      .mockResolvedValueOnce({ rows: [{ id: 10, name: 'Ramen', price_cents: 1250, currency_code: 'USD' }] });

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .field('dish_ids', JSON.stringify([10, 99]))
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_dish_not_found');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('404s on an invisible restaurant before touching the file pipeline', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getPublicRestaurant: none

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(fileScanService.scanBuffer).not.toHaveBeenCalled();
  });
});

// ── POST photo-uploads: security gates ──────────────────────────────────────

describe('postRestaurantMediaPhoto security gates', () => {
  test('rejects a MIME-spoofed upload (.exe renamed .jpg), never stored', async () => {
    mockSuccessfulPhotoPost();
    fileTypeFromBuffer.mockResolvedValue({ mime: 'application/x-msdownload', ext: 'exe' });
    const exeBytes = Buffer.concat([Buffer.from('MZ\x90\x00', 'binary'), Buffer.alloc(256)]);

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', exeBytes, { filename: 'evil.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(['media_photo_invalid_type', 'media_photo_mime_mismatch']).toContain(res.body.code);
    expect(storage.uploadFile).not.toHaveBeenCalled();
    expect(fileScanService.scanBuffer).not.toHaveBeenCalled();
  });

  test('rejects a declared-but-disallowed type (GIF), never stored', async () => {
    mockSuccessfulPhotoPost();
    fileTypeFromBuffer.mockResolvedValue({ mime: 'image/gif', ext: 'gif' });

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', Buffer.from('GIF89a' + '0'.repeat(64), 'ascii'), {
        filename: 'fun.gif', contentType: 'image/gif',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_photo_invalid_type');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('scanner unavailable (throws) -> 503, nothing stored', async () => {
    mockSuccessfulPhotoPost();
    fileScanService.scanBuffer.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('media_scan_unavailable');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('scanner skipped/static verdict -> rejected, nothing stored', async () => {
    mockSuccessfulPhotoPost();
    fileScanService.scanBuffer.mockResolvedValue({ clean: true, skipped: true, provider: 'static' });

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('media_scan_unavailable');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('scanner flags the file (EICAR static block) -> 400, nothing stored', async () => {
    mockSuccessfulPhotoPost();
    fileScanService.scanBuffer.mockResolvedValue({
      clean: false, skipped: false, provider: 'static', signature: 'eicar-test-signature',
    });

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_scan_rejected');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('oversize upload -> 413, nothing stored', async () => {
    mockSuccessfulPhotoPost();

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'huge.jpg');

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('file_too_large');
    expect(storage.uploadFile).not.toHaveBeenCalled();
  });

  test('storage failure cleans up already-stored keys and returns 500', async () => {
    mockSuccessfulPhotoPost();
    storage.uploadFile
      .mockResolvedValueOnce('mock-key/photo.jpg')
      .mockRejectedValueOnce(new Error('disk on fire'));

    const res = await request(buildApp())
      .post('/api/restaurants/42/media/photo-uploads')
      .attach('file', await jpegWithGpsExif(), 'photo.jpg');

    expect(res.status).toBe(500);
    expect(storage.deleteFile).toHaveBeenCalledWith('mock-key/photo.jpg');
  });
});

// ── Rate limit: shared 10/day budget ─────────────────────────────────────────

describe('photo upload rate limit', () => {
  test('shares the 10/day media post budget', async () => {
    const app = buildApp({ user: { id: 'user-photo-rate' } });
    let lastStatus = null;
    for (let i = 0; i < 11; i++) {
      mockSuccessfulPhotoPost();
      const res = await request(app)
        .post('/api/restaurants/42/media/photo-uploads')
        .attach('file', await jpegWithGpsExif(), 'photo.jpg');
      lastStatus = res.status;
      if (i < 10) expect(res.status).toBe(201);
    }
    expect(lastStatus).toBe(429);
  });
});

// ── GET /media: ready-only listing + upload serialization ────────────────────

describe('listRestaurantMedia with uploads', () => {
  const LINK_ROW = {
    id: 'media-link', media_type: 'video_link',
    video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube',
    external_video_id: 'dQw4w9WgXcQ', caption: 'link post', created_at: new Date().toISOString(),
    storage_key: null, thumbnail_key: null, processing_status: 'ready', renditions: null,
    user_id: 'user-poster', first_name: 'Ada', last_name: 'Lovelace',
    like_count: 5, liked_by_me: false, verified_order: true,
  };
  const PHOTO_ROW = {
    id: 'media-photo', media_type: 'photo_upload',
    video_url: null, provider: 'upload', external_video_id: '',
    caption: 'dish pic', created_at: new Date().toISOString(),
    storage_key: 'k/photo.jpg', thumbnail_key: 'k/thumb.jpg',
    processing_status: 'ready',
    renditions: [{ storage_key: 'k/thumb.jpg', width: 480, height: 480, size_bytes: 1234 }],
    user_id: 'user-poster', first_name: 'Ada', last_name: 'Lovelace',
    like_count: 2, liked_by_me: true, verified_order: false,
  };

  function mockFeed(mediaRows) {
    mockQuery
      .mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }) // getPublicRestaurant
      .mockResolvedValueOnce({ rows: mediaRows }) // feed
      .mockResolvedValueOnce({ rows: [{ total: mediaRows.length }] }) // count
      .mockResolvedValueOnce({ rows: [] }) // dishes
      .mockResolvedValueOnce({ rows: [] }); // viewer_can_moderate owner check
  }

  test('feed and count queries filter to processing_status = ready', async () => {
    mockFeed([LINK_ROW, PHOTO_ROW]);
    const res = await request(buildApp()).get('/api/restaurants/42/media');

    expect(res.status).toBe(200);
    const feedCall = mockQuery.mock.calls.find((c) => c[0].includes('FROM restaurant_media m'));
    const countCall = mockQuery.mock.calls.find((c) => c[0].includes('SELECT COUNT(*)::int AS total'));
    expect(feedCall[0]).toContain(`m.processing_status = 'ready'`);
    expect(countCall[0]).toContain(`processing_status = 'ready'`);
  });

  test('upload rows serialize with re-signed urls, thumbnail, status, renditions', async () => {
    mockFeed([PHOTO_ROW]);
    const res = await request(buildApp()).get('/api/restaurants/42/media');

    expect(res.status).toBe(200);
    const [item] = res.body.items;
    expect(item.media_type).toBe('photo_upload');
    expect(item.processing_status).toBe('ready');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('k/photo.jpg');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('k/thumb.jpg');
    expect(item.url).toContain('sig=');
    expect(item.url).toContain('exp=');
    expect(item.url).not.toContain('k/photo.jpg');
    expect(item.thumbnail_url).toContain('sig=');
    expect(item.renditions).toEqual([
      { url: expect.stringContaining('sig='), width: 480, height: 480 },
    ]);
    // No raw storage keys leak in the payload.
    expect(JSON.stringify(res.body)).not.toContain('k/photo.jpg');
    expect(JSON.stringify(res.body)).not.toContain('k/thumb.jpg');
  });

  test('link rows keep their historic shape (no url/thumbnail_url fields)', async () => {
    mockFeed([LINK_ROW]);
    const res = await request(buildApp()).get('/api/restaurants/42/media');

    expect(res.status).toBe(200);
    const [item] = res.body.items;
    expect(item.media_type).toBe('video_link');
    expect(item.video_url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(item.url).toBeUndefined();
    expect(item.thumbnail_url).toBeUndefined();
  });

  test('upload rows with null renditions serialize to an empty array', async () => {
    mockFeed([{ ...PHOTO_ROW, renditions: null }]);
    const res = await request(buildApp()).get('/api/restaurants/42/media');

    expect(res.status).toBe(200);
    expect(res.body.items[0].renditions).toEqual([]);
  });
});

describe('listMyRestaurantMedia', () => {
  const QUARANTINED_VIDEO = {
    id: 'media-vid', media_type: 'video_upload', caption: 'my clip',
    created_at: new Date().toISOString(),
    storage_key: 'k/clip.mp4', thumbnail_key: null,
    processing_status: 'quarantine', processing_error: null, csam_status: 'pending',
    renditions: null,
  };
  const FAILED_VIDEO = {
    id: 'media-vid2', media_type: 'video_upload', caption: 'bad clip',
    created_at: new Date().toISOString(),
    storage_key: 'k/clip2.mp4', thumbnail_key: null,
    processing_status: 'failed', processing_error: 'transcode failed', csam_status: 'pass',
    renditions: null,
  };

  function mockMine(rows) {
    mockQuery
      .mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }) // getPublicRestaurant
      .mockResolvedValueOnce({ rows }); // own uploads
  }

  test('returns own uploads including non-ready ones, with re-signed urls', async () => {
    mockMine([QUARANTINED_VIDEO, FAILED_VIDEO]);
    const res = await request(buildApp({ user: { id: 'me' } }))
      .get('/api/restaurants/42/media/mine');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    const [vid] = res.body.items;
    expect(vid.processing_status).toBe('quarantine');
    expect(vid.csam_status).toBe('pending');
    expect(vid.url).toContain('sig=');
    expect(vid.url).not.toContain('k/clip.mp4');
    expect(JSON.stringify(res.body)).not.toContain('k/clip.mp4');
    // Failed rows surface the sanitized error for the retry affordance.
    expect(res.body.items[1].processing_status).toBe('failed');
    expect(res.body.items[1].processing_error).toBe('transcode failed');
  });

  test('scopes to the signed-in user (query filters user_id)', async () => {
    mockMine([]);
    const res = await request(buildApp({ user: { id: 'me' } }))
      .get('/api/restaurants/42/media/mine');

    expect(res.status).toBe(200);
    const ownCall = mockQuery.mock.calls.find((c) => c[0].includes('media_type IN'));
    expect(ownCall[1]).toEqual([42, 'me']);
    expect(ownCall[0]).toContain(`AND user_id = $2`);
  });

  test('requires authentication', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [RESTAURANT_ROW] }); // getPublicRestaurant
    const res = await request(buildApp({ user: null }))
      .get('/api/restaurants/42/media/mine');

    expect(res.status).toBe(401);
  });
});
