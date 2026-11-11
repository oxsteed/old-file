'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/supportEmployerService', () => ({
  userCanAccessBusinessConversations: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/socketService', () => ({
  broadcastToConversation: jest.fn(),
}));
jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue('support-conversations/attachment.png'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('/signed/attachment'),
  deleteFile: jest.fn().mockResolvedValue(undefined),
}));

const controller = require('../controllers/conversationMessageController');
const storage = require('../utils/storage');

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  storage.uploadFile.mockResolvedValue('support-conversations/attachment.png');
  storage.getSignedDownloadUrl.mockResolvedValue('/signed/attachment');
  storage.deleteFile.mockResolvedValue(undefined);
});

test('cleans an attachment when the signed URL is unavailable', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'conv-1' }] });
  storage.getSignedDownloadUrl.mockResolvedValueOnce(null);

  const res = response();
  await controller.addAttachment({
    params: { businessId: 'biz-1', conversationId: 'conv-1' },
    body: { attachmentName: 'attachment.png' },
    user: { id: 'user-1', role: 'customer' },
    file: { buffer: Buffer.from('image'), mimetype: 'image/png', originalname: 'attachment.png' },
  }, res);

  expect(storage.deleteFile).toHaveBeenCalledWith('support-conversations/attachment.png');
  expect(res.status).toHaveBeenCalledWith(500);
});
