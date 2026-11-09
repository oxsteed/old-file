// Payload templates for the two-admin oversight actions, so the requesting
// admin starts from the exact fields the server validates. The server stays
// the source of truth: an unknown or malformed field is rejected there.

export const OVERSIGHT_TEMPLATES = Object.freeze({
  credit_access_review_complete: { reviewId: '' },
  credit_business_holiday_set: { countryCode: 'HT', date: 'YYYY-MM-DD', name: '', remove: false },
  credit_cashout_dispute_resolve: { disputeId: '', outcome: 'resolved_paid_confirmed', resolution: '', destinationId: '' },
  credit_cashout_release: { cashoutId: '' },
  credit_disclosure_publish: { kind: 'short_form', language: 'en', title: '', body: '', approvedReference: '' },
  credit_dormancy_policy_set: { countryCode: 'HT', enabled: false, dormantAfterDays: 1095, noticePeriodDays: 60, authorityName: '', legalReference: '' },
  credit_escheat_execute: { caseId: '' },
  credit_escheat_reclaim: { caseId: '', verificationNote: '' },
  credit_escheat_remit: { caseIds: [], authorityReference: '' },
  credit_fx_reference_rate_entry: { quoteCurrency: 'HTG', unitsPerUsd: '', rateDate: 'YYYY-MM-DD', note: '' },
  credit_kyc_requirement_waive: { requirementId: '', reason: '' },
  credit_limit_reference_rate_update: { currencyCode: 'HTG', unitsPerUsd: '', asOf: 'YYYY-MM-DD', source: 'BRH' },
  credit_limit_rule_update: { scope: 'currency', scopeCode: 'HTG', kycTier: null, limitKey: '', amountMinor: 0, currencyCode: 'HTG', active: true, note: '' },
  credit_safeguarding_account_add: { institutionName: '', accountKind: 'safeguarding', accountReferenceMasked: '', currencyCode: 'HTG', label: '', acknowledgementReference: '', evidenceSha: '' },
  credit_safeguarding_balance_entry: { accountId: '', asOfDate: 'YYYY-MM-DD', balanceMinor: 0, statementReference: '', evidenceSha: '' },
  credit_sanctions_custom_entry_add: { entryType: 'individual', primaryName: '', aliases: [], birthDates: [], countries: ['HT'], legalBasis: '', sourceReference: '' },
  credit_sanctions_custom_entry_remove: { entryId: '', reason: '' },
  credit_sar_approve: { sarId: '' },
  credit_wind_down_start: { reason: '', redemptionDeadline: 'YYYY-MM-DD' },
  credit_wind_down_issue_redemptions: { planId: '' },
  credit_wind_down_mark_unclaimed: { planId: '' },
  credit_wind_down_complete: { planId: '' },
  credit_wind_down_cancel: { planId: '', reason: '' },
});

/** Translated label for an oversight action type; unknown types show the code. */
export function actionTypeLabel(t, actionType) {
  return t(`adminLicence.actionTypes.${actionType}`, { defaultValue: actionType });
}

export function templateFor(actionType) {
  return JSON.stringify(OVERSIGHT_TEMPLATES[actionType] || {}, null, 2);
}

/** Client-side mirror of server/services/fx/manualReferenceRate.js validate(). */
export function manualRateProblem(form) {
  const q = String(form.quoteCurrency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(q) || q === 'USD') return 'fxManualBadCurrency';
  const units = String(form.unitsPerUsd || '').trim();
  if (!/^\d{1,8}(\.\d{1,8})?$/.test(units) || Number(units) <= 0) return 'fxManualBadRate';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.rateDate || ''))) return 'fxManualBadDate';
  if (String(form.note || '').trim().length < 5) return 'fxManualBadNote';
  return null;
}
