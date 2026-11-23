'use strict';
// Groups 5-6 (items 201-300): business owner console and team member work
// routes. Mounted at /api/businesses (business-scoped) and
// /api/business-listing-claims (claimant-scoped). Every route resolves the
// live business, membership and permission server-side; persona labels and
// client state grant nothing.
const express = require('express');
const { authenticate } = require('../middleware/auth');
const requireBusinessAccess = require('../middleware/requireBusinessAccess');
const requirePermission = require('../middleware/requirePermission');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const launch = require('../services/businessOwner/launchService');
const claims = require('../services/businessOwner/listingClaimService');

const h = fn => async (req, res, next) => { res.set('Cache-Control', 'no-store'); try { await fn(req, res); } catch (e) { next(e); } };
const biz = (minRole, perm) => [authenticate, requireBusinessAccess({ minRole }), ...(perm ? [requirePermission(perm)] : [])];
const write = (minRole, perm) => [authenticate, rejectImpersonated, requireBusinessAccess({ minRole }), ...(perm ? [requirePermission(perm)] : [])];

const router = express.Router();
// 203-205 launch status + checklists
router.get('/:businessId/owner/launch-readiness', ...biz('manager', 'business.view'), h(async (req, res) => res.json(await launch.readiness(req.business.id))));
// 207, 210 offerings: regional rules and pause controls
router.get('/:businessId/owner/offerings', ...biz('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.offerings(req.business.id))));
router.put('/:businessId/owner/services/:serviceId/regions', ...write('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.setRegions(req.business.id, req.user.id, req.params.serviceId, req.body))));
router.post('/:businessId/owner/services/:serviceId/pause', ...write('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.pause(req.business.id, req.user.id, req.params.serviceId, req.body))));
router.post('/:businessId/owner/services/:serviceId/resume', ...write('manager', 'business.edit_profile'), h(async (req, res) => res.json(await launch.resume(req.business.id, req.user.id, req.params.serviceId, req.body))));

const claimRouter = express.Router();
// 201 listing claims (the service checks the claimant owns the business)
claimRouter.get('/listings', authenticate, h(async (req, res) => res.json(await claims.searchListings(req.query.q))));
claimRouter.get('/mine', authenticate, h(async (req, res) => res.json(await claims.listMine(req.user.id))));
claimRouter.post('/', authenticate, rejectImpersonated, h(async (req, res) => res.status(201).json(await claims.submit(req.user.id, req.body))));
claimRouter.post('/:claimId/withdraw', authenticate, rejectImpersonated, h(async (req, res) => res.json(await claims.withdraw(req.user.id, req.params.claimId))));

module.exports = { router, claimRouter };
