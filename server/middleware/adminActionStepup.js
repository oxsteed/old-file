'use strict';

// Step-up challenge wrappers for admin money actions that go through the
// shared middleware instead of a dedicated controller (top-up clawback,
// top-up approve, fee-config updates). The issue side mints the challenge;
// the verify side checks it before the controller runs.
//
// Auth audit item 6: both factories accept an optional resolver,
// resolveAmountCents(req) -> amount|null. When a resolver is supplied and
// returns a positive amount, the challenge is bound to it. When it
// returns null, binding is skipped (legacy behavior) so a pre-read
// failure never invents a new error. The verify side only resolves when
// the request actually carries a challenge id: without one the verify
// fails with challenge_required anyway, and resolving would add a query
// for requests that were never going to pass. The issue side fails
// closed (400) when its resolver returns null for an action that only
// makes sense against a specific record (clawback), because a challenge
// without a top-up to bind it to is meaningless.
//
// Only clawback carries a resolver today: it moves a determinate top-up
// amount. Top-up approve is an eligibility decision (the application row
// carries no acted-on amount) and fee-config updates carry no single
// money amount, so both keep unbound challenges by design.

const { issueStepupChallenge, verifyStepupChallenge } = require('../services/stepupChallengeService');
const { AppError } = require('./errorHandler');

function requireAdminActionStepup(actionType, resolveAmountCents) {
  return async (req, res, next) => {
    try {
      const challengeId = req.body?.stepupChallengeId || req.body?.stepup_challenge_id;
      let expectedAmountCents;
      if (resolveAmountCents && challengeId) {
        const resolved = await resolveAmountCents(req);
        if (Number.isSafeInteger(resolved) && resolved > 0) expectedAmountCents = resolved;
      }
      await verifyStepupChallenge({
        challengeId,
        actorUserId: req.user?.id || null,
        actionType,
        code: req.body?.stepupCode || req.body?.stepup_code,
        ...(expectedAmountCents !== undefined ? { expectedAmountCents } : {}),
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Conditional variant: only actions whose request matches the predicate
// need a fresh step-up challenge; everything else passes straight through
// to the controller. Used where only some transitions on one route close
// money (payment-dispute approved/resolved), while the rest (under_review,
// denied) are review moves that need no fresh proof.
function requireAdminActionStepupIf(predicate, actionType, resolveAmountCents) {
  const gate = requireAdminActionStepup(actionType, resolveAmountCents);
  return async function adminActionStepupIf(req, res, next) {
    try {
      if (predicate(req)) return gate(req, res, next);
      return next();
    } catch (err) {
      next(err);
    }
  };
}

function issueAdminActionStepup(actionType, resolveAmountCents) {
  return async (req, res, next) => {
    try {
      let amountCents = 1;
      if (resolveAmountCents) {
        const resolved = await resolveAmountCents(req);
        if (!Number.isSafeInteger(resolved) || resolved <= 0) {
          throw new AppError('An id is required to issue this challenge', 400, 'admin_stepup_id_required');
        }
        amountCents = resolved;
      }
      const { challenge, delivery } = await issueStepupChallenge({
        actorUserId: req.user?.id || null,
        actorEmail: req.user?.email,
        actionType,
        amountCents,
      });
      res.status(201).json({ challenge: { id: challenge.id, method: challenge.method, expiresAt: challenge.expiresAt }, delivery });
    } catch (err) {
      next(err);
    }
  };
}

// Clawback resolver: the top-up's amount. Reads topupId from the body or
// the route params; returns null (never throws) when the id is absent or
// the row is missing, so the verify side skips binding and the issue
// side fails closed with its own 400.
async function resolveClawbackAmountCents(req) {
  const topupId = req.body?.topupId ?? req.body?.topup_id ?? req.params?.topupId ?? req.params?.id;
  if (topupId === undefined || topupId === null || String(topupId).trim() === '') return null;
  try {
    const pool = require('../db');
    const { rows } = await pool.query('SELECT amount_cents FROM restaurant_topups WHERE id = $1', [topupId]);
    if (!rows.length) return null;
    const n = Number(rows[0].amount_cents);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch (err) {
    return null;
  }
}

// Domain 7 #1: the payment dispute's requested refund amount. Reads the
// dispute id from the body (challenge issue) or the route params
// (decision verify); returns null (never throws) when the id is absent or
// the row is missing, so the verify side skips binding and the issue side
// fails closed with its own 400. A dispute with no positive requested
// amount (null/0) still needs an issuable challenge to close with a
// no-refund reason, so it binds to 1, the same unbound-equivalent amount
// the issue side uses when no resolver is supplied.
async function resolveDisputeAmountCents(req) {
  const disputeId = req.body?.disputeId ?? req.body?.dispute_id ?? req.params?.id;
  if (disputeId === undefined || disputeId === null || String(disputeId).trim() === '') return null;
  try {
    const pool = require('../db');
    const { rows } = await pool.query('SELECT requested_refund_cents FROM main_app_payment_disputes WHERE id = $1', [disputeId]);
    if (!rows.length) return null;
    const n = Number(rows[0].requested_refund_cents);
    return Number.isSafeInteger(n) && n > 0 ? n : 1;
  } catch (err) {
    return null;
  }
}

module.exports = { requireAdminActionStepup, requireAdminActionStepupIf, issueAdminActionStepup, resolveClawbackAmountCents, resolveDisputeAmountCents };
