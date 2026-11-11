'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(),
  getPublicUrl: jest.fn(),
  deleteFile: jest.fn(),
}));
jest.mock('../utils/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const pool = require('../db');
const storage = require('../utils/storage');
const controller = require('../controllers/mobileController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.deleteFile.mockResolvedValue(undefined);
});

test('failed gallery persistence removes the newly uploaded object', async () => {
  storage.uploadFile.mockResolvedValue('helper-gallery/helper-1/photo.jpg');
  storage.getPublicUrl.mockReturnValue('/api/storage/public/helper-gallery/helper-1/photo.jpg');
  pool.query.mockRejectedValue(new Error('gallery insert unavailable'));

  const res = response();
  const next = jest.fn();
  await controller.uploadHelperGallery({
    user: { id: 'helper-1', role: 'helper' },
    file: { buffer: Buffer.from('image'), originalname: 'photo.jpg', mimetype: 'image/jpeg' },
    body: {},
  }, res, next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'gallery insert unavailable' }));
  expect(storage.deleteFile).toHaveBeenCalledWith('helper-gallery/helper-1/photo.jpg');
  expect(res.status).not.toHaveBeenCalled();
});

test('successful gallery persistence retains the uploaded object', async () => {
  storage.uploadFile.mockResolvedValue('helper-gallery/helper-1/photo.jpg');
  storage.getPublicUrl.mockReturnValue('/api/storage/public/helper-gallery/helper-1/photo.jpg');
  pool.query.mockResolvedValue({ rows: [{ id: 3, user_id: 'helper-1', url: '/api/storage/public/helper-gallery/helper-1/photo.jpg' }] });

  const res = response();
  const next = jest.fn();
  await controller.uploadHelperGallery({
    user: { id: 'helper-1', role: 'helper' },
    file: { buffer: Buffer.from('image'), originalname: 'photo.jpg', mimetype: 'image/jpeg' },
    body: { caption: 'Portfolio' },
  }, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(201);
  expect(storage.deleteFile).not.toHaveBeenCalled();
});
