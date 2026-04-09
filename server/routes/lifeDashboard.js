const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/lifeDashboardController');
const pulseCtrl = require('../controllers/lifePulseController');

// ── Unified Life Pulse engine ────────────────────────────────────────────
// GET /api/life/pulse?window=1m   (dashboard default)
// GET /api/life/pulse?window=3m   (planned-needs default)
// Valid windows: 1w 2w 1m 3m 6m 1y 5y 10y
router.get('/pulse', authenticate, pulseCtrl.getLifePulse);

// ── Dashboard summary (one-shot load) ────────────────────────────────────
router.get('/summary', authenticate, ctrl.getDashboardSummary);

// ── Community stats ──────────────────────────────────────────────────────
router.get('/community', authenticate, ctrl.getCommunityStats);

// ── Expenses ─────────────────────────────────────────────────────────────
router.get('/expenses',          authenticate, ctrl.getExpenses);
router.get('/expenses/summary',  authenticate, ctrl.getExpenseSummary);
router.post('/expenses',         authenticate, ctrl.createExpense);
router.put('/expenses/:id',      authenticate, ctrl.updateExpense);
router.delete('/expenses/:id',   authenticate, ctrl.deleteExpense);

// ── Budgets ──────────────────────────────────────────────────────────────
router.get('/budgets',           authenticate, ctrl.getBudgets);
router.post('/budgets',          authenticate, ctrl.upsertBudget);
router.delete('/budgets/:id',    authenticate, ctrl.deleteBudget);

// ── Goals ────────────────────────────────────────────────────────────────
router.get('/goals',             authenticate, ctrl.getGoals);
router.post('/goals',            authenticate, ctrl.createGoal);
router.put('/goals/:id',         authenticate, ctrl.updateGoal);
router.delete('/goals/:id',      authenticate, ctrl.deleteGoal);

// ── Saved Helpers ────────────────────────────────────────────────────────
router.get('/saved-helpers',     authenticate, ctrl.getSavedHelpers);
router.post('/saved-helpers',    authenticate, ctrl.saveHelper);
router.delete('/saved-helpers/:id', authenticate, ctrl.removeSavedHelper);

// ── Home Tasks ───────────────────────────────────────────────────────────
router.get('/home-tasks',        authenticate, ctrl.getHomeTasks);
router.post('/home-tasks',       authenticate, ctrl.createHomeTask);
router.put('/home-tasks/:id',    authenticate, ctrl.updateHomeTask);
router.delete('/home-tasks/:id', authenticate, ctrl.deleteHomeTask);

// ── Checklist ────────────────────────────────────────────────────────────
router.get('/checklist',         authenticate, ctrl.getChecklist);
router.post('/checklist',        authenticate, ctrl.createChecklistItem);
router.put('/checklist/:id',     authenticate, ctrl.updateChecklistItem);
router.delete('/checklist/:id',  authenticate, ctrl.deleteChecklistItem);

module.exports = router;
