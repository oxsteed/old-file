const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/plannedNeedsController');

// Projection must be declared before /:id routes to avoid param capture
router.get('/projection',    authenticate, ctrl.getProjection);

router.get('/',              authenticate, ctrl.listPlannedNeeds);
router.post('/',             authenticate, ctrl.createPlannedNeed);
router.put('/:id',           authenticate, ctrl.updatePlannedNeed);
router.post('/:id/cancel',   authenticate, ctrl.cancelPlannedNeed);
router.post('/:id/complete', authenticate, ctrl.completePlannedNeed);
router.delete('/:id',        authenticate, ctrl.deletePlannedNeed);

module.exports = router;
