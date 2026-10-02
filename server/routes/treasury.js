'use strict';

const router = require('express').Router();
const { requireAdmin, requirePermission } = require('../middleware/adminAuth');
const controller = require('../controllers/treasuryController');

// All treasury routes are admin-only and require the view_financials grant.
// Journal posting additionally requires double validation inside the
// controller; period close is guarded by an atomic status predicate.
router.use(requireAdmin, requirePermission('view_financials'));

router.get('/entities', controller.listEntities);
router.post('/entities', controller.createEntity);

router.get('/accounts', controller.listAccounts);
router.post('/accounts', controller.createAccount);

router.get('/journal', controller.listJournal);
router.post('/journal', controller.postJournal);

router.get('/periods', controller.listPeriods);
router.post('/periods', controller.createPeriod);
router.post('/periods/:id/close', controller.closePeriod);
router.get('/periods/:id/summary', controller.periodSummary);

router.get('/tax-export', controller.taxExport);

module.exports = router;
