'use strict';

const mockUploadFile = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockDeleteFile = jest.fn();
const mockGenerateBusinessProfileQRCode = jest.fn();
const mockGenerateBusinessQRCodeSizes = jest.fn();
const mockBuildBusinessProfileURL = jest.fn(() => 'https://oxsteed.example/businesses/public/1');
jest.mock('../utils/storage', () => ({
  uploadFile: mockUploadFile,
  getPublicUrl: mockGetPublicUrl,
  deleteFile: mockDeleteFile,
}));
jest.mock('../utils/businessQRCodeGenerator', () => ({
  generateBusinessProfileQRCode: mockGenerateBusinessProfileQRCode,
  generateBusinessQRCodeSizes: mockGenerateBusinessQRCodeSizes,
  buildBusinessProfileURL: mockBuildBusinessProfileURL,
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
  mockGenerateBusinessProfileQRCode.mockReset();
  mockGenerateBusinessQRCodeSizes.mockReset();
  mockBuildBusinessProfileURL.mockClear();
});

test('public QR generation rejects a business outside the canonical public gate', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = response();
  await controller.generateQRCode({ params: { businessId: '1' }, query: {} }, res);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(mockGenerateBusinessProfileQRCode).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls[0][0]).toMatch(/u\.email_verified = TRUE/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/u\.onboarding_completed = TRUE/);
});

test('multi-size public QR generation rejects a hidden business before generating assets', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const res = response();
  await controller.generateMultiSizeQRCode({ params: { businessId: '1' } }, res);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(mockGenerateBusinessQRCodeSizes).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls[0][0]).toMatch(/b\.deleted_at IS NULL/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/b\.setup_status = 'active'/);
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

test('deletes a newly uploaded cover when public URL generation returns null', async () => {
  mockUploadFile.mockResolvedValueOnce('business-covers/business-1/no-url.jpg');
  mockGetPublicUrl.mockReturnValueOnce(null);
  mockDeleteFile.mockResolvedValueOnce(undefined);
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

  const res = response();
  await controller.uploadCoverImage({
    user: { id: 'owner-1' },
    file: { buffer: Buffer.from('cover'), mimetype: 'image/jpeg', size: 5, originalname: 'no-url.jpg' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(mockDeleteFile).toHaveBeenCalledWith('business-covers/business-1/no-url.jpg');
  expect(mockQuery).toHaveBeenCalledTimes(1);
});
