'use strict';

/**
 * F-18 regression: bearer-capability objects are bound to their owner.
 *  (a) GET /api/translate/translations/:id and /jobs/:jobId
 *  (b) shared-cart approval / edits for carts shared with a named customer,
 *      and integer quantities.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

beforeEach(() => resetMocks());

describe('F-18 translations are owner-scoped', () => {
  const repo = require('../modules/translation/translationRepository');

  test('guests cannot read a cached translation by id', async () => {
    await expect(repo.getTranslationForRequester('t-1', null)).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('signed-in reads require a request of their own for the same cache key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(repo.getTranslationForRequester('t-1', 'user-2')).resolves.toBeNull();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/translation_requests r/);
    expect(sql).toMatch(/r\.requester_user_id = \$2/);
    expect(params).toEqual(['t-1', 'user-2']);
  });

  test('guest job lookups only match guest-created jobs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.getTranslationJobById('job-1', null, { scope: 'requester' });
    expect(mockQuery.mock.calls[0][0]).toMatch(/requester_user_id IS NULL/);
  });

  test('signed-in job lookups are bound to the requester', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await repo.getTranslationJobById('job-1', 'user-1', { scope: 'requester' });
    expect(mockQuery.mock.calls[0][0]).toMatch(/requester_user_id = \$2/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['job-1', 'user-1']);
  });
});

describe('F-18 shared carts', () => {
  const ctrl = require('../controllers/sharedCartsController');

  function app(user) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { if (user) req.user = user; next(); });
    a.post('/api/shared-carts/:shareToken/approve', ctrl.approveCart);
    a.post('/api/shared-carts/:shareToken/items', ctrl.addItemToSharedCart);
    a.put('/api/shared-carts/:shareToken/items/:itemId', ctrl.modifySharedCart);
    a.use(errorHandler);
    return a;
  }

  const namedShare = { id: 'sc-1', cart_id: 'cart-1', can_modify: true, expires_at: null, customer_id: 'cust-1', shared_by: 'helper-1' };

  test('a different signed-in user cannot approve a cart shared with a named customer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [namedShare] });
    const res = await request(app({ id: 'intruder' })).post('/api/shared-carts/tok/approve').send({});
    expect(res.status).toBe(403);
    expect(mockQuery.mock.calls.some(([q]) => /INSERT INTO cart_approvals/.test(q))).toBe(false);
  });

  test('anonymous link holders cannot edit a cart shared with a named customer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [namedShare] });
    const res = await request(app(null)).put('/api/shared-carts/tok/items/i-1').send({ quantity: 2 });
    expect(res.status).toBe(403);
  });

  test.each([[1.5], [0], [-1], ['2x'], [1000], [null]])('rejects quantity %p', async (quantity) => {
    const res = await request(app({ id: 'cust-1' })).post('/api/shared-carts/tok/items').send({ productId: 'p-1', quantity });
    expect(res.status).toBe(400);
  });

  test('quantity helper accepts whole numbers 1..999', () => {
    expect(ctrl._isValidQuantity(1)).toBe(true);
    expect(ctrl._isValidQuantity('3')).toBe(true);
    expect(ctrl._isValidQuantity(999)).toBe(true);
    expect(ctrl._isValidQuantity(2.5)).toBe(false);
  });

  test('open links stay usable; named links admit the customer and sharer', () => {
    expect(ctrl._mayActOnSharedCart({ customer_id: null }, null)).toBe(true);
    expect(ctrl._mayActOnSharedCart(namedShare, 'cust-1')).toBe(true);
    expect(ctrl._mayActOnSharedCart(namedShare, 'helper-1')).toBe(true);
    expect(ctrl._mayActOnSharedCart(namedShare, 'other')).toBe(false);
  });
});
