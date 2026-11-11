'use strict';

require('./setup');

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../utils/storage', () => {
  const actual = jest.requireActual('../utils/storage');
  return {
    ...actual,
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('/signed/private-file'),
  };
});

const storage = require('../utils/storage');
const controller = require('../controllers/workAgreementController');

const AGREEMENT_ID = '55555555-5555-4555-8555-555555555555';
const HELPER_ID = '11111111-1111-4111-8111-111111111111';

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

const agreement = {
  id: AGREEMENT_ID,
  helper_id: HELPER_ID,
  customer_id: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  storage.deleteFile.mockResolvedValue(undefined);
});

test('failed evidence persistence removes the uploaded private object', async () => {
  const key = 'private/work-agreements/evidence/failed.jpg';
  storage.uploadFile.mockResolvedValue(key);
  mockQuery
    .mockResolvedValueOnce({ rows: [agreement] })
    .mockRejectedValueOnce(new Error('evidence insert unavailable'));

  const res = response();
  await controller.addEvidence({
    params: { id: AGREEMENT_ID },
    user: { id: HELPER_ID },
    body: { type: 'before_photo', description: 'Before' },
    file: { buffer: Buffer.from('image'), originalname: 'before.jpg', mimetype: 'image/jpeg' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(storage.deleteFile).toHaveBeenCalledWith(key);
});

test('failed document persistence removes the uploaded private object', async () => {
  const key = 'private/work-agreements/documents/failed.pdf';
  storage.uploadFile.mockResolvedValue(key);
  mockQuery
    .mockResolvedValueOnce({ rows: [agreement] })
    .mockRejectedValueOnce(new Error('document insert unavailable'));

  const res = response();
  await controller.addDocument({
    params: { id: AGREEMENT_ID },
    user: { id: HELPER_ID },
    body: { fileName: 'terms.pdf' },
    file: { buffer: Buffer.from('pdf'), originalname: 'terms.pdf', mimetype: 'application/pdf' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(500);
  expect(storage.deleteFile).toHaveBeenCalledWith(key);
});

test('missing evidence storage key fails before inserting a broken vault row', async () => {
  storage.uploadFile.mockResolvedValue(null);
  mockQuery.mockResolvedValueOnce({ rows: [agreement] });

  const res = response();
  await controller.addEvidence({
    params: { id: AGREEMENT_ID },
    user: { id: HELPER_ID },
    body: { type: 'before_photo', description: 'Before' },
    file: { buffer: Buffer.from('image'), originalname: 'before.jpg', mimetype: 'image/jpeg' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'storage_unavailable' }));
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('missing document storage key fails before inserting a broken vault row', async () => {
  storage.uploadFile.mockResolvedValue(null);
  mockQuery.mockResolvedValueOnce({ rows: [agreement] });

  const res = response();
  await controller.addDocument({
    params: { id: AGREEMENT_ID },
    user: { id: HELPER_ID },
    body: { fileName: 'terms.pdf' },
    file: { buffer: Buffer.from('pdf'), originalname: 'terms.pdf', mimetype: 'application/pdf' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'storage_unavailable' }));
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('document filename validation happens before uploading', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [agreement] });
  const res = response();
  await controller.addDocument({
    params: { id: AGREEMENT_ID },
    user: { id: HELPER_ID },
    body: {},
    file: { buffer: Buffer.from('pdf'), originalname: '', mimetype: 'application/pdf' },
  }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(storage.uploadFile).not.toHaveBeenCalled();
});
