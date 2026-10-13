'use strict';

jest.mock('../services/fileScanService', () => ({
  scanBuffer: jest.fn(),
}));

const { resetMocks, mockQuery } = require('./setup');
const fileScanService = require('../services/fileScanService');
const validateFileUpload = require('../middleware/validateFileUpload');
const { fileTypeFromBuffer } = require('file-type');
const sharp = require('sharp');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

// Build a real JPEG carrying an EXIF APP1 segment (with a fake GPS IFD), so
// the EXIF-stripping behavior is exercised against genuine image bytes.
async function jpegWithExif() {
  const base = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).jpeg().toBuffer();

  // Minimal TIFF: II, 42, IFD0 at 8, one ASCII "Make" entry stored inline.
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x010f, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(6, 14);
  Buffer.from('CAM\0\0\0').copy(tiff, 18);
  tiff.writeUInt32LE(0, 22);

  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const segment = Buffer.alloc(2 + 2 + exifPayload.length);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(2 + exifPayload.length, 2);
  exifPayload.copy(segment, 4);

  return Buffer.concat([base.subarray(0, 2), segment, base.subarray(2)]);
}

let photoBuffer;

beforeAll(async () => {
  photoBuffer = await jpegWithExif();
  expect(photoBuffer.includes(Buffer.from('Exif\0\0', 'ascii'))).toBe(true);
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function photoReq() {
  return {
    user: { id: 'user-1' },
    file: {
      buffer: Buffer.from(photoBuffer),
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: photoBuffer.length,
    },
  };
}

test('runs the malware scanner after static file validation', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: true, provider: 'clamav' });
  const req = photoReq();
  const res = response();
  const next = jest.fn();

  await validateFileUpload(req, res, next);

  expect(fileScanService.scanBuffer).toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

test('strips EXIF metadata from JPEG uploads (P3-6-F07)', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: true, provider: 'clamav' });
  const req = photoReq();
  const res = response();
  const next = jest.fn();

  await validateFileUpload(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.file.exifStripped).toBe(true);
  expect(req.file.buffer.includes(Buffer.from('Exif\0\0', 'ascii'))).toBe(false);
  expect(req.file.size).toBe(req.file.buffer.length);
});

test('rejects uploads when the daily quota is exceeded (P3-6-F13)', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: true, provider: 'clamav' });
  mockQuery.mockResolvedValueOnce({ rows: [{ bytes_used: String(2 * 1024 * 1024 * 1024) }] });
  const req = photoReq();
  const res = response();
  const next = jest.fn();

  await validateFileUpload(req, res, next);

  expect(res.status).toHaveBeenCalledWith(429);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'upload_quota_exceeded' }));
  expect(next).not.toHaveBeenCalled();
  expect(fileScanService.scanBuffer).not.toHaveBeenCalled();
});

test('fails open when the quota store is unreachable (P3-6-F13)', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: true, provider: 'clamav' });
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  const req = photoReq();
  const res = response();
  const next = jest.fn();

  await validateFileUpload(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

test('also scans text uploads accepted by the safe extension fallback', async () => {
  fileTypeFromBuffer.mockResolvedValueOnce(undefined);
  fileScanService.scanBuffer.mockResolvedValue({ clean: true, provider: 'clamav' });
  const req = { file: { buffer: Buffer.from('name,value'), originalname: 'data.csv', mimetype: 'text/csv', size: 10 } };
  const res = response();
  const next = jest.fn();

  await validateFileUpload(req, res, next);

  expect(fileScanService.scanBuffer).toHaveBeenCalledWith(req.file.buffer);
  expect(next).toHaveBeenCalledTimes(1);
});

test('rejects an upload reported as infected', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: false, provider: 'clamav' });
  const req = photoReq();
  const res = response();

  await validateFileUpload(req, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('rejected') });
});

test('fails closed when the configured scanner is unavailable', async () => {
  fileScanService.scanBuffer.mockRejectedValue(new Error('clamd unavailable'));
  const req = photoReq();
  const res = response();

  await validateFileUpload(req, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('scanning is temporarily unavailable') });
});

test('fails closed when a scanner returns a malformed result', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: true });
  const req = photoReq();
  const res = response();

  await validateFileUpload(req, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('scanning is temporarily unavailable') });
});
