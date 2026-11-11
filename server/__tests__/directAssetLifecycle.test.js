'use strict';

require('./setup');

jest.mock('../utils/storage', () => {
  const actual = jest.requireActual('../utils/storage');
  return {
    ...actual,
    uploadFile: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
    deleteFile: jest.fn(),
  };
});

const storage = require('../utils/storage');
const controller = require('../controllers/directController');

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.deleteFile.mockResolvedValue(undefined);
});

test('removes a direct asset when signed URL generation fails', async () => {
  const key = 'direct-draft-assets/draft-1/quote/failed.jpg';
  storage.uploadFile.mockResolvedValue(key);
  storage.getSignedDownloadUrl.mockRejectedValue(new Error('signing unavailable'));

  const res = response();
  await controller.uploadDirectAsset({
    body: { draftId: 'draft-1', purpose: 'quote' },
    query: {},
    file: { buffer: Buffer.from('image'), originalname: 'failed.jpg', mimetype: 'image/jpeg', size: 5 },
    user: { id: 'user-1' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(storage.deleteFile).toHaveBeenCalledWith(key);
});

test('does not retain an asset when signed URL generation returns no URL', async () => {
  const key = 'direct-draft-assets/draft-1/quote/no-url.jpg';
  storage.uploadFile.mockResolvedValue(key);
  storage.getSignedDownloadUrl.mockResolvedValue(null);

  const res = response();
  await controller.uploadDirectAsset({
    body: { draftId: 'draft-1', purpose: 'quote' },
    query: {},
    file: { buffer: Buffer.from('image'), originalname: 'no-url.jpg', mimetype: 'image/jpeg', size: 5 },
    user: { id: 'user-1' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(storage.deleteFile).toHaveBeenCalledWith(key);
});
