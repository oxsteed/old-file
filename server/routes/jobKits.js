const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiter');
const { listJobKits, buildKitFromTemplate } = require('../services/jobKitService');

// All routes require authentication
router.use(authenticate);
router.use(generalLimiter);

/**
 * List curated job kits with live availability and estimated totals.
 * GET /api/job-kits
 */
router.get('/', async (req, res, next) => {
  try {
    const kits = await listJobKits();
    res.json({ kits });
  } catch (err) {
    next(err);
  }
});

/**
 * Build a draft parts-list cart from a curated kit.
 * POST /api/job-kits/:jobType/build
 * Body: { name?, jobId? }
 *
 * SKUs resolve against the live catalog at build time; missing or
 * unavailable products are omitted and reported in `omitted`.
 */
router.post('/:jobType/build', async (req, res, next) => {
  try {
    const { jobType } = req.params;
    const { name, jobId } = req.body || {};
    const result = await buildKitFromTemplate({
      jobType,
      helperId: req.user.id,
      name: name || null,
      jobId: jobId || null,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
