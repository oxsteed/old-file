const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { generalLimiter } = require('../middleware/rateLimiter');
const {
  createFranchiseApplication,
  listMyFranchiseApplications,
  listFranchiseApplications,
  getFranchiseApplication,
  updateFranchiseApplication,
  addFranchiseNote,
  updateChecklistItem,
  upsertFranchiseAgreement,
  activateFranchiseStore,
} = require('../controllers/franchiseController');

const {
  getTerritoryStats,
  getTerritoryHelpers,
} = require('../controllers/franchiseTerritoryController');

router.post('/applications', generalLimiter, createFranchiseApplication);
router.get('/my-applications',     authenticate, listMyFranchiseApplications);
router.get('/territory-stats',     authenticate, getTerritoryStats);
router.get('/territory-helpers',   authenticate, getTerritoryHelpers);

router.get('/applications', authenticate, requireAdmin, listFranchiseApplications);
router.get('/applications/:id', authenticate, requireAdmin, getFranchiseApplication);
router.patch('/applications/:id', authenticate, requireAdmin, updateFranchiseApplication);
router.post('/applications/:id/notes', authenticate, requireAdmin, addFranchiseNote);
router.patch('/applications/:id/checklist/:itemId', authenticate, requireAdmin, updateChecklistItem);
router.put('/applications/:id/agreement', authenticate, requireAdmin, upsertFranchiseAgreement);
router.post('/applications/:id/activate-store', authenticate, requireAdmin, activateFranchiseStore);

module.exports = router;
