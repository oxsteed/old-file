 'use strict';
const { issueStepupChallenge, verifyStepupChallenge } = require('../services/stepupChallengeService');
function requireAdminActionStepup(actionType) {
  return async (req, res, next) => {
    try {
      await verifyStepupChallenge({ challengeId: req.body?.stepupChallengeId, actorUserId: req.user.id, actionType, code: req.body?.stepupCode });
      next();
    } catch (err) { next(err); }
  };
}
function issueAdminActionStepup(actionType) {
  return async (req, res, next) => {
    try {
      const { challenge, delivery } = await issueStepupChallenge({ actorUserId: req.user.id,
        actorEmail: req.user.email, actionType, amountCents: 1 });
      res.status(201).json({ challenge: { id: challenge.id, method: challenge.method, expiresAt: challenge.expiresAt }, delivery });
    } catch (err) { next(err); }
  };
}
module.exports = { requireAdminActionStepup, issueAdminActionStepup };
