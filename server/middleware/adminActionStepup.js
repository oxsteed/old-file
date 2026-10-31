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

function issueAdminActionStepup(actionType, resolveAmountCents) {
  return async (req, res, next) => {
    try {
      let amountCents = 1;
      if (resolveAmountCents) {
        const resolved = await resolveAmountCents(req);
        if (!Number.isSafeInteger(resolved) || resolved <= 0) {
          throw new AppError('A top-up id is required to issue this challenge', 400, 'admin_stepup_topup_required');
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

module.exports = { requireAdminActionStepup, issueAdminActionStepup, resolveClawbackAmountCents };
