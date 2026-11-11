'use strict';

require('./setup');

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/businessOwnership', () => ({
  canEditProfile: jest.fn().mockResolvedValue({ id: 'business-1', owner_id: 'owner-1' }),
  ownedBusiness: jest.fn(),
  canManageBusinessFinance: jest.fn(),
}));
jest.mock('../utils/storage', () => {
  const actual = jest.requireActual('../utils/storage');
  return {
    ...actual,
    uploadFile: jest.fn(),
    getPublicUrl: jest.fn(),
    deleteFile: jest.fn(),
  };
});
jest.mock('../services/storageCleanupService', () => ({ enqueueStorageDeletion: jest.fn() }));

const storage = require('../utils/storage');
const controller = require('../controllers/businessController');

function response() {
  return { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  storage.deleteFile.mockResolvedValue(undefined);
  storage.getPublicUrl.mockImplementation((key) => `/api/storage/public/${key}`);
});

test('failed business media persistence removes every newly uploaded object', async () => {
  storage.uploadFile
    .mockResolvedValueOnce('business-logos/new-logo.png')
    .mockResolvedValueOnce('business-covers/new-cover.png');
  mockQuery
    .mockResolvedValueOnce({ rows: [{ logo_url: null, cover_photo_url: null }] })
    .mockRejectedValueOnce(new Error('business update unavailable'));

  const next = jest.fn();
  await controller.uploadBusinessPhotos({
    params: { id: 'business-1' },
    user: { id: 'owner-1' },
    files: {
      logo: [{ buffer: Buffer.from('logo'), originalname: 'logo.png', mimetype: 'image/png', size: 4 }],
      cover: [{ buffer: Buffer.from('cover'), originalname: 'cover.png', mimetype: 'image/png', size: 5 }],
    },
  }, response(), next);

  expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'business update unavailable' }));
  expect(storage.deleteFile).toHaveBeenCalledWith('business-logos/new-logo.png');
  expect(storage.deleteFile).toHaveBeenCalledWith('business-covers/new-cover.png');
});

test('successful business media persistence keeps newly uploaded objects', async () => {
  storage.uploadFile.mockResolvedValue('business-covers/new-cover.png');
  mockQuery
    .mockResolvedValueOnce({ rows: [{ logo_url: null, cover_photo_url: null }] })
    .mockResolvedValueOnce({ rows: [{ id: 'business-1', cover_photo_url: '/api/storage/public/business-covers/new-cover.png' }] });

  const res = response();
  await controller.uploadBusinessPhotos({
    params: { id: 'business-1' },
    user: { id: 'owner-1' },
    files: { cover: [{ buffer: Buffer.from('cover'), originalname: 'cover.png', mimetype: 'image/png', size: 5 }] },
  }, res, jest.fn());

  expect(res.json).toHaveBeenCalled();
  expect(storage.deleteFile).not.toHaveBeenCalled();
});
