const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const { requireFeatureEnabled } = require('../middleware/featureFlags');

// Audit fix: Franchise is launch-hidden. Gate the API to match the UI.
const requireFranchiseEnabled = requireFeatureEnabled('Franchise', 'FRANCHISE_ENABLED', false);
const {
  createFranchiseApplication,
  listMyFranchiseApplications,
  listFranchiseApplications,
  getFranchiseApplication,
  updateFranchiseApplication,
  addFranchiseNote,
  updateChecklistItem,
  upsertFranchiseAgreement,
  signFranchiseAgreement,
  recordFranchiseFeeCollection,
  activateFranchiseStore,
} = require('../controllers/franchiseController');

const {
  getTerritoryStats,
  getTerritoryHelpers,
} = require('../controllers/franchiseTerritoryController');

router.post('/applications', generalLimiter, requireFranchiseEnabled, createFranchiseApplication);
router.get('/my-applications',     authenticate, requireFranchiseEnabled, listMyFranchiseApplications);
router.get('/territory-stats',     authenticate, requireFranchiseEnabled, getTerritoryStats);
router.get('/territory-helpers',   authenticate, requireFranchiseEnabled, getTerritoryHelpers);

router.get('/applications', authenticate, requireAdmin, requirePermission('manage_operations'), listFranchiseApplications);
router.get('/applications/:id', authenticate, requireAdmin, requirePermission('manage_operations'), getFranchiseApplication);
router.patch('/applications/:id', authenticate, requireAdmin, requirePermission('manage_operations'), updateFranchiseApplication);
router.post('/applications/:id/notes', authenticate, requireAdmin, requirePermission('manage_operations'), addFranchiseNote);
router.patch('/applications/:id/checklist/:itemId', authenticate, requireAdmin, requirePermission('manage_operations'), updateChecklistItem);
router.put('/applications/:id/agreement', authenticate, requireAdmin, requirePermission('manage_operations'), upsertFranchiseAgreement);
// Review P2-9-F09: the applicant signs from their own account (admins cannot
// assert the applicant's signature). Authenticated, not admin-gated.
router.post('/applications/:id/agreement/sign', authenticate, requireFranchiseEnabled, signFranchiseAgreement);
// Review P2-9-F07: record initial-fee collection (or waiver) so activation can
// fail closed until the fee is accounted for.
router.post('/applications/:id/agreement/collect-fee', authenticate, requireAdmin, requirePermission('manage_operations'), recordFranchiseFeeCollection);
router.post('/applications/:id/activate-store', authenticate, requireAdmin, requirePermission('manage_operations'), activateFranchiseStore);

module.exports = router;
