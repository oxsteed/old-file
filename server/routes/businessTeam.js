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
const { requireFeatureEnabled } = require('../middleware/featureFlags');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');

// Audit fix: Vortex is launch-hidden. Gate the leftover access-code and
// code-flow membership approve/deny APIs to match the UI and /api/vortex
// routes. Removing (kicking) an ACTIVE member is core team management, not a
// Vortex code flow, so it stays available whenever the caller holds
// team.remove_member.
const requireVortexEnabled = requireFeatureEnabled('Vortex', 'VORTEX_ENABLED', true);

const access = require('../controllers/businessAccessCodesController');
const team   = require('../controllers/businessTeamController');
const templates=require('../services/businessRoleTemplates');
const readiness=require('../services/businessTeamReadiness');
const membershipExpiry=require('../services/businessMembershipExpiry');
const templateHandler=fn=>async(req,res,next)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(error){next(error);}};
router.get('/:businessId/team/readiness',authenticate,requireBusinessAccess({minRole:'any'}),requirePermission('business.view'),templateHandler(async(req,res)=>res.json(await readiness.read(req.business.id,req.user.id))));
router.put('/:businessId/memberships/:membershipId/access-expiry',authenticate,rejectImpersonated,requireBusinessAccess({minRole:'owner'}),templateHandler(async(req,res)=>res.json(await membershipExpiry.schedule(req.business.id,req.user.id,req.params.membershipId,req.body))));
router.post('/:businessId/team/documents',authenticate,rejectImpersonated,requireBusinessAccess({minRole:'owner'}),templateHandler(async(req,res)=>res.status(201).json(await readiness.publish(req.business.id,req.user.id,req.body))));
router.post('/:businessId/team/documents/:documentId/acknowledge',authenticate,rejectImpersonated,requireBusinessAccess({minRole:'any'}),requirePermission('business.view'),templateHandler(async(req,res)=>res.json(await readiness.acknowledge(req.business.id,req.user.id,req.params.documentId))));
router.post('/:businessId/team/tasks',authenticate,rejectImpersonated,requireBusinessAccess({minRole:'any'}),requirePermission('business.view'),templateHandler(async(req,res)=>res.status(201).json(await readiness.createTask(req.business.id,req.user.id,req.body))));
router.put('/:businessId/team/tasks/:taskId',authenticate,rejectImpersonated,requireBusinessAccess({minRole:'any'}),requirePermission('business.view'),templateHandler(async(req,res)=>res.json(await readiness.completeTask(req.business.id,req.user.id,req.params.taskId,req.body))));
router.get('/:businessId/team/role-templates',authenticate,requireBusinessAccess({ minRole: 'any' }),templateHandler(async(req,res)=>res.json(await templates.list(req.params.businessId,req.user.id))));
router.post('/:businessId/team/role-templates',authenticate,rejectImpersonated,requireBusinessAccess({ minRole: 'any' }),templateHandler(async(req,res)=>res.status(201).json({template:await templates.save(req.params.businessId,req.user.id,req.body)})));
router.put('/:businessId/team/role-templates/:templateId',authenticate,rejectImpersonated,requireBusinessAccess({ minRole: 'any' }),templateHandler(async(req,res)=>res.json({template:await templates.save(req.params.businessId,req.user.id,req.body,req.params.templateId)})));
router.delete('/:businessId/team/role-templates/:templateId',authenticate,rejectImpersonated,requireBusinessAccess({ minRole: 'any' }),templateHandler(async(req,res)=>{await templates.remove(req.params.businessId,req.user.id,req.params.templateId,req.body.expectedVersion);res.sendStatus(204);}));
router.get('/:businessId/team/role-templates/:templateId/preview/:memberId',authenticate,requireBusinessAccess({ minRole: 'any' }),templateHandler(async(req,res)=>res.json(await templates.preview(req.params.businessId,req.user.id,req.params.templateId,req.params.memberId))));
router.post('/:businessId/team/role-templates/:templateId/apply',authenticate,rejectImpersonated,requireBusinessAccess({ minRole: 'any' }),templateHandler(async(req,res)=>res.json(await templates.apply(req.params.businessId,req.user.id,req.params.templateId,req.body))));

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
  rejectImpersonated,
  requireVortexEnabled,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission(['team.invite','team.assign_roles'], { mode: 'any' }),
  access.approveMembership
);

router.post(
  '/:businessId/memberships/:membershipId/deny',
  authenticate,
  rejectImpersonated,
  requireVortexEnabled,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission(['team.invite','team.remove_member'], { mode: 'any' }),
  access.denyMembership
);

router.post(
  '/:businessId/memberships/:membershipId/remove',
  authenticate,
  rejectImpersonated,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.remove_member'),
  access.removeMembership
);

// 297 (G5-34): pending-action summary shown in the remove confirm dialog.
router.get(
  '/:businessId/memberships/:membershipId/offboarding-preview',
  authenticate,
  rejectImpersonated,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.remove_member'),
  access.offboardingPreview
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
  rejectImpersonated,
  requireVortexEnabled,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.listAccessCodes
);

router.post(
  '/:businessId/access-codes',
  authenticate,
  rejectImpersonated,
  requireVortexEnabled,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.createAccessCode
);

router.post(
  '/:businessId/access-codes/:codeId/rotate',
  authenticate,
  rejectImpersonated,
  requireVortexEnabled,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.rotateAccessCode
);

router.patch(
  '/:businessId/access-codes/:codeId',
  authenticate,
  rejectImpersonated,
  requireVortexEnabled,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.updateAccessCode
);

router.delete(
  '/:businessId/access-codes/:codeId',
  authenticate,
  rejectImpersonated,
  requireVortexEnabled,
  requireBusinessAccess({ minRole: 'manager' }),
  requirePermission('team.invite'),
  access.revokeAccessCode
);

module.exports = router;
