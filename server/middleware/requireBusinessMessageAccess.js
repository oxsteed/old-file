'use strict';

const { sendError } = require('../utils/apiError');

function requireBusinessMessageAccess(action = 'view') {
  if (!['view','reply','create','assign'].includes(action)) throw new TypeError('Unknown message action');
  const gate = (req, res, next) => {
    const has = code => req.permissions?.has(code) === true;
    const all = has('messages.view_all');
    if (!req.business || !req.user?.id || !has('business.view') || !(all || has('messages.view_assigned'))
        || (['reply','create'].includes(action) && !has('messages.reply'))
        || (action === 'assign' && !(all && has('messages.assign_threads')))) {
      return sendError(res,403,'Message permission required','business_permission_required');
    }
    req.messageAccess = Object.freeze({ all, userId: req.user.id,
      canReply: has('messages.reply'), canAssign: all && has('messages.assign_threads') });
    res.set('Cache-Control','private, no-store');
    next();
  };
  Object.defineProperty(gate,'messagePermissionGate',{value:action});
  return gate;
}

function messageScopeClause(req, params, alias = 'business_conversations') {
  if (!/^[a-z_]+$/.test(alias)) throw new TypeError('Invalid message scope alias');
  if (req.messageAccess?.all !== false) return '';
  params.push(req.messageAccess.userId);
  const user = `$${params.length}::uuid`;
  // Team channels have no private recipient list. Their participant table is
  // a read-receipt table populated on first read, not an access-control list.
  return ` AND (${alias}.assigned_to_user_id = ${user} OR ${alias}.conversation_type = 'team')`;
}

module.exports = { requireBusinessMessageAccess, messageScopeClause };
