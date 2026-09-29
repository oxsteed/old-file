'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  authenticate: (_req, _res, next) => next(),
}));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../controllers/disputeController', () => ({
  openDispute: (_req, res) => res.status(201).json({ route: 'user-open' }),
  getMyDisputes: (_req, res) => res.json({ route: 'user-list' }),
  getDispute: (req, res) => res.json({ route: 'user-detail', disputeId: req.params.disputeId }),
  submitEvidence: (_req, res) => res.json({ route: 'user-evidence' }),
  sendDisputeMessage: (_req, res) => res.json({ route: 'user-message' }),
}));
jest.mock('../controllers/disputeAdminController', () => ({
  getAllDisputes: (_req, res) => res.json({ route: 'admin-list' }),
  startReview: (req, res) => res.json({ route: 'admin-review', disputeId: req.params.disputeId }),
  resolveDispute: (req, res) => res.json({ route: 'admin-resolve', disputeId: req.params.disputeId }),
}));

const disputeRoutes = require('../routes/disputes');

function buildApp() {
  const app = express();
  app.use('/api/disputes', disputeRoutes);
  return app;
}

test('admin dispute routes are not swallowed by /:disputeId', async () => {
  const app = buildApp();

  await request(app)
    .get('/api/disputes/admin/all')
    .expect(200)
    .expect({ route: 'admin-list' });

  await request(app)
    .post('/api/disputes/admin/123/review')
    .expect(200)
    .expect({ route: 'admin-review', disputeId: '123' });
});
