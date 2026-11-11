'use strict';

const mockUploadFile = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockDeleteFile = jest.fn();
jest.mock('../utils/storage', () => ({
  uploadFile: mockUploadFile,
  getPublicUrl: mockGetPublicUrl,
  deleteFile: mockDeleteFile,
}));

require('./setup');

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/businessProfileImageController');

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  mockUploadFile.mockReset();
  mockGetPublicUrl.mockReset();
  mockDeleteFile.mockReset();
});

test('deletes a newly uploaded cover when the business update fails', async () => {
  const dbError = new Error('business update unavailable');
  mockUploadFile.mockResolvedValueOnce('business-covers/business-1/new.jpg');
  mockGetPublicUrl.mockReturnValueOnce('https://cdn.example.test/business-covers/business-1/new.jpg');
  mockDeleteFile.mockResolvedValueOnce(undefined);
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // business ownership
    .mockResolvedValueOnce({ rows: [{ cover_image_url: null }] }) // current cover
    .mockRejectedValueOnce(dbError); // UPDATE

  const res = response();
  await controller.uploadCoverImage({
    user: { id: 'owner-1' },
    file: { buffer: Buffer.from('cover'), mimetype: 'image/jpeg', size: 5, originalname: 'new.jpg' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(mockDeleteFile).toHaveBeenCalledWith('business-covers/business-1/new.jpg');
});
