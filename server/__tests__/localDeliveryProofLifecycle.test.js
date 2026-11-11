'use strict';

const mockUploadFile = jest.fn();
const mockDeleteFile = jest.fn();
jest.mock('../utils/storage', () => ({
  uploadFile: mockUploadFile,
  getSignedDownloadUrl: jest.fn(),
  deleteFile: mockDeleteFile,
}));

require('./setup');

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/localDeliveryProofController');

beforeEach(() => {
  resetMocks();
  mockUploadFile.mockReset();
  mockDeleteFile.mockReset();
});

test('removes the uploaded object when proof persistence fails', async () => {
  const dbError = new Error('proof row unavailable');
  mockUploadFile.mockResolvedValueOnce('delivery-private/job-1/helper-1/proof.jpg');
  mockDeleteFile.mockResolvedValueOnce(undefined);
  mockQuery
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{
      id: 'job-1', proof_preference: 'photo', status: 'in_transit',
    }] })
    .mockRejectedValueOnce(dbError) // INSERT delivery proof
    .mockResolvedValueOnce({}); // ROLLBACK

  const next = jest.fn();
  await controller.upload({
    params: { id: 'job-1' },
    user: { id: 'helper-1' },
    file: {
      buffer: Buffer.from('proof'),
      mimetype: 'image/jpeg',
      size: 5,
      originalname: 'proof.jpg',
    },
  }, {}, next);

  expect(next).toHaveBeenCalledWith(dbError);
  expect(mockDeleteFile).toHaveBeenCalledWith('delivery-private/job-1/helper-1/proof.jpg');
});
