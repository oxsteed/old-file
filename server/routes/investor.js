/**
 * routes/investor.js
 *
 * All routes under /api/investor.
 * Accessible by: investor, admin, super_admin.
 */

const express  = require('express');
const router   = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const {
  getKpis,
  getRevenueChart,
  getFranchisePipeline,
  getSupplyDemand,
} = require('../controllers/investorController');

const allowInvestor = requireRole(['investor', 'admin', 'super_admin']);

router.get('/kpis',          authenticate, allowInvestor, getKpis);
router.get('/revenue-chart', authenticate, allowInvestor, getRevenueChart);
router.get('/franchise',     authenticate, allowInvestor, getFranchisePipeline);
router.get('/supply-demand', authenticate, allowInvestor, getSupplyDemand);

module.exports = router;
