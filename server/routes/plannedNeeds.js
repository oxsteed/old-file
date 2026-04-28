const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/plannedNeedsController');

// Projection must be declared before /:id routes to avoid param capture
router.get('/projection',    authenticate, ctrl.getProjection);

// Templates (Task 9) - no auth needed for reading
router.get('/templates',     authenticate, ctrl.getTemplates);

// Helper offers (Task 3)
router.get('/helper/offers',  authenticate, ctrl.getHelperOffers);

// Preferred-by count (Task 12)
router.get('/helper/preferred-count',       authenticate, ctrl.getPreferredByCount);
router.get('/helper/preferred-count/:helperId', authenticate, ctrl.getPreferredByCount);

// CRUD
router.get('/',              authenticate, ctrl.listPlannedNeeds);
router.post('/',             authenticate, ctrl.createPlannedNeed);
router.put('/:id',           authenticate, ctrl.updatePlannedNeed);
router.post('/:id/cancel',   authenticate, ctrl.cancelPlannedNeed);
router.post('/:id/complete', authenticate, ctrl.completePlannedNeed);
router.delete('/:id',        authenticate, ctrl.deletePlannedNeed);

// Task 2: Helper accept/decline
router.post('/:id/helper/accept',  authenticate, ctrl.helperAccept);
router.post('/:id/helper/decline', authenticate, ctrl.helperDecline);

// Task 5: Customer broadcast now
router.post('/:id/broadcast',      authenticate, ctrl.broadcastNow);

// Task 6: Add to sinking fund
router.post('/:id/fund',           authenticate, ctrl.addToFund);

// Task 8: Cost history
router.get('/:id/cost-history',    authenticate, ctrl.getCostHistory);

module.exports = router;
