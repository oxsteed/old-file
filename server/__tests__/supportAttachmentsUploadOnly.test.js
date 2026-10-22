'use strict';

// Support-case attachments are upload-only: a pasted fileUrl/attachmentUrl
// bypasses the upload pipeline (malware scan, EXIF strip, quota) and must
// be rejected in every support attachment flow. The statement-dispute flow
// (statementDisputeMessages.js) keeps its normalizeAttachmentReference use.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../db', () => ({ query: jest.fn() }));
const db = require('../db');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('support attachment upload-only enforcement', () => {
  beforeEach(() => {
    resetMocks();
    db.query.mockReset();
  });

  test('restaurant case addAttachment rejects a pasted fileUrl', async () => {
    const ctrl = require('../controllers/restaurantSupportController');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: '00000000-0000-4000-8000-000000000123', preferred_language: 'en' };
      next();
    });
    app.post('/api/restaurants/support/cases/:caseId/attachments', ctrl.addAttachment);
    app.use(errorHandler);

    const res = await request(app)
      .post('/api/restaurants/support/cases/42/attachments')
      .send({ fileUrl: 'https://evil.example/receipt.png', attachmentType: 'proof' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('pasted_file_url_rejected');
    // Rejected before any database work.
    expect(db.query).not.toHaveBeenCalled();
  });

  test('support conversation addMessage rejects a pasted attachmentUrl', async () => {
    const ctrl = require('../controllers/supportConversationsController');
    db.query.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM support_conversations WHERE id')) {
        return {
          rows: [{
            id: 'conv-1',
            customer_id: 'user-1',
            agent_id: null,
            business_id: null,
            status: 'open',
            channel: 'web_chat',
          }],
        };
      }
      return { rows: [] };
    });
    const req = {
      params: { conversationId: 'conv-1' },
      body: { content: 'Here is my issue', attachmentUrl: 'https://evil.example/photo.png' },
      user: { id: 'user-1', role: 'customer' },
      file: undefined,
      get: () => undefined,
    };
    const res = mockRes();
    await ctrl.addMessage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ attachmentUrl: expect.any(String) }) }),
    );
  });

  test('conversation attachment endpoint rejects a pasted attachmentUrl', async () => {
    const ctrl = require('../controllers/conversationMessageController');
    const req = {
      params: { businessId: 'biz-1', conversationId: 'conv-1' },
      body: { attachmentUrl: 'https://evil.example/photo.png', attachmentName: 'photo.png' },
      user: { id: 'user-1', role: 'customer' },
      file: undefined,
    };
    const res = mockRes();
    await ctrl.addAttachment(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ attachmentUrl: expect.any(String) }) }),
    );
    // Rejected before any database work or storage upload.
    expect(db.query).not.toHaveBeenCalled();
  });
});
