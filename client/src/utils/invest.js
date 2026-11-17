// OxSteed Invest client helpers (pure, projection-only).
//
// The client renders investment access from the GET /api/me/access
// projection ONLY. It never reads role, default_mode, or
// ACCESS_INVESTOR_ENFORCEMENT for invest access: investor.reporting is
// reporting-only and never implies investor.participate, and the invest
// flags in the projection are display state only (every invest route
// rechecks the flags server-side).

export function investAccessFromProjection(projection) {
  // The invest flags live on the projection itself, but callers hold the
  // projection in two shapes: the raw GET /api/me/access response
  // ({ access: <projection>, flags }) and the useAccessProjection snapshot
  // ({ access: <projection>, flags }), where the projection carries
  // `.invest` and `.personal`. Track 3 read only `projection.invest`,
  // which is undefined for both shapes live, so investEnabled was always
  // false and every invest page rendered "not available". Accept the
  // projection, the hook snapshot, and the raw response: the flags object
  // has the same keys in all three places.
  const invest = projection?.invest || projection?.access?.invest || projection?.flags || {};
  const personal = projection?.access?.personal || projection?.personal || [];
  return {
    investEnabled: invest.investEnabled === true,
    investCommitmentsEnabled: invest.investCommitmentsEnabled === true,
    investPilot: invest.investPilot === true,
    canParticipate: personal.includes('investor.participate'),
  };
}

/**
 * Account-menu entry points for Invest. Shown only when the projection
 * says the master flag is on; a missing projection or a disabled flag
 * yields no invest navigation at all. Additive only: customer links are
 * never removed or replaced by these entries.
 */
export function investNavLinks(projection) {
  if (!investAccessFromProjection(projection).investEnabled) return [];
  return [
    { id: 'exploreInvestments', to: '/invest', labelKey: 'nav.exploreInvestments', primary: false },
    { id: 'requestInvestorAccess', to: '/invest/apply', labelKey: 'nav.requestInvestorAccess', primary: false },
    { id: 'myInvestments', to: '/invest/my-investments', labelKey: 'nav.myInvestments', primary: false },
  ];
}

export function formatInvestCents(cents, currencyCode = 'USD') {
  const value = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode || 'USD' }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

/** Funding progress. Reserved commitments are pending, never completed funding. */
export function fundingProgress(targetCents, reservedCents, completedCents) {
  const target = Number(targetCents || 0);
  const reserved = Number(reservedCents || 0);
  const completed = Number(completedCents || 0);
  const percent = target > 0 ? Math.min(100, Math.round(((reserved + completed) / target) * 100)) : 0;
  return { targetCents: target, reservedCents: reserved, completedCents: completed, percent };
}

export function provenanceLabelKey(provenance) {
  if (provenance === 'checked') return 'invest.detail.provenance.checked';
  return 'invest.detail.provenance.entityProvided';
}

/** Application status label through static keys only, so the i18n gate can resolve every key. */
export function applicationStatusLabel(status, t) {
  switch (status) {
    case 'draft': return t('invest.application.status.draft');
    case 'submitted': return t('invest.application.status.submitted');
    case 'under_review': return t('invest.application.status.underReview');
    case 'needs_information': return t('invest.application.status.needsInformation');
    case 'approved': return t('invest.application.status.approved');
    case 'declined': return t('invest.application.status.declined');
    case 'withdrawn': return t('invest.application.status.withdrawn');
    default: return t('invest.application.status.draft');
  }
}

/** Document visibility label through static keys only, so the i18n gate can resolve every key. */
export function documentVisibilityLabel(visibility, t) {
  switch (visibility) {
    case 'public': return t('invest.detail.documents.visibility.public');
    case 'applicants': return t('invest.detail.documents.visibility.applicants');
    case 'committed': return t('invest.detail.documents.visibility.committed');
    case 'reviewers': return t('invest.detail.documents.visibility.reviewers');
    default: return t('invest.detail.documents.visibility.public');
  }
}
export function opportunityStatusLabel(status, t) {
  switch (status) {
    case 'draft': return t('invest.common.status.draft');
    case 'submitted': return t('invest.common.status.submitted');
    case 'under_review': return t('invest.common.status.underReview');
    case 'approved': return t('invest.common.status.approved');
    case 'published': return t('invest.common.status.published');
    case 'paused': return t('invest.common.status.paused');
    case 'closing': return t('invest.common.status.closing');
    case 'closed': return t('invest.common.status.closed');
    case 'cancelled': return t('invest.common.status.cancelled');
    case 'withdrawn': return t('invest.common.status.withdrawn');
    default: return t('invest.common.status.published');
  }
}

/** Review-queue tab label through static keys only, so the i18n gate can resolve every key. */
export function reviewQueueTabLabel(type, t) {
  switch (type) {
    case 'applications': return t('invest.review.tabs.applications');
    case 'opportunities': return t('invest.review.tabs.opportunities');
    case 'closing': return t('invest.review.tabs.closing');
    case 'proceeds': return t('invest.review.tabs.proceeds');
    default: return t('invest.review.tabs.applications');
  }
}

/** Opportunity detail-field label through static keys only, so the i18n gate can resolve every key. */
export function opportunityDetailFieldLabel(field, t) {
  switch (field) {
    case 'legalDetails': return t('invest.review.opportunity.detail.legalDetails');
    case 'financials': return t('invest.review.opportunity.detail.financials');
    case 'ownership': return t('invest.review.opportunity.detail.ownership');
    case 'risks': return t('invest.review.opportunity.detail.risks');
    case 'relatedParties': return t('invest.review.opportunity.detail.relatedParties');
    default: return t('invest.review.opportunity.detail.legalDetails');
  }
}

/** Amendment status label through static keys only, so the i18n gate can resolve every key. */
export function amendmentStatusLabel(status, t) {
  switch (status) {
    case 'draft': return t('invest.entity.manage.amendments.status.draft');
    case 'proposed': return t('invest.entity.manage.amendments.status.proposed');
    case 'effective': return t('invest.entity.manage.amendments.status.effective');
    case 'withdrawn': return t('invest.entity.manage.amendments.status.withdrawn');
    case 'rejected': return t('invest.entity.manage.amendments.status.rejected');
    default: return t('invest.entity.manage.amendments.status.draft');
  }
}

/** Update status label through static keys only, so the i18n gate can resolve every key. */
export function updateStatusLabel(status, t) {
  switch (status) {
    case 'draft': return t('invest.entity.manage.updates.status.draft');
    case 'published': return t('invest.entity.manage.updates.status.published');
    case 'overdue': return t('invest.entity.manage.updates.status.overdue');
    default: return t('invest.entity.manage.updates.status.draft');
  }
}

/** Dollars-and-cents input (e.g. "250" or "250.50") to integer cents, or null when invalid. */
export function parseAmountToCents(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/**
 * Every row the §4 review screen must show before confirmation. Returns
 * the list of missing row keys; an empty list means the review is complete.
 * The agreement version must carry its id, number, and content hash: the
 * exact version accepted is part of the commitment record.
 */
export function commitReviewMissingRows(review) {
  const missing = [];
  if (!review) return ['review'];
  if (!Number.isSafeInteger(review.amountCents) || review.amountCents <= 0) missing.push('amountCents');
  if (!('valuationRule' in review)) missing.push('valuationRule');
  if (!Array.isArray(review.fees)) missing.push('fees');
  if (!Number.isSafeInteger(review.feesTotalCents)) missing.push('feesTotalCents');
  if (!review.feesNote) missing.push('feesNote');
  if (!review.rightsSummary) missing.push('rightsSummary');
  if (!review.agreementVersion?.id || !review.agreementVersion?.versionNumber || !review.agreementVersion?.contentHash) {
    missing.push('agreementVersion');
  }
  if (review.status !== 'pending') missing.push('status');
  if (!review.statusNote) missing.push('statusNote');
  if (!review.cancellationTerms) missing.push('cancellationTerms');
  if (review.riskAcknowledged !== true) missing.push('riskAcknowledged');
  if (!review.riskNote) missing.push('riskNote');
  return missing;
}

/** Monetary reference value of a commitment at the Credit reference rate in force at reservation. */
export function commitmentReferenceCents(amountCents, creditReferenceRate) {
  if (!Number.isSafeInteger(amountCents) || typeof creditReferenceRate !== 'number') return null;
  return Math.round(amountCents * creditReferenceRate);
}
