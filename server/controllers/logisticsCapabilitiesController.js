'use strict';
/**
 * Server-derived logistics capabilities for the authenticated user.
 *
 * GET /api/logistics/capabilities → { success: true, data: capabilities }
 *
 * This is the same capability model the server enforces on mutations via
 * requireLogisticsCapability, so the permission-aware nav (LogisticsNav)
 * and UI action gating can rely on it instead of duplicating role logic on
 * the client. Per-entity ownership (organizer of this campaign, buyer of
 * this order) is still enforced at the controller/service level; the
 * capabilities here are role-level.
 *
 * Logistics eligibility never gates account surfaces: this controller only
 * answers about logistics workspaces and is mounted under /api/logistics.
 */
const { resolveLogisticsRole } = require('../middleware/requireLogisticsAccess');
const { resolveCapabilities } = require('../services/logisticsStateMachine');

exports.getCapabilities = async (req, res, next) => {
  try {
    const logisticsRole = req.logisticsRole || await resolveLogisticsRole(req.user);
    const capabilities = resolveCapabilities({ user: req.user, logisticsRole });
    res.json({ success: true, data: capabilities });
  } catch (err) { next(err); }
};
