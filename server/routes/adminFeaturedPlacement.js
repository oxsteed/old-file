'use strict';

// Admin routes for the featured placement lifecycle (migration 677).
// Mounted at /api/admin/featured-placements. All routes sit behind
// requireAdmin; every mutation records the admin decision audit trail
// (decided_by_id / decided_at / decision_note) in a transaction.

const router = require('express').Router();
const { requireAdmin } = require('../middleware/adminAuth');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/adminFeaturedPlacementController');

router.use(requireAdmin);

router.get('/featured', ctrl.listFeatured);
router.get('/', ctrl.listRequests);
router.post('/:id/contact', ctrl.contactRequest);
router.post('/:id/approve', ctrl.approveRequest);
router.post('/:id/decline', ctrl.declineRequest);
router.post('/:id/revoke', ctrl.revokeRequest);

router.use(errorHandler);

module.exports = router;
