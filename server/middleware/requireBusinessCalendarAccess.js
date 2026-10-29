'use strict';

const { sendError } = require('../utils/apiError');

// Runs after requireBusinessAccess: role defaults and membership overrides
// have already been resolved by the server. Body/query assignees grant nothing.
function requireBusinessCalendarAccess(action = 'view') {
  if (!['view', 'manage', 'manageAll', 'payment'].includes(action)) throw new TypeError('Unknown calendar action');
  const gate = (req, res, next) => {
    const has = permission => req.permissions?.has(permission) === true;
    const viewAll = has('calendar.view_all');
    const viewSelf = has('calendar.view_self');
    const manageAll = viewAll && has('calendar.manage_all');
    const manageSelf = (viewAll || viewSelf) && has('calendar.manage_self');
    const payment = manageAll && ['owner', 'manager'].includes(req.businessRole) && has('invoices.create');
    if (!req.business || !req.user?.id || !has('business.view') || !(viewAll || viewSelf)
        || (action === 'manage' && !(manageAll || manageSelf))
        || (action === 'manageAll' && !manageAll) || (action === 'payment' && !payment)) {
      return sendError(res, 403, 'Calendar permission required', 'business_permission_required');
    }
    req.calendarAccess = Object.freeze({ userId: req.user.id,
      all: action === 'view' ? viewAll : manageAll,
      canManageAll: manageAll, canManageSelf: manageSelf,
      canCreate: manageAll, canRecordPayment: payment });
    res.set('Cache-Control', 'private, no-store');
    next();
  };
  Object.defineProperty(gate, 'calendarPermissionGate', { value: action });
  return gate;
}

// Only static column identifiers supplied by controllers are accepted. The
// authenticated assignee is always a bound value, including aggregate counts.
function calendarScopeClause(req, params, column = 'staff_id') {
  if (!/^(?:[a-z_]+\.)?(?:staff_id|assignee_id|helper_id)$/.test(column)) throw new TypeError('Invalid calendar scope column');
  if (req.calendarAccess?.all !== false) return '';
  params.push(req.calendarAccess.userId);
  return ` AND ${column} = $${params.length}::uuid`;
}

module.exports = { requireBusinessCalendarAccess, calendarScopeClause };
