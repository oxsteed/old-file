/**
 * routes/investor.js
 *
 * All routes under /api/investor.
 * Accessible by: an active investor.reporting grant, admin, or super_admin.
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
const investorReportingController = require('../controllers/investorReportingController');

// requireRole is variadic. Passing the role list as one array makes every
// legitimate investor, admin, and super-admin request fail the mounted guard.
// During progressive rollout an approved customer-class grant can also reach
// the dashboard without mutating users.role.
const allowInvestor = (req, res, next) => {
  if (hasCapability(req, 'investor.reporting') || ['admin', 'super_admin'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
};

function requireInvestorDataset(dataset) {
  return (req, res, next) => {
    const audience = req.investorAudience;
    if (!audience || audience.datasets?.includes(dataset) || audience.datasets?.includes('all')) return next();
    return res.status(403).json({ error: 'This reporting audience does not include that dataset', code: 'investor_dataset_not_granted', dataset });
  };
}

router.get('/kpis',          authenticate, requireInvestorCapability, allowInvestor, requireInvestorDataset('overview'), getKpis);
router.get('/revenue-chart', authenticate, requireInvestorCapability, allowInvestor, requireInvestorDataset('revenue'), getRevenueChart);
router.get('/franchise',     authenticate, requireInvestorCapability, allowInvestor, requireInvestorDataset('franchise'), getFranchisePipeline);
router.get('/supply-demand', authenticate, requireInvestorCapability, allowInvestor, requireInvestorDataset('supply_demand'), getSupplyDemand);
router.get('/evidence/:metric', authenticate, requireInvestorCapability, allowInvestor, requireInvestorDataset('evidence'), getEvidence);

// Slice 5f, "View entity reporting" (726-730). These are read-only
// audience-scope surfaces, not datasets: the capability gate is the
// authority, and the scope inside is the audience row (D-769).
router.get('/reporting/entities', authenticate, requireInvestorCapability, allowInvestor, investorReportingController.getEntities);
router.get('/reporting/datasets', authenticate, requireInvestorCapability, allowInvestor, investorReportingController.getDatasets);

module.exports = router;
