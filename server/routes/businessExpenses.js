const express = require('express');
const router = express.Router();
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/businessExpensesController');

router.get('/:businessId/expenses', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.listExpenses);
router.post('/:businessId/expenses', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.createExpense);
router.put('/:businessId/expenses/:id', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.updateExpense);
router.delete('/:businessId/expenses/:id', requireAuth, requireBusinessAccess({ minRole: 'manager', resolvePermissions: false }), ctrl.deleteExpense);

module.exports = router;
