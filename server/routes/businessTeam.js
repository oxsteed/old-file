'use strict';

/**
 * Per-business team / membership / access-code routes.
 *
 * Mounted in server/index.js as:
 *   app.use('/api/businesses', businessTeamRoutes);
 *
 * All routes here require an authenticated user. Most require manager+ on
 * the business; some are owner-only. Permission gating is handled by the
 * requirePermission middleware where applicable.
 */

const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const requirePermission = require('../middleware/requirePermission');

const access = require('../controllers/businessAccessCodesController');
const team   = require('../controllers/businessTeamController');

// ── Membership view + edit ──────────────────────────────────────────────────
router.get(
  '/:businessId/memberships',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.view'),
  team.listMemberships
);

router.get(
  '/:businessId/me',
  authenticate,
  requireBusinessAccess({ minRole: 'any' }),
  team.getMyMembership
);

router.patch(
  '/:businessId/memberships/:membershipId/role',
  authenticate,
  requireBusinessAccess({ minRole: 'owner' }),
  team.changeMembershipRole
);

router.put(
  '/:businessId/memberships/:membershipId/overrides',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  team.setMembershipOverrides
);

router.post(
  '/:businessId/memberships/:membershipId/approve',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission(['team.invite','team.assign_roles'], { mode: 'any' }),
  access.approveMembership
);

router.post(
  '/:businessId/memberships/:membershipId/deny',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission(['team.invite','team.remove_member'], { mode: 'any' }),
  access.denyMembership
);

// ── Catalog (for UI: roles + permission groups) ─────────────────────────────
router.get(
  '/:businessId/team/catalog',
  authenticate,
  requireBusinessAccess({ minRole: 'any' }),
  team.getCatalog
);

// ── Access codes (reusable per-business Vortex codes) ───────────────────────
router.get(
  '/:businessId/access-codes',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.listAccessCodes
);

router.post(
  '/:businessId/access-codes',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.createAccessCode
);

router.post(
  '/:businessId/access-codes/:codeId/rotate',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.rotateAccessCode
);

router.patch(
  '/:businessId/access-codes/:codeId',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.updateAccessCode
);

router.delete(
  '/:businessId/access-codes/:codeId',
  authenticate,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.revokeAccessCode
);

module.exports = router;
