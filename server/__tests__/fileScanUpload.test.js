'use strict';

jest.mock('../services/fileScanService', () => ({
  scanBuffer: jest.fn(),
}));

const { resetMocks } = require('./setup');
const fileScanService = require('../services/fileScanService');
const validateFileUpload = require('../middleware/validateFileUpload');
const { fileTypeFromBuffer } = require('file-type');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('runs the malware scanner after static file validation', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: true, provider: 'clamav' });
  const req = { file: { buffer: Buffer.from('image'), originalname: 'photo.jpg', mimetype: 'image/jpeg', size: 5 } };
  const res = response();
  const next = jest.fn();

  await validateFileUpload(req, res, next);

  expect(fileScanService.scanBuffer).toHaveBeenCalledWith(req.file.buffer);
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
  const req = { file: { buffer: Buffer.from('image'), originalname: 'photo.jpg', mimetype: 'image/jpeg', size: 5 } };
  const res = response();

  await validateFileUpload(req, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('rejected') });
});

test('fails closed when the configured scanner is unavailable', async () => {
  fileScanService.scanBuffer.mockRejectedValue(new Error('clamd unavailable'));
  const req = { file: { buffer: Buffer.from('image'), originalname: 'photo.jpg', mimetype: 'image/jpeg', size: 5 } };
  const res = response();

  await validateFileUpload(req, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('scanning is temporarily unavailable') });
});

test('fails closed when a scanner returns a malformed result', async () => {
  fileScanService.scanBuffer.mockResolvedValue({ clean: true });
  const req = { file: { buffer: Buffer.from('image'), originalname: 'photo.jpg', mimetype: 'image/jpeg', size: 5 } };
  const res = response();

  await validateFileUpload(req, res, jest.fn());

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('scanning is temporarily unavailable') });
});
