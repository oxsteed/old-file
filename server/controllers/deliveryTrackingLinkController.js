'use strict';

/**
 * Delivery tracking-link controller.
 *
 * Authenticated endpoints let the job owner (or an internal operator) create,
 * list, revoke, and refresh signed tracking links, and fetch the customer-safe
 * tracking state for a job. The public tracking endpoint is unauthenticated:
 * an invalid token returns a generic 404 so tokens cannot be enumerated.
 */

const pool = require('../db');
const AppError = require('../utils/appError');
const linkService = require('../services/deliveryTrackingLinkService');

const INTERNAL_ROLES = new Set([
  'sourcing_operator',
  'logistics_coordinator',
  'warehouse_operator',
  'admin',
  'super_admin',
]);

// Static public support contact. No account, job, or link data.
const SUPPORT_CONTACT = {
  label: 'Delivery support',
  email: 'support@oxsteed.com',
  path: '/support',
};

function isInternalOperator(user) {
  return ['admin', 'super_admin'].includes(user?.role) || INTERNAL_ROLES.has(user?.logistics_role);
}

function isOwner(user, job) {
  return String(job.customer_user_id) === String(user?.id);
}

async function loadJob(id) {
  const { rows } = await pool.query(
    `SELECT id, reference, status, customer_user_id
       FROM delivery_jobs
      WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

function assertCanAccess(user, job) {
  if (!job) {
    throw new AppError('Delivery job not found', 404, 'delivery_job_not_found');
  }
  if (isOwner(user, job) || isInternalOperator(user)) return;
  throw new AppError('Not authorized to access tracking for this delivery', 403, 'delivery_forbidden');
}

// POST /delivery/jobs/:id/tracking/links
exports.create = async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    assertCanAccess(req.user, job);
    const link = await linkService.createLink({
      deliveryJobId: job.id,
      createdByUserId: req.user.id,
      ttlHours: req.body?.ttlHours,
    });
    // The raw token is returned exactly once; it is never stored or re-issued.
    res.status(201).json({
      success: true,
      link: {
        id: link.id,
        prefix: link.prefix,
        token: link.token,
        expiresAt: link.expiresAt,
        createdAt: link.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET /delivery/jobs/:id/tracking/links
exports.list = async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    assertCanAccess(req.user, job);
    const links = await linkService.listLinks(job.id);
    res.json({ success: true, links });
  } catch (error) {
    next(error);
  }
};

// POST /delivery/jobs/:id/tracking/links/:linkId/revoke
exports.revoke = async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    assertCanAccess(req.user, job);
    const link = await linkService.revokeLink({
      linkId: req.params.linkId,
      deliveryJobId: job.id,
      reason: req.body?.reason,
    });
    res.json({ success: true, link });
  } catch (error) {
    next(error);
  }
};

// POST /delivery/jobs/:id/tracking/links/:linkId/refresh
exports.refresh = async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    assertCanAccess(req.user, job);
    const { link, revoked } = await linkService.refreshLink({
      linkId: req.params.linkId,
      deliveryJobId: job.id,
      createdByUserId: req.user.id,
      ttlHours: req.body?.ttlHours,
    });
    res.json({
      success: true,
      link: {
        id: link.id,
        prefix: link.prefix,
        token: link.token,
        expiresAt: link.expiresAt,
        createdAt: link.createdAt,
      },
      revoked,
    });
  } catch (error) {
    next(error);
  }
};

// GET /delivery/jobs/:id/tracking/customer-state
exports.customerState = async (req, res, next) => {
  try {
    const job = await loadJob(req.params.id);
    assertCanAccess(req.user, job);
    const state = await linkService.getCustomerTrackingState(job.id);
    res.json({ success: true, state });
  } catch (error) {
    next(error);
  }
};

// GET /delivery/t/public/:token — PUBLIC, no auth.
// Allowlisted response shape only. An unknown token returns a generic 404.
exports.publicTrack = async (req, res, next) => {
  try {
    let resolved;
    try {
      resolved = await linkService.resolveToken(req.params.token);
    } catch (error) {
      // Unify invalid and expired responses to prevent token oracle attacks.
      // Both return 404 with the same body.
      return res.status(404).json({ error: 'Not found', code: 'not_found', status: 404 });
    }

    const state = await linkService.getCustomerTrackingState(resolved.deliveryJobId);
    return res.json({
      reference: state.reference,
      status: state.statusLabel,
      milestones: state.milestones,
      eta: { at: state.eta.at, freshness: state.eta.freshness },
      approximateArea: state.approximateArea,
      maskedPickup: state.maskedPickup,
      maskedDropoff: state.maskedDropoff,
      supportContact: SUPPORT_CONTACT,
    });
  } catch (error) {
    next(error);
  }
};
