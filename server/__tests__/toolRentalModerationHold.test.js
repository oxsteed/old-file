'use strict';

/**
 * TH1: independent admin moderation hold for tool rentals.
 *
 * Admin hide sets moderation_hold (an admin-only predicate), admin release
 * clears it, and an owner edit can neither clear the hold nor re-enable the
 * listing while the hold is set.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'owner-1', role: 'customer' };
    next();
  },
}));

jest.mock('../middleware/upload', () => ({
  single: () => (_req, _res, next) => next(),
}));

jest.mock('../middleware/validateFileUpload', () => (_req, _res, next) => next());

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const toolRentalRoutes = require('../routes/toolRentals');
const bizModCtrl = require('../controllers/businessModerationController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tool-rentals', toolRentalRoutes);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, fields: err.fields }));
  return app;
}

function resStub() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => resetMocks());

describe('tool rental moderation hold', () => {
  test('admin hide sets moderation_hold alongside is_available', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'tool-1', name: 'Drill', is_available: true, moderation_hold: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tool-1' }] });

    const req = { params: { id: 'tool-1' }, body: { reason: 'safety recall' }, user: { id: 'admin-1' } };
    const res = resStub();
    await bizModCtrl.toggleToolRental(req, res);

    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tool_rentals SET/i.test(sql));
    expect(updateCall).toBeTruthy();
    expect(updateCall[0]).toMatch(/moderation_hold\s*=\s*\$2/);
    expect(updateCall[1][0]).toBe(false); // is_available
    expect(updateCall[1][1]).toBe(true);  // moderation_hold
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_available: false }));
  });

  test('admin release clears moderation_hold', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'tool-1', name: 'Drill', is_available: false, moderation_hold: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'tool-1' }] });

    const req = { params: { id: 'tool-1' }, body: {}, user: { id: 'admin-1' } };
    const res = resStub();
    await bizModCtrl.toggleToolRental(req, res);

    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tool_rentals SET/i.test(sql));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1][0]).toBe(true);  // is_available
    expect(updateCall[1][1]).toBe(false); // moderation_hold
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ is_available: true }));
  });

  test('owner edit cannot clear an admin hold or re-enable the listing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'tool-1', moderation_hold: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ column_name: 'moderation_hold' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: 'tool-1', user_id: 'owner-1', name: 'Cordless drill', is_available: false, moderation_hold: true }],
      });

    const res = await request(buildApp())
      .put('/api/tool-rentals/tool-1')
      .send({ is_available: true, daily_rate: 20 });

    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(([sql, params]) => /UPDATE tool_rentals SET/i.test(sql) && Array.isArray(params));
    expect(updateCall).toBeTruthy();
    const [updateSql, updateParams] = updateCall;
    // The owner UPDATE never touches moderation_hold, so the hold survives.
    expect(updateSql).not.toMatch(/moderation_hold/);
    // ...and the hold pins is_available to false despite the owner sending true.
    expect(updateParams[9]).toBe(false);
    expect(res.body.tool.is_available).toBe(false);
    expect(res.body.tool.moderation_hold).toBe(true);
  });

  test('browse excludes tools under admin hold even when is_available is true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ column_name: 'moderation_hold' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/tool-rentals/browse');
    expect(res.status).toBe(200);

    const browseCall = mockQuery.mock.calls.find(([sql]) => /FROM tool_rentals t/i.test(sql));
    expect(browseCall).toBeTruthy();
    expect(browseCall[0]).toMatch(/AND NOT t\.moderation_hold/);
  });
});
