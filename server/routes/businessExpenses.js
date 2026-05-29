const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessExpensesController');

router.get('/:businessId/expenses', requireAuth, ctrl.listExpenses);
router.post('/:businessId/expenses', requireAuth, ctrl.createExpense);
router.put('/:businessId/expenses/:id', requireAuth, ctrl.updateExpense);
router.delete('/:businessId/expenses/:id', requireAuth, ctrl.deleteExpense);

module.exports = router;
