'use strict';

/**
 * shareCart conversation posting — when a helper shares a parts-list cart
 * with a conversationId, the share posts a card message into that
 * conversation so the customer sees a tappable parts-list card, not a bare URL.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { shareCart } = require('../controllers/sharedCartsController');

function buildApp(user = { id: 'helper-1', first_name: 'Sam', last_name: 'Helper' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/shared-carts', shareCart);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
});

describe('shareCart with conversationId', () => {
  test('posts a shared_cart card message into the conversation', async () => {
    mockQuery
      // 1. cart ownership check
      .mockResolvedValueOnce({ rows: [{ id: 'cart-1' }] })
      // 2. verifyConversationAccess (up-front, before the share is created)
      .mockResolvedValueOnce({
        rows: [{ id: 'conv-1', customer_id: 'cust-1', helper_id: 'helper-1', business_id: null, job_id: null, status: 'active' }],
      })
      // 3. share insert
      .mockResolvedValueOnce({
        rows: [{ id: 'share-1', share_token: 'tok_abc123', created_at: new Date().toISOString(), expires_at: null, can_modify: true }],
      })
      // 4. verifyConversationAccess (defense-in-depth inside postSharedCartMessage)
      .mockResolvedValueOnce({
        rows: [{ id: 'conv-1', customer_id: 'cust-1', helper_id: 'helper-1', business_id: null, job_id: null, status: 'active' }],
      })
      // 5. cart totals for the card
      .mockResolvedValueOnce({
        rows: [{ name: 'Toilet job parts', item_count: '3', total_cents: '2747', currency: 'USD' }],
      })
      // 6-9. message transaction: BEGIN, INSERT, UPDATE, COMMIT
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      // 10+. notification internals (failures are swallowed with a warning)
      .mockRejectedValue(new Error('notify skipped in test'));

    const res = await request(buildApp())
      .post('/api/shared-carts')
      .send({ cartId: 'cart-1', conversationId: 'conv-1', clientMessageId: 'cm-1' });

    expect(res.status).toBe(201);
    expect(res.body.shareToken).toBe('tok_abc123');
    expect(res.body.messageId).toBe('msg-1');

    const messageInsert = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO messages')
    );
    expect(messageInsert).toBeTruthy();
    const params = messageInsert[1];
    expect(params[0]).toBe('conv-1'); // conversation_id
    expect(params[1]).toBe('helper-1'); // sender_id
    expect(params[2]).toContain('parts list'); // human-readable fallback
    const attachments = JSON.parse(params[3]);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      type: 'shared_cart',
      url: '/shared-cart/tok_abc123',
      share_token: 'tok_abc123',
      cart_name: 'Toilet job parts',
      item_count: 3,
      total_cents: 2747,
      currency: 'USD',
    });
    expect(params[4]).toBe('cm-1'); // idempotency key preserved
  });

  test('shares without a conversation message when conversationId is absent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cart-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'share-1', share_token: 'tok_xyz', created_at: new Date().toISOString(), expires_at: null, can_modify: true }],
      });

    const res = await request(buildApp())
      .post('/api/shared-carts')
      .send({ cartId: 'cart-1' });

    expect(res.status).toBe(201);
    expect(res.body.messageId).toBeNull();
    const messageInsert = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO messages')
    );
    expect(messageInsert).toBeUndefined();
  });

  test('rejects posting into a conversation the helper cannot access', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cart-1' }] })
      // verifyConversationAccess up front: no rows -> 403, no share created
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/shared-carts')
      .send({ cartId: 'cart-1', conversationId: 'conv-other' });

    expect(res.status).toBe(403);
    const shareInsert = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO shared_carts')
    );
    expect(shareInsert).toBeUndefined();
  });
});
