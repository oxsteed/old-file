'use strict';

/**
 * M5 — Market Governance workspace routes (super-admin only).
 *
 * Mounted at /api/admin/super/governance by server/index.js. Every route
 * requires a live super-admin session (requireAdmin for identity + 2FA,
 * requireSuperAdmin for role).
 *
 *   Policies:   GET|POST /policies, PUT /policies/:id, POST /policies/:id/retire
 *   Contracts:  GET|POST /contracts, PUT /contracts/:id, POST /contracts/:id/terminate
 */

const router = require('express').Router();
const { requireAdmin, requireSuperAdmin } = require('../middleware/adminAuth');
const governanceCtrl = require('../controllers/governanceController');

// Policy registry.
router.get( '/policies',            requireAdmin, requireSuperAdmin, governanceCtrl.listPolicies);
router.post('/policies',            requireAdmin, requireSuperAdmin, governanceCtrl.createPolicy);
router.put( '/policies/:id',        requireAdmin, requireSuperAdmin, governanceCtrl.updatePolicy);
router.post('/policies/:id/retire', requireAdmin, requireSuperAdmin, governanceCtrl.retirePolicy);

// Contract records.
router.get( '/contracts',              requireAdmin, requireSuperAdmin, governanceCtrl.listContracts);
router.post('/contracts',              requireAdmin, requireSuperAdmin, governanceCtrl.createContract);
router.put( '/contracts/:id',          requireAdmin, requireSuperAdmin, governanceCtrl.updateContract);
router.post('/contracts/:id/terminate', requireAdmin, requireSuperAdmin, governanceCtrl.terminateContract);

module.exports = router;
