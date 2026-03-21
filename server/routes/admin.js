const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

// Middleware: require admin or superadmin role
const requireAdmin = (req, res, next) => {
  if (!req.user || !['admin', 'superadmin'].includes(req.user.admin_role)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
};

// Middleware: require superadmin role
const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.admin_role !== 'superadmin') {
    return res.status(403).json({ error: 'Super admin access required.' });
  }
  next();
};

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Dashboard
router.get('/dashboard', adminController.getDashboardStats);

// User management
router.get('/users', adminController.getUsers);
router.put('/users/:id/deactivate', adminController.deactivateUser);
router.put('/users/:id/reactivate', adminController.reactivateUser);

// Moderation queue
router.get('/moderation', adminController.getModerationQueue);
router.put('/moderation/:id/resolve', adminController.resolveModerationItem);
router.put('/moderation/:id/dismiss', adminController.dismissModerationItem);

// Market management
router.get('/markets', adminController.getMarkets);
router.post('/markets', requireSuperAdmin, adminController.createMarket);

// Activity log
router.get('/activity-log', adminController.getActivityLog);

// Platform settings (super admin only)
router.get('/settings', requireSuperAdmin, adminController.getPlatformSettings);
router.put('/settings/:key', requireSuperAdmin, adminController.updatePlatformSetting);

module.exports = router;
