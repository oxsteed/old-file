'use strict';

/**
 * Audit T4 (items 15 & 20) — payout route guards.
 *
 * Item 15 retired: the legacy POST /api/payouts/:payout_id/process route
 * was consolidated onto the newer POST /api/affiliate/:payoutId/process
 * route, which carries the same step-up, dual-approval, and compliance
 * gates. These tests guard the removal: the legacy path must 404 and the
 * legacy route must not reappear in the route table.
 *
 * Item 20: helper payout-method create/update/delete is the classic
 * account-takeover payout-redirection vector. The write routes now require
 * a fresh TOTP proof (requireUserTotpStepUp), fail closed when TOTP is not
 * enrolled.
 */

const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { encrypt } = require('../utils/encryption');
const { authenticator } = require('@otplib/v12-adapter');
const { requireUserTotpStepUp } = require('../middleware/requireUserTotpStepUp');

const ROUTE_SRC = fs.readFileSync(require.resolve('../routes/payoutRoutes.js'), 'utf8');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetMocks();
  authenticator.verify.mockReset();
  authenticator.verify.mockReturnValue(true);
});

describe('item 15 retired: legacy affiliate payout process route removed', () => {
  test('payoutRoutes no longer registers POST /:payout_id/process', () => {
    expect(ROUTE_SRC).not.toContain('/:payout_id/process');
  });
  test('HTTP POST to the legacy path returns 404', async () => {
    const payoutRoutes = require('../routes/payoutRoutes');
    const app = express();
    app.use(express.json());
    app.use('/api/payouts', payoutRoutes);
    const res = await request(app).post('/api/payouts/payout-1/process').send({});
    expect(res.status).toBe(404);
  });
});

describe('item 20: payout-method write routes require fresh TOTP step-up', () => {
  test.each([['post', "'/payout-methods'"], ['put', "'/payout-methods/:method_id'"], ['delete', "'/payout-methods/:method_id'"]])(
    '%s %s mounts requireUserTotpStepUp',
    (method, path) => {
      const re = new RegExp(`router\\.${method}\\(\\s*${path.replace(/[/:]/g, (c) => `\\${c}`)}[^;]*requireUserTotpStepUp`, 's');
      expect(ROUTE_SRC).toMatch(re);
    }
  );

  test('read route stays open (no step-up)', () => {
    const line = ROUTE_SRC.split('\n').find((l) => l.includes("router.get('/payout-methods'"));
    expect(line).not.toMatch(/requireUserTotpStepUp/);
  });
});

describe('item 20: requireUserTotpStepUp middleware', () => {
  const enrolledRow = () => ({
    totp_secret: encrypt('TESTSECRET'),
    totp_enabled: true,
  });

  const run = (req) =>
    new Promise((resolve) => {
      const res = mockRes();
      res.status.mockImplementation((code) => {
        res.statusCode = code;
        return res;
      });
      res.json.mockImplementation((body) => {
        resolve({ blocked: true, status: res.statusCode, body });
        return res;
      });
      const next = jest.fn(() => resolve({ blocked: false, next }));
      requireUserTotpStepUp(req, res, next);
    });

  test('401 when unauthenticated', async () => {
    const out = await run({ body: {} });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(401);
  });

  test('403 totp_stepup_required when TOTP is not enrolled', async () => {
    mockQuery.mockResolvedValue({ rows: [{ totp_secret: null, totp_enabled: false }] });
    const out = await run({ user: { id: 'u1' }, body: { totp_code: '123456' } });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('totp_stepup_required');
  });

  test('403 totp_stepup_required when no code is presented', async () => {
    mockQuery.mockResolvedValue({ rows: [enrolledRow()] });
    const out = await run({ user: { id: 'u1' }, body: {} });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('totp_stepup_required');
    expect(authenticator.verify).not.toHaveBeenCalled();
  });

  test('403 totp_stepup_invalid when the code is wrong', async () => {
    authenticator.verify.mockReturnValue(false);
    mockQuery.mockResolvedValue({ rows: [enrolledRow()] });
    const out = await run({ user: { id: 'u1' }, body: { totp_code: '000000' } });
    expect(out.blocked).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('totp_stepup_invalid');
  });

  test('passes through on a valid fresh code', async () => {
    mockQuery.mockResolvedValue({ rows: [enrolledRow()] });
    const out = await run({ user: { id: 'u1' }, body: { totpCode: '123456' } });
    expect(out.blocked).toBe(false);
    expect(out.next).toHaveBeenCalledTimes(1);
    expect(authenticator.verify).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'TESTSECRET', token: '123456' })
    );
  });
});
