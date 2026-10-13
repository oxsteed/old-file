import { formatMoney } from '../shared/money.js';

/**
 * Pure helpers for the change-order re-authorization banner
 * (server: services/jobPaymentReauthorizationService.js).
 */

/** Only fetch the state when the job says something is pending. */
export function jobNeedsPaymentCheck(job) {
  const meta = job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  return Boolean(meta.paymentAdjustmentRequired || meta.creditAdjustmentRequired === true || meta.paymentHoldRenewalRequired === true);
}

/**
 * Decide what the banner shows.
 * @returns {null | { mode: 'card'|'reprice'|'credit'|'waiting', targetCents?: number, authorizedCents?: number, creditCents?: number, notice?: string }}
 */
export function bannerModel(state) {
  if (!state?.required) return null;
  const req = state.requirement || {};
  if (!state.can_authorize) return { mode: 'waiting' };
  const latest = state.latest_attempt || null;
  let notice = null;
  if (latest?.status === 'pending' && latest.failure_code) notice = 'lastDeclined';
  else if (latest?.status === 'expired') notice = 'lastExpired';
  const currency = req.currency || 'USD';
  if (req.card === 'intent_reprice_required') return { mode: 'reprice', targetCents: req.target_cents, currency, notice };
  if (req.card === 'hold_expiring') {
    return { mode: 'renew', targetCents: req.target_cents, authorizedCents: req.authorized_cents, holdExpiresAt: req.hold_expires_at || null, currency, notice };
  }
  if (req.card) {
    return {
      mode: 'card',
      targetCents: req.target_cents,
      authorizedCents: req.authorized_cents,
      currency,
      expiresAt: latest?.status === 'pending' ? latest.expires_at : null,
      notice,
    };
  }
  if (req.credit) return { mode: 'credit', creditCents: req.credit_amount_cents, currency, notice };
  return { mode: 'waiting' };
}

const ERROR_KEYS = {
  credit_insufficient_funds: 'creditInsufficient',
  impersonation_blocked: 'impersonation',
  feature_disabled: 'unavailable',
  payment_reauthorization_not_required: 'notRequired',
  payment_reauthorization_amount_invalid: 'amountInvalid',
};

/** i18n key (under jobPaymentReauth.errors) for a server error code. */
export function reauthErrorKey(code) {
  return ERROR_KEYS[code] || 'generic';
}

export function formatCents(cents, language, currency = 'USD') {
  const value = Number(cents);
  if (!Number.isFinite(value)) return '';
  return formatMoney(Math.round(value), currency, language || undefined);
}
