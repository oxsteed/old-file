import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const creditDir = path.resolve('src/admin/pages/super/oxsteedCredit');
const source = fs.readdirSync(creditDir)
  .filter((file) => file.endsWith('.jsx'))
  .sort()
  .map((file) => fs.readFileSync(path.join(creditDir, file), 'utf8'))
  .join('\n');
const customerDetailSource = fs.readFileSync(path.resolve('src/admin/pages/super/OxsteedCreditCustomerDetail.jsx'), 'utf8');

test('Credit admin operator surfaces use translated labels', () => {
  const requiredKeys = [
    'adminCurrencyControls',
    'adminBalancesByCurrency',
    'adminTransactionHistory',
    'adminMovementType',
    'adminStatusFilter',
    'adminCurrencyFilter',
    'adminNoCreditMovements',
    'adminRestaurantParty',
    'adminFundingSpendingTransferLimits',
    'adminRiskGuardrailsDescription',
    'adminPerTransaction',
    'adminDailyFunding',
    'adminDailyTransfers',
    'adminCustomerWallets',
    'adminFindWalletBeforeAction',
    'adminCustomerWalletSearchDescription',
    'adminSearchWallets',
    'adminAccountState',
    'adminShowingMatchingWallets',
    'adminGrantAdjustFreezeCredit',
    'adminCustomerControlsDescription',
    'adminGrantCredit',
    'adminClawBackCredit',
    'adminAccountSafetyState',
    'adminPostGrant',
    'adminPostClawback',
    'adminUpdateAccountState',
    'adminPartnerLookup',
    'adminFindEnrolledRestaurant',
    'adminPartnerLookupDescription',
    'adminOptionalMenuRestrictions',
    'adminGeographicCoverage',
    'adminCreateDraftAgreement',
    'adminPartnerPickerMatches',
    'adminPartnerPickerLoaded',
    'adminPartnerPickerPlaceholder',
    'adminFindPartners',
    'adminPartnerPickerQuerySummary',
    'adminPartnerPickerSummary',
    'adminOrderTypesPlaceholder',
    'adminCoverageCitiesPlaceholder',
    'adminCoverageStatesPlaceholder',
    'adminCoveragePostalCodesPlaceholder',
    'adminCoverageCountriesPlaceholder',
    'adminOperationalBoundary',
    'adminOperationalBoundaryDescription',
    'adminSystemMovement',
    'disputeIncorrectAmount',
    'disputeUnauthorized',
    'disputeDuplicate',
    'disputeRestaurantIssue',
    'adminNotificationAttempts',
    'adminNotificationRecipient',
    'adminChooseCreditPartnerError',
    'adminAgreementCreated',
    'adminPartnerTransitionTitle',
    'adminAgreementTransitionTitle',
    'adminSettlementTransitionTitle',
    'adminExternalPaymentReference',
    'adminSettlementReversalTitle',
    'adminReconciliationBalanced',
    'adminCustomerGrantPosted',
    'adminConfirmCustomerClawback',
    'adminRailReasonRequired',
    'adminNotificationRequeued',
    'adminDisputeResolutionRequired',
    'adminPostedPurchaseOnly',
    'adminConfirmCreditRefund',
    'adminTransactionCsvDownloaded',
    'adminCustomerWalletSelected',
    'adminLoadFailed',
    'adminRetryDashboard',
  ];

  for (const key of requiredKeys) {
    assert.match(source, new RegExp(`t\\(['"]${key}['"]`), `missing translated admin key ${key}`);
  }

  for (const key of ['adminAgreementBuilder', 'adminCreateSpendingAgreement', 'adminAgreementBuilderDescription']) {
    assert.match(source, new RegExp(`['"]${key}['"]`), `missing translated section key ${key}`);
  }

  const sectionEyebrows = [...source.matchAll(/<Section eyebrow="([^"]+)"/g)].map(([, value]) => value);
  for (const eyebrow of sectionEyebrows) {
    const escapedEyebrow = eyebrow.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
    assert.match(source, new RegExp(`(?:['"]${escapedEyebrow}['"]|\\b${escapedEyebrow}\\b)\\s*:\\s*\\{`), `missing admin section translation mapping ${eyebrow}`);
  }

  for (const literal of [
    'Currency controls',
    'Balances by currency',
    'No automatic foreign-exchange conversion',
    'Credit transaction history',
    'Movement type',
    'All movement types',
    'No Credit movements match these filters.',
    'Funding, spending, and transfer limits',
    'Hard cap for one movement',
    'Outbound transfers per day',
    'Customer wallets',
    'Find a wallet before taking action',
    'Search wallets',
    'No customer wallets match these filters.',
    'Grant, adjust, or freeze OxSteed Credit',
    'Every grant requires a funding reference.',
    'Grant credit',
    'Claw back credit',
    'Account safety state',
    'Post grant',
    'Post clawback',
    'Update account state',
    'Partner lookup',
    'Find any enrolled restaurant',
    'The forms below start with the loaded partner list.',
    'Optional menu restrictions',
    'Geographic coverage',
    'Create draft agreement',
    'Find partners',
    'e.g. Springfield Bistro or 123',
    'pickup, delivery',
    'Springfield, Dayton',
    'Operational boundary:',
  ]) {
    assert.doesNotMatch(source, new RegExp(`>${literal.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}<`), `hard-coded admin label remains: ${literal}`);
  }

  assert.match(source, /function geographyLabel\(geography, t\)/);
  assert.match(source, /function creditTransactionLabel\(transaction, t\)/);
  assert.match(source, /function creditNotificationLabel\(notification, t\)/);
  assert.match(source, /function transactionPartyLabel\(transaction, t\)/);
  assert.match(source, /function workerDisplayName\(jobName, t\)/);
  for (const key of [
    'transactionFee',
    'transactionSettlement',
    'transactionSettlementReversal',
    'transactionFunding',
    'transactionReserveRelease',
    'transactionCashOut',
    'transactionUnknown',
    'notificationTransactionPosted',
    'notificationHoldCreated',
    'notificationHoldCaptured',
    'notificationHoldReleased',
    'notificationHoldExpired',
    'notificationUnknown',
  ]) {
    assert.match(source, new RegExp(`['"]${key}['"]`), `missing transaction translation mapping ${key}`);
  }
  assert.doesNotMatch(source, /return `Customer \$\{/);
  assert.doesNotMatch(source, /return `Partner \$\{/);
  assert.doesNotMatch(source, /return 'System movement'/);
  assert.doesNotMatch(source, /String\(notification\.eventType \|\| 'notification'\)\.replace/);
  assert.doesNotMatch(source, /\{notification\.attempts\} attempts · recipient/);
  assert.doesNotMatch(source, /replace\(\/\^oxsteed-credit-/);
  assert.doesNotMatch(source, /setError\(\s*['\"][^'\"]+['\"]\s*\)/);
  assert.doesNotMatch(source, /setNotice\(\s*['\"][^'\"]+['\"]\s*\)/);
  assert.doesNotMatch(source, /set(?:Error|Notice)\(\s*`/);
  assert.doesNotMatch(source, /safeCreditErrorMessage\([^\n]*,\s*['\"][^'\"]+['\"]\s*\)/);
  assert.match(source, /safeCreditErrorMessage\(err, t\('adminLoadFailed'\)\)/);
  assert.match(source, /role="alert" aria-live="assertive"/);
  assert.match(source, /onClick=\{\(\) => load\(\{ quiet: true \}\)\}/);
  assert.doesNotMatch(source, /requestDialog\(\{[\s\S]{0,500}?title:\s*['\"]/);
  assert.doesNotMatch(source, /selected for \$\{/);

  assert.match(customerDetailSource, /function dateTime\(value, t\)/);
  assert.match(customerDetailSource, /i18n\.t\(`credit:\$\{key\}`/);
  assert.match(customerDetailSource, /return labels\[transaction\.transactionType\] \|\| t\('transactionUnknown'\)/);
  assert.match(customerDetailSource, /settlement_reversal: t\('transactionSettlementReversal'\)/);
  assert.match(customerDetailSource, /function disputeReasonLabel\(value, t\)/);
  assert.doesNotMatch(customerDetailSource, /String\(transaction\.transactionType \|\| 'ledger_transaction'\)\.replace/);
  assert.doesNotMatch(customerDetailSource, /String\(dispute\.reasonCode \|\| 'other'\)\.replace/);
});
