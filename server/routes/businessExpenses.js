const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessExpensesController');

router.get('/:businessId/expenses', requireAuth, ctrl.list);
router.post('/:businessId/expenses', requireAuth, ctrl.create);
router.put('/:businessId/expenses/:id', requireAuth, ctrl.update);
router.delete('/:businessId/expenses/:id', requireAuth, ctrl.remove);

module.exports = router;
