'use strict';

/**
 * PS-10: cover image upload must FAIL when storage upload fails instead of
 * persisting a `data:` base64 URL to the database.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(),
  getPublicUrl: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../services/helperContext', () => ({
  invalidateHelperContext: jest.fn(),
}));
jest.mock('../utils/qrCodeGenerator', () => ({
  generateQRCodeBuffer: jest.fn(),
  generateQRCodeSVG: jest.fn(),
  buildHelperProfileURL: jest.fn(),
}));

const pool = require('../db');
const storage = require('../utils/storage');
const controller = require('../controllers/helperProfileImageController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockReq() {
  return {
    user: { id: 'helper-123' },
    file: {
      buffer: Buffer.from('fake-image-bytes'),
      originalname: 'cover.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('storage upload failure returns an error and writes nothing to the DB', async () => {
  storage.uploadFile.mockResolvedValue(null); // upload failed

  const res = mockRes();
  await controller.uploadCoverImage(mockReq(), res);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.any(String) })
  );
  // No SELECT/UPDATE may run: no data: URL (or anything else) is persisted.
  expect(pool.query).not.toHaveBeenCalled();
});

test('successful storage upload persists the public URL, never a data: URL', async () => {
  storage.uploadFile.mockResolvedValue('helper-covers/cover.jpg');
  storage.getPublicUrl.mockReturnValue('https://cdn.example.com/helper-covers/cover.jpg');

  pool.query
    .mockResolvedValueOnce({ rows: [{ cover_image_url: null }] }) // existing cover lookup
    .mockResolvedValueOnce({ rows: [{ user_id: 'helper-123', cover_image_url: 'https://cdn.example.com/helper-covers/cover.jpg' }] }) // UPDATE
    .mockResolvedValue({ rows: [] }); // business sync / context invalidation

  const res = mockRes();
  await controller.uploadCoverImage(mockReq(), res);

  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ success: true })
  );
  const writes = pool.query.mock.calls.filter(([sql]) => /UPDATE/i.test(sql));
  expect(writes.length).toBeGreaterThan(0);
  for (const [, params] of writes) {
    for (const p of params || []) {
      expect(String(p || '')).not.toMatch(/^data:/);
    }
  }
});
