const router          = require('express').Router();
const { requireAdmin, requireSuperAdmin } = require('../middleware/adminAuth');
const superCtrl       = require('../controllers/superAdminController');
const adminCtrl       = require('../controllers/adminController');

// ══════════════════════════════════════════════════════════════
// REGULAR ADMIN — both admin and super_admin can access
// ══════════════════════════════════════════════════════════════

// Dashboard
router.get('/dashboard',         requireAdmin, adminCtrl.getDashboardStats);

// Content moderation
router.get('/reports',           requireAdmin, adminCtrl.getReports);
router.put('/reports/:reportId', requireAdmin, adminCtrl.reviewReport);
router.get('/moderation-queue',  requireAdmin, adminCtrl.getModerationQueue);

// Jobs (read + moderate)
router.get('/jobs',                    requireAdmin, superCtrl.getJobs);
router.post('/jobs/:jobId/action',     requireAdmin, superCtrl.forceJobAction);

// Users (read-only for regular admin)
router.get('/users',            requireAdmin, superCtrl.getUsers);
router.get('/users/:userId',    requireAdmin, superCtrl.getUserDetail);

// Market / Zip Code management
router.get('/markets',                        requireAdmin, adminCtrl.getMarkets);
router.post('/markets/:marketId/zip-codes',   requireAdmin, adminCtrl.addZipCodes);
router.delete('/markets/:marketId/zip-codes', requireAdmin, adminCtrl.removeZipCodes);

// ══════════════════════════════════════════════════════════════
// SUPER ADMIN ONLY
// ══════════════════════════════════════════════════════════════

// Full dashboard + charts
router.get('/super/dashboard',     requireSuperAdmin, superCtrl.getDashboardStats);
router.get('/super/revenue-chart', requireSuperAdmin, superCtrl.getRevenueChart);

// User management (write)
router.post('/users/:userId/ban',    requireSuperAdmin, superCtrl.toggleUserBan);
router.post('/users/:userId/verify', requireSuperAdmin, superCtrl.verifyUser);
router.put('/users/:userId/role',    requireSuperAdmin, superCtrl.updateUserRole);
router.delete('/users/:userId',        requireSuperAdmin, superCtrl.deleteUser);

// Financials
router.get('/financials',            requireSuperAdmin, superCtrl.getFinancials);
router.get('/payouts',               requireSuperAdmin, superCtrl.getPayouts);
router.post('/jobs/:jobId/refund',   requireSuperAdmin, superCtrl.issueManualRefund);

// Platform settings
router.get('/settings',              requireSuperAdmin, superCtrl.getSettings);
router.put('/settings/:key',         requireSuperAdmin, superCtrl.updateSetting);
router.put('/feature-flags/:key',    requireSuperAdmin, superCtrl.updateFeatureFlag);

// Audit log
router.get('/audit-log',             requireSuperAdmin, superCtrl.getAuditLog);

// Data export
router.get('/export/:type',          requireSuperAdmin, superCtrl.exportData);

module.exports = router;
