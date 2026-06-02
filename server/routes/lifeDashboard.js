const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/lifeDashboardController');
const pulseCtrl = require('../controllers/lifePulseController');
const settingsCtrl = require('../controllers/pulseScoreSettingsController');

// ── Pulse score settings (must be before /pulse to avoid route shadowing) ─
router.get('/pulse/settings', authenticate, settingsCtrl.getSettings);
router.put('/pulse/settings', authenticate, settingsCtrl.updateSettings);

// ── Unified Life Pulse engine ────────────────────────────────────────────
// GET /api/life/pulse?window=1m   (dashboard default)
// GET /api/life/pulse?window=3m   (planned-needs default)
// Valid windows: 1w 2w 1m 3m 6m 1y 5y 10y
router.get('/pulse/insight', authenticate, ctrl.getPulseInsight);
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
router.post('/expenses/bulk-upsert', authenticate, ctrl.bulkUpsertExpenses);

// ── Budgets ──────────────────────────────────────────────────────────────
router.get('/budgets',           authenticate, ctrl.getBudgets);
router.post('/budgets',          authenticate, ctrl.upsertBudget);
router.delete('/budgets/:id',    authenticate, ctrl.deleteBudget);

// ── Goals ────────────────────────────────────────────────────────────────
router.get('/goals',                   authenticate, ctrl.getGoals);
router.post('/goals',                  authenticate, ctrl.createGoal);
router.put('/goals/:id',               authenticate, ctrl.updateGoal);
router.delete('/goals/:id',            authenticate, ctrl.deleteGoal);
router.post('/goals/bulk-upsert',      authenticate, ctrl.bulkUpsertGoals);

// ── Sinking Funds ────────────────────────────────────────────────────────
router.get('/sinking-funds',              authenticate, ctrl.getSinkingFunds);
router.post('/sinking-funds',             authenticate, ctrl.createSinkingFund);
router.put('/sinking-funds/:id',          authenticate, ctrl.updateSinkingFund);
router.delete('/sinking-funds/:id',       authenticate, ctrl.deleteSinkingFund);
router.post('/sinking-funds/bulk-upsert', authenticate, ctrl.bulkUpsertSinkingFunds);

// ── Saved Helpers ────────────────────────────────────────────────────────
router.get('/saved-helpers',     authenticate, ctrl.getSavedHelpers);
router.post('/saved-helpers',    authenticate, ctrl.saveHelper);
router.delete('/saved-helpers/:id', authenticate, ctrl.removeSavedHelper);

// ── Home Tasks ───────────────────────────────────────────────────────────
router.get('/home-tasks',              authenticate, ctrl.getHomeTasks);
router.post('/home-tasks',             authenticate, ctrl.createHomeTask);
router.put('/home-tasks/:id',          authenticate, ctrl.updateHomeTask);
router.delete('/home-tasks/:id',       authenticate, ctrl.deleteHomeTask);
router.post('/home-tasks/bulk-upsert', authenticate, ctrl.bulkUpsertHomeTasks);

// ── Life Garage ──────────────────────────────────────────────────────────
router.get('/vehicles',              authenticate, ctrl.getLifeVehicles);
router.post('/vehicles',             authenticate, ctrl.createLifeVehicle);
router.put('/vehicles/:id',          authenticate, ctrl.updateLifeVehicle);
router.delete('/vehicles/:id',       authenticate, ctrl.deleteLifeVehicle);
router.post('/vehicles/bulk-upsert', authenticate, ctrl.bulkUpsertVehicles);

// ── Habits ───────────────────────────────────────────────────────────────
router.get('/habits',              authenticate, ctrl.getLifeHabits);
router.post('/habits',             authenticate, ctrl.createLifeHabit);
router.put('/habits/:id',          authenticate, ctrl.updateLifeHabit);
router.delete('/habits/:id',       authenticate, ctrl.deleteLifeHabit);
router.post('/habits/bulk-upsert', authenticate, ctrl.bulkUpsertHabits);

// ── Checklist ────────────────────────────────────────────────────────────
router.get('/checklist',         authenticate, ctrl.getChecklist);
router.post('/checklist',        authenticate, ctrl.createChecklistItem);
router.put('/checklist/:id',     authenticate, ctrl.updateChecklistItem);
router.delete('/checklist/:id',  authenticate, ctrl.deleteChecklistItem);

module.exports = router;
