'use strict';

const router = require('express').Router();
const { requireAdmin, requirePermission, requireSuperAdminOrPermission } = require('../middleware/adminAuth');
const controller = require('../controllers/treasuryController');

// All treasury routes are admin-only and require the view_financials grant.
// Read access is separate from mutations. Financial visibility must not by
// itself authorize creating entities/accounts, posting journals, or closing
// periods; those operations require the explicit manage_financials grant.
router.use(requireAdmin, requirePermission('view_financials'));

const writeGate = requireSuperAdminOrPermission('manage_financials');

router.get('/entities', controller.listEntities);
router.post('/entities', writeGate, controller.createEntity);

router.get('/accounts', controller.listAccounts);
router.post('/accounts', writeGate, controller.createAccount);

router.get('/journal', controller.listJournal);
router.post('/journal', writeGate, controller.postJournal);

router.get('/periods', controller.listPeriods);
router.post('/periods', writeGate, controller.createPeriod);
router.post('/periods/:id/close', writeGate, controller.closePeriod);
router.get('/periods/:id/summary', controller.periodSummary);

router.get('/tax-export', controller.taxExport);

module.exports = router;
