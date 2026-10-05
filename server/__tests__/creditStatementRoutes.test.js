'use strict';

jest.mock('../services/creditStatementService', () => ({ getStatement: jest.fn() }));
jest.mock('../services/creditStatementExport', () => ({ renderStatementPdfInWorker: jest.fn() }));
const { mockQuery, resetMocks } = require('./setup');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { getStatement } = require('../services/creditStatementService');
const { renderStatementPdfInWorker } = require('../services/creditStatementExport');
const revocations = require('../services/tokenRevocationService');
const app = express();
app.use('/api/oxsteed-credit', require('../routes/oxsteedCredit'));
app.use('/api/food', require('../routes/food'));
app.use('/api/admin', require('../routes/admin'));
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));
const OWNER = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';
const adminPath = `/api/admin/super/oxsteed-credit/accounts/${CUSTOMER}/documents`;
let user;
beforeEach(() => {
  resetMocks(); jest.clearAllMocks();
  user = { id: OWNER, role: 'customer', default_mode: 'customer', email: 'synthetic@example.invalid',
    is_active: true, email_verified: true, id_verified: true, didit_status: 'verified', totp_enabled: true };
  mockQuery.mockImplementation(async () => ({ rows: [user] }));
  revocations.isRevoked.mockResolvedValue(false);
  getStatement.mockResolvedValue({ id: 'fixture', period: { from: '2026-09-01', to: '2026-09-30' } });
  renderStatementPdfInWorker.mockResolvedValue(Buffer.from('%PDF-synthetic'));
});
function bearer(claims = {}) {
  return `Bearer ${jwt.sign({ id: OWNER, role: user.role, ...claims }, process.env.JWT_SECRET, { algorithm: 'HS256' })}`;
}
test.each(['/api/oxsteed-credit/documents', '/api/food/customer/wallets/42/statements', adminPath])('anonymous requests cannot read %s', async url => {
  await request(app).get(url).expect(401); expect(getStatement).not.toHaveBeenCalled();
});
test.each(['documents', 'documents.pdf', 'documents.csv'])('customer route %s preserves authentication and the authenticated owner', async path => {
  // CSV renderer requires a complete document; use JSON/PDF for controller
  // execution, but all three route guards must deny a refresh token.
  await request(app).get(`/api/oxsteed-credit/${path}`).set('Authorization', bearer({ type: 'refresh' })).expect(401);
  expect(getStatement).not.toHaveBeenCalled();
});
test('owned customer report cannot select another customer through query fields', async () => {
  const res = await request(app).get(`/api/oxsteed-credit/documents?customerId=${CUSTOMER}&accountId=99`).set('Authorization', bearer()).expect(200);
  expect(getStatement).toHaveBeenCalledWith(OWNER, expect.objectContaining({ product: 'oxsteed' }));
  expect(res.headers['cache-control']).toContain('no-store');
});
test('restaurant document follows the wallet auth prefix and route account', async () => {
  await request(app).get(`/api/food/customer/wallets/42/statements?customerId=${CUSTOMER}`).set('Authorization', bearer()).expect(200);
  expect(getStatement).toHaveBeenCalledWith(OWNER, expect.objectContaining({ product: 'restaurant', restaurantId: '42' }));
});
test.each(['customer', 'helper', 'admin'])('role %s cannot download another customer through super-admin routes', async role => {
  user.role = role;
  await request(app).get(adminPath).set('Authorization', bearer()).expect(403);
  expect(getStatement).not.toHaveBeenCalled();
});
test('super-admin still needs MFA and an active non-revoked session', async () => {
  user.role = 'super_admin'; user.totp_enabled = false;
  await request(app).get(adminPath).set('Authorization', bearer()).expect(403);
  user.totp_enabled = true; revocations.isRevoked.mockResolvedValue(true);
  await request(app).get(adminPath).set('Authorization', bearer()).expect(401);
  expect(getStatement).not.toHaveBeenCalled();
});
test('authorized super-admin can retrieve the explicitly selected customer statement', async () => {
  user.role = 'super_admin';
  const res = await request(app).get(`${adminPath}.pdf`).set('Authorization', bearer()).expect(200);
  expect(getStatement).toHaveBeenCalledWith(CUSTOMER, expect.objectContaining({ product: 'oxsteed' }));
  expect(res.headers['content-type']).toContain('application/pdf');
  expect(res.headers['cache-control']).toContain('no-store');
});
