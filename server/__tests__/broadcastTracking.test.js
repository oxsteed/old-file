'use strict';

// Decision 1: public broadcast tracking endpoints and the owner send path.
jest.mock('../services/broadcastDeliveryService', () => {
  const actual = jest.requireActual('../services/broadcastDeliveryService');
  return { ...actual, recordOpen: jest.fn(), recordClick: jest.fn(), unsubscribe: jest.fn(), recipientByToken: jest.fn(),
    queueBroadcast: jest.fn(), getBroadcastStats: jest.fn() };
});
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const svc = require('../services/broadcastDeliveryService');
const marketing = require('../controllers/businessMarketingController');

const TOKEN = 'a'.repeat(64);
function app() {
  const a = express();
  a.use(express.json()); a.use(express.urlencoded({ extended: true }));
  a.use('/api/broadcast-tracking', require('../routes/broadcastTracking'));
  a.post('/biz/:businessId/broadcasts/:id/send', (req, _res, next) => { req.user = { id: 'u1' }; next(); }, marketing.sendBroadcast);
  a.post('/biz/:businessId/broadcasts', (req, _res, next) => { req.user = { id: 'u1' }; next(); }, marketing.createBroadcast);
  return a;
}

beforeEach(() => { resetMocks(); jest.clearAllMocks(); });

test('email open pixel is a no-store 1x1 gif even for unknown tokens', async () => {
  svc.recordOpen.mockResolvedValue(false);
  const res = await request(app()).get(`/api/broadcast-tracking/o/${TOKEN}.gif`).expect(200);
  expect(res.headers['content-type']).toBe('image/gif');
  expect(res.headers['cache-control']).toMatch(/no-store/);
  expect(svc.recordOpen).toHaveBeenCalledWith(expect.anything(), TOKEN, 'email');
});

test('click redirects only to a whitelisted link', async () => {
  svc.recordClick.mockResolvedValueOnce('https://example.com/sale').mockResolvedValueOnce(null);
  const ok = await request(app()).get(`/api/broadcast-tracking/c/${TOKEN}/0`).expect(302);
  expect(ok.headers.location).toBe('https://example.com/sale');
  await request(app()).get(`/api/broadcast-tracking/c/${TOKEN}/9`).expect(404);
});

test('push open is recorded', async () => {
  svc.recordOpen.mockResolvedValue(true);
  await request(app()).post(`/api/broadcast-tracking/p/${TOKEN}`).expect(204);
  expect(svc.recordOpen).toHaveBeenCalledWith(expect.anything(), TOKEN, 'push');
});

test('GET unsubscribe never mutates and renders the localized RTL confirm page', async () => {
  svc.recipientByToken.mockResolvedValue({ business_name: 'Café <b>Ayiti</b>', preferred_language: 'ar' });
  const res = await request(app()).get(`/api/broadcast-tracking/u/${TOKEN}`).expect(200);
  expect(res.text).toContain('lang="ar" dir="rtl"');
  expect(res.text).toContain('إلغاء الاشتراك');
  expect(res.text).toContain('Café &lt;b&gt;Ayiti&lt;/b&gt;');
  expect(res.text).toContain(`action="/api/broadcast-tracking/u/${TOKEN}"`);
  expect(svc.unsubscribe).not.toHaveBeenCalled();
});

test('POST unsubscribe: RFC 8058 one-click and the confirm form', async () => {
  svc.unsubscribe.mockResolvedValue({ business_name: 'Café Ayiti', preferred_language: 'fr' });
  const one = await request(app()).post(`/api/broadcast-tracking/u/${TOKEN}`).type('form').send('List-Unsubscribe=One-Click').expect(200);
  expect(one.body).toEqual({ success: true });
  expect(svc.unsubscribe).toHaveBeenLastCalledWith(expect.anything(), TOKEN, 'one_click');
  const form = await request(app()).post(`/api/broadcast-tracking/u/${TOKEN}`).type('form').send('').expect(200);
  expect(form.text).toContain('Vous êtes désabonné');
  expect(svc.unsubscribe).toHaveBeenLastCalledWith(expect.anything(), TOKEN, 'unsubscribe_link');
  svc.unsubscribe.mockRejectedValueOnce(new Error('db down'));
  await request(app()).post(`/api/broadcast-tracking/u/${TOKEN}`).type('form').send('').expect(503);
});

test('send fails closed when the audit row cannot be written', async () => {
  svc.queueBroadcast.mockResolvedValue({ queued: true, broadcast: { id: 5, channels: ['email'], recipient_count: 3 } });
  mockQuery.mockImplementation(async (sql) => {
    if (/INSERT INTO business_audit_log/.test(String(sql))) throw new Error('audit unavailable');
    return { rows: [], rowCount: 0 };
  });
  await request(app()).post('/biz/1/broadcasts/5/send').expect(500);
  const sqls = mockQuery.mock.calls.map(([s]) => String(s));
  expect(sqls).toContain('ROLLBACK');
  expect(sqls).not.toContain('COMMIT');
});

test('send queues, audits in the same transaction, and answers 202', async () => {
  svc.queueBroadcast.mockResolvedValue({ queued: true, broadcast: { id: 5, status: 'sending', channels: ['email'], recipient_count: 3 } });
  const res = await request(app()).post('/biz/1/broadcasts/5/send').expect(202);
  expect(res.body.status).toBe('sending');
  const audit = mockQuery.mock.calls.find(([s]) => /INSERT INTO business_audit_log/.test(String(s)));
  expect(audit[1][3]).toBe('broadcast.queued');
  expect(mockQuery.mock.calls.map(([s]) => String(s))).toContain('COMMIT');
});

test('create refuses channels that cannot be delivered', async () => {
  const res = await request(app()).post('/biz/1/broadcasts').send({ subject: 's', message: 'm', channel: 'sms' }).expect(400);
  expect(res.body.code).toBe('broadcast_channel_unsupported');
});
