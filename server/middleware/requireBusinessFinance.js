'use strict';

/**
 * requireBusinessFinance — code-gated finance middleware (G-8).
 *
 * Mount AFTER requireBusinessAccess, which attaches req.business,
 * req.businessRole and req.permissions (the caller's effective permission
 * set: role defaults + membership overrides). Owners hold every code, so
 * they always pass. A member passes a read gate by holding any finance
 * read code (invoices.view / payments.view / payouts.view) and a write
 * gate by holding the named write code. No role check: a representative
 * with an invoices.view override reads, a manager with a deny override
 * does not, and a manager never manages payouts without payouts.manage.
 */

const { sendError } = require('../utils/apiError');
const permissionsService = require('../services/permissionsService');
const { canReadBusinessFinance, canWriteBusinessFinance, FINANCE_READ_CODES } = require('../utils/businessOwnership');

function requireFinanceRead(codes = FINANCE_READ_CODES) {
  return async function requireFinanceReadMw(req, res, next) {
    try {
      if (!req.business || !req.user?.id) {
        return sendError(res, 404, 'Business not found.', 'business_not_found');
      }
      if (req.businessRole === 'owner') return next();
      if (req.permissions && permissionsService.hasAny(req.permissions, codes)) return next();
      // Fallback when the chain skipped permission resolution: re-resolve
      // from the helper instead of failing open or closed on a guess.
      const access = await canReadBusinessFinance(req.user.id, req.business.id);
      if (access) return next();
      return sendError(res, 403, 'Finance read access is required.', 'business_finance_read_required');
    } catch (err) {
      return next(err);
    }
  };
}

function requireFinanceWrite(code = 'invoices.create') {
  return async function requireFinanceWriteMw(req, res, next) {
    try {
      if (!req.business || !req.user?.id) {
        return sendError(res, 404, 'Business not found.', 'business_not_found');
      }
      if (req.businessRole === 'owner') return next();
      if (req.permissions && permissionsService.hasAny(req.permissions, [code])) return next();
      const access = await canWriteBusinessFinance(req.user.id, req.business.id, code);
      if (access) return next();
      return sendError(res, 403, 'Finance write access is required.', 'business_finance_write_required');
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireFinanceRead, requireFinanceWrite, FINANCE_READ_CODES };
