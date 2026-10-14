'use strict';

// Statement Center router: personalized per-product statement readiness for
// the signed-in user. Self-contained Express router; it is NOT mounted here.
// Mount line (do not edit server/index.js from the workstream):
//   app.use('/api', require('./routes/statementCenter'));
// which yields GET /api/statements/center.
//
// Authenticated only: every query is scoped server-side to req.user.id, so a
// caller can only ever see their own statement surface.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getStatementCenter } = require('../services/statementCenterService');

const router = express.Router();

router.use(authenticate);

router.get('/statements/center', async (req, res, next) => {
  try {
    // Personal financial surface: never cacheable, never shared.
    res.set('Cache-Control', 'private, no-store');
    res.set('Pragma', 'no-cache');
    res.json(await getStatementCenter(req.user.id));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
