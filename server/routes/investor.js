/**
 * routes/investor.js
 *
 * All routes under /api/investor.
 * Accessible by: investor, admin, super_admin.
 */

const express  = require('express');
const router   = express.Router();
const { authenticate } = require('../middleware/auth');
const { hasCapability, requireInvestorCapability } = require('../middleware/requireAccess');
const {
  getKpis,
  getRevenueChart,
  getFranchisePipeline,
  getSupplyDemand,
  getEvidence,
} = require('../controllers/investorController');

// requireRole is variadic. Passing the role list as one array makes every
// legitimate investor, admin, and super-admin request fail the mounted guard.
// During progressive rollout an approved customer-class grant can also reach
// the dashboard without mutating users.role.
const allowInvestor = (req, res, next) => {
  if (hasCapability(req, 'investor.reporting') || ['investor', 'admin', 'super_admin'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
};

router.get('/kpis',          authenticate, requireInvestorCapability, allowInvestor, getKpis);
router.get('/revenue-chart', authenticate, requireInvestorCapability, allowInvestor, getRevenueChart);
router.get('/franchise',     authenticate, requireInvestorCapability, allowInvestor, getFranchisePipeline);
router.get('/supply-demand', authenticate, requireInvestorCapability, allowInvestor, getSupplyDemand);
router.get('/evidence/:metric', authenticate, requireInvestorCapability, allowInvestor, getEvidence);

module.exports = router;
