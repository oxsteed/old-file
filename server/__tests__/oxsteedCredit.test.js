'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/oxsteedCreditController');
const service = require('../services/oxsteedCreditService');
const { REQUIRED_INDEXES, REQUIRED_INTEGRITY_TRIGGERS, findUnsupportedCurrencyRecords, verifyEntryHashes } = require('../scripts/verify-oxsteed-credit');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

function createCustomerApp(role = 'customer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: CUSTOMER_ID, role };
    req.correlationId = 'request-credit-test';
    next();
  });
  app.get('/account', controller.getMyAccount);
  app.get('/limits', controller.getMyCreditLimits);
  app.get('/status', controller.getMyCreditStatus);
  app.get('/holds', controller.listMyHolds);
  app.get('/eligible-partners', controller.getEligiblePartners);
  app.get('/statement.csv', controller.downloadMyStatement);
  app.get('/statement', controller.getMyStatement);
  app.get('/transactions', controller.getMyTransactions);
  app.get('/transactions/:transactionId', controller.getMyTransaction);
  app.post('/holds', controller.createMyHold);
  app.post('/transfers', controller.transferMyCredit);
  app.post('/disputes', controller.openMyDispute);
  app.get('/disputes', controller.listMyDisputes);
  app.use(errorHandler);
  return app;
}

function createAdminApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: ADMIN_ID, role: 'super_admin' };
    req.correlationId = 'request-credit-admin-test';
    next();
  });
  app.post('/load/:customerId', controller.adminLoadCredit);
  app.post('/adjust/:customerId', controller.adminAdjustCredit);
  app.post('/capture/:holdId', controller.adminCaptureHold);
  app.get('/overview', controller.getAdminOverview);
  app.get('/partners/directory', controller.listAdminPartnerDirectory);
  app.get('/partners.csv', controller.downloadAdminPartners);
  app.get('/agreements.csv', controller.downloadAdminAgreements);
  app.get('/accounts.csv', controller.downloadAdminCustomerAccounts);
  app.get('/accounts/:customerId/eligible-partners', controller.getAdminCustomerEligiblePartners);
  app.get('/accounts/:customerId/statement.csv', controller.downloadAdminCustomerStatement);
  app.get('/settlements', controller.listAdminSettlements);
  app.get('/settlements.csv', controller.downloadAdminSettlements);
  app.get('/reconciliation', controller.listAdminCreditReconciliationRuns);
  app.get('/reconciliation.csv', controller.downloadAdminCreditReconciliationRuns);
  app.get('/transactions', controller.listAdminTransactions);
  app.get('/transactions.csv', controller.downloadAdminTransactions);
  app.get('/transactions/:transactionId', controller.getAdminTransaction);
  app.get('/rail', controller.getAdminCreditRail);
  app.post('/rail', controller.updateAdminCreditRail);
  app.post('/status/:customerId', controller.adminUpdateCreditAccountStatus);
  app.post('/entitlements/bulk', controller.bulkUpsertAdminEntitlements);
  app.get('/disputes', controller.listAdminDisputes);
  app.get('/disputes.csv', controller.downloadAdminCreditDisputes);
  app.get('/entitlements.csv', controller.downloadAdminEntitlements);
  app.get('/audit-events', controller.listAdminCreditAuditEvents);
  app.get('/audit-events.csv', controller.downloadAdminCreditAuditEvents);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = 'credit-test-ledger-secret-32-chars!!';
});

test('credit verification identifies records outside the configured currency allowlist', () => {
  expect(findUnsupportedCurrencyRecords([
    { resource_type: 'account', currency_code: 'USD' },
    { resource_type: 'partner', currency_code: ' jpy ' },
    { resource_type: 'transaction', currency_code: 'JPY' },
  ], ['USD'])).toEqual([
    { resourceType: 'partner', currencyCode: 'JPY' },
    { resourceType: 'transaction', currencyCode: 'JPY' },
  ]);
});

test('credit verification checks every declared integrity trigger', () => {
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_transaction_partner_account_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_purchase_boundary_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_settlement_immutability_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_agreement_terms_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_user_role_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_transaction_customer_activity_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_transaction_spend_account_state_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_hold_customer_activity_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_hold_account_state_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_refund_boundary_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_transaction_actor_identity_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_user_activity_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_agreement_state_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_partner_status_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_agreement_approval_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_account_state_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_restaurant_status_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_settlement_approval_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_issuance_actor_evidence_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_partner_creator_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_agreement_creator_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_entitlement_creator_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_settlement_creator_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_settlement_overlap_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_settlement_reference_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_account_ledger_write_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_hold_terminal_evidence_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_dispute_actor_evidence_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_hold_actor_evidence_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_transaction_actor_owner_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_notification_outbox_source_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_hold_notification_outbox_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_purchase_reference_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_restaurant_staff_evidence_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_purchase_reference_uniqueness_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_purchase_actor_evidence_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_entitlement_agreement_state_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_agreement_entitlement_status_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_hold_lifecycle_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_issuance_trace_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_dispute_integrity_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_admin_refund_evidence_guard');
  expect(REQUIRED_INTEGRITY_TRIGGERS).toContain('oxsteed_credit_hold_immutable_guard');
  expect(new Set(REQUIRED_INTEGRITY_TRIGGERS).size).toBe(REQUIRED_INTEGRITY_TRIGGERS.length);
});

test('credit verification treats customer activity protection as required', () => {
  const verifierSource = require('fs').readFileSync(require.resolve('../scripts/verify-oxsteed-credit'), 'utf8');
  expect(verifierSource).toContain("['457_oxsteed_credit_customer_activity.sql']");
  expect(verifierSource).toContain('!checks.customerActivityMigrationApplied');
  expect(verifierSource).toContain("['458_oxsteed_credit_issuance_trace.sql']");
  expect(verifierSource).toContain('!checks.issuanceTraceMigrationApplied');
  expect(verifierSource).toContain("['459_oxsteed_credit_hold_lifecycle.sql']");
  expect(verifierSource).toContain('!checks.holdLifecycleMigrationApplied');
  expect(verifierSource).toContain("['460_oxsteed_credit_settlement_period.sql']");
  expect(verifierSource).toContain('!checks.settlementPeriodMigrationApplied');
  expect(verifierSource).toContain("['461_oxsteed_credit_adjustment_direction.sql']");
  expect(verifierSource).toContain('!checks.adjustmentDirectionMigrationApplied');
  expect(verifierSource).toContain("['462_oxsteed_credit_reserved_transaction_types.sql']");
  expect(verifierSource).toContain('!checks.reservedTransactionTypesMigrationApplied');
  expect(verifierSource).toContain("['463_oxsteed_credit_dispute_status_evidence.sql']");
  expect(verifierSource).toContain('!checks.disputeStatusEvidenceMigrationApplied');
  expect(verifierSource).toContain("['464_oxsteed_credit_reservation_consistency.sql']");
  expect(verifierSource).toContain('!checks.reservationConsistencyMigrationApplied');
  expect(verifierSource).toContain("['465_oxsteed_credit_transaction_status.sql']");
  expect(verifierSource).toContain('!checks.transactionStatusMigrationApplied');
  expect(verifierSource).toContain("['466_oxsteed_credit_settlement_payment_evidence.sql']");
  expect(verifierSource).toContain('!checks.settlementPaymentEvidenceMigrationApplied');
  expect(verifierSource).toContain("['467_oxsteed_credit_audit_hash_chain.sql']");
  expect(verifierSource).toContain('!checks.auditHashChainMigrationApplied');
  expect(verifierSource).toContain("['468_oxsteed_credit_admin_refund_evidence.sql']");
  expect(verifierSource).toContain('!checks.adminRefundEvidenceMigrationApplied');
  expect(verifierSource).toContain("['469_oxsteed_credit_hold_immutability.sql']");
  expect(verifierSource).toContain('!checks.holdImmutabilityMigrationApplied');
  expect(verifierSource).toContain("['476_oxsteed_credit_refund_boundary.sql']");
  expect(verifierSource).toContain('!checks.refundBoundaryMigrationApplied');
  expect(verifierSource).toContain("['477_oxsteed_credit_actor_identity.sql']");
  expect(verifierSource).toContain('!checks.actorIdentityMigrationApplied');
  expect(verifierSource).toContain("['478_oxsteed_credit_deactivation_policy.sql']");
  expect(verifierSource).toContain('!checks.deactivationPolicyMigrationApplied');
  expect(verifierSource).toContain("['479_oxsteed_credit_agreement_state.sql']");
  expect(verifierSource).toContain('!checks.agreementStateMigrationApplied');
  expect(verifierSource).toContain("['480_oxsteed_credit_agreement_approval.sql']");
  expect(verifierSource).toContain('!checks.agreementApprovalMigrationApplied');
  expect(verifierSource).toContain("['481_oxsteed_credit_approval_history.sql']");
  expect(verifierSource).toContain('!checks.approvalHistoryMigrationApplied');
  expect(verifierSource).toContain("['482_oxsteed_credit_account_state.sql']");
  expect(verifierSource).toContain('!checks.accountStateMigrationApplied');
  expect(verifierSource).toContain("['483_oxsteed_credit_suspended_expiry.sql']");
  expect(verifierSource).toContain('!checks.suspendedExpiryMigrationApplied');
  expect(verifierSource).toContain("['484_oxsteed_credit_partner_hold_release.sql']");
  expect(verifierSource).toContain('!checks.partnerHoldReleaseMigrationApplied');
  expect(verifierSource).toContain("['485_oxsteed_credit_restaurant_status.sql']");
  expect(verifierSource).toContain('!checks.restaurantStatusMigrationApplied');
  expect(verifierSource).toContain("['486_oxsteed_credit_settlement_approval.sql']");
  expect(verifierSource).toContain('!checks.settlementApprovalMigrationApplied');
  expect(verifierSource).toContain("['487_oxsteed_credit_issuance_actor_evidence.sql']");
  expect(verifierSource).toContain('!checks.issuanceActorEvidenceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditIssuanceActors > 0');
  expect(verifierSource).toContain("['488_oxsteed_credit_admin_provenance.sql']");
  expect(verifierSource).toContain('!checks.adminProvenanceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditCreatorEvidence > 0');
  expect(verifierSource).toContain("['489_oxsteed_credit_settlement_overlap.sql']");
  expect(verifierSource).toContain('!checks.settlementOverlapMigrationApplied');
  expect(verifierSource).toContain('checks.invalidSettlementOverlaps > 0');
  expect(verifierSource).toContain("['490_oxsteed_credit_settlement_reference.sql']");
  expect(verifierSource).toContain('!checks.settlementReferenceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidSettlementReferences > 0');
  expect(verifierSource).toContain("['491_oxsteed_credit_account_ledger_write.sql']");
  expect(verifierSource).toContain('!checks.accountLedgerWriteMigrationApplied');
  expect(verifierSource).toContain('checks.invalidAccountLedgerStates > 0');
  expect(verifierSource).toContain("['492_oxsteed_credit_hold_terminal_evidence.sql']");
  expect(verifierSource).toContain('!checks.holdTerminalEvidenceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidHoldTerminalEvidence > 0');
  expect(verifierSource).toContain("['493_oxsteed_credit_dispute_actor_evidence.sql']");
  expect(verifierSource).toContain('!checks.disputeActorEvidenceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditDisputeActors > 0');
  expect(verifierSource).toContain("['494_oxsteed_credit_hold_actor_evidence.sql']");
  expect(verifierSource).toContain('!checks.holdActorEvidenceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditHoldActors > 0');
  expect(verifierSource).toContain("['495_oxsteed_credit_entitlement_agreement_state.sql']");
  expect(verifierSource).toContain('!checks.entitlementAgreementStateMigrationApplied');
  expect(verifierSource).toContain('checks.invalidActiveEntitlementAgreements > 0');
  expect(verifierSource).toContain("['496_oxsteed_credit_agreement_entitlement_state.sql']");
  expect(verifierSource).toContain('!checks.agreementEntitlementStateMigrationApplied');
  expect(verifierSource).toContain("['499_oxsteed_credit_restaurant_staff_evidence.sql']");
  expect(verifierSource).toContain('!checks.restaurantStaffEvidenceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditRestaurantStaffEvidence > 0');
  expect(verifierSource).toContain("['500_oxsteed_credit_purchase_reference_uniqueness.sql']");
  expect(verifierSource).toContain('!checks.purchaseReferenceUniquenessMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditPurchaseReferenceUniqueness > 0');
  expect(verifierSource).toContain("['501_oxsteed_credit_restaurant_staff_refund_reason.sql']");
  expect(verifierSource).toContain('!checks.restaurantStaffRefundReasonMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditRestaurantStaffRefundReasons > 0');
  expect(verifierSource).toContain("['502_oxsteed_credit_purchase_actor_evidence.sql']");
  expect(verifierSource).toContain('!checks.purchaseActorEvidenceMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditPurchaseActorEvidence > 0');
  expect(verifierSource).toContain("['503_oxsteed_credit_system_hold_release_evidence.sql']");
  expect(verifierSource).toContain('!checks.systemHoldReleaseEvidenceMigrationApplied');
  expect(verifierSource).toContain("['504_oxsteed_credit_spend_account_state.sql']");
  expect(verifierSource).toContain('!checks.spendAccountStateMigrationApplied');
  expect(verifierSource).toContain("['505_oxsteed_credit_notification_outbox.sql']");
  expect(verifierSource).toContain('!checks.notificationOutboxMigrationApplied');
  expect(verifierSource).toContain("['506_oxsteed_credit_hold_notification_outbox.sql']");
  expect(verifierSource).toContain('!checks.holdNotificationOutboxMigrationApplied');
  expect(verifierSource).toContain("['507_oxsteed_credit_notification_retention.sql']");
  expect(verifierSource).toContain('!checks.notificationRetentionMigrationApplied');
  expect(verifierSource).toContain("['508_oxsteed_credit_worker_heartbeat.sql']");
  expect(verifierSource).toContain('!checks.workerHeartbeatMigrationApplied');
  expect(verifierSource).toContain("['509_oxsteed_credit_notification_queue_indexes.sql']");
  expect(verifierSource).toContain('!checks.notificationQueueIndexesMigrationApplied');
  expect(verifierSource).toContain("['510_oxsteed_credit_hmac_key_version.sql']");
  expect(verifierSource).toContain('!checks.ledgerHashKeyVersionMigrationApplied');
  expect(verifierSource).toContain('checks.invalidCreditNotificationRecipients > 0');
  expect(verifierSource).toContain('checks.invalidCreditSpendAccountStates > 0');
});

test('credit verification requires deferred reservation consistency guards', () => {
  expect(REQUIRED_INTEGRITY_TRIGGERS).toEqual(expect.arrayContaining([
    'oxsteed_credit_account_reservation_guard',
    'oxsteed_credit_hold_reservation_guard',
    'oxsteed_credit_transaction_status_guard',
    'oxsteed_credit_posted_entry_guard',
    'oxsteed_credit_settlement_payment_evidence_guard',
    'oxsteed_credit_transaction_settlement_evidence_guard',
    'oxsteed_credit_audit_hash_chain_guard',
  ]));
});

test('requires a note for every administrative Credit dispute status change', async () => {
  await expect(service.resolveCreditDispute({
    disputeId: 'dispute-1',
    status: 'in_review',
    actorUserId: ADMIN_ID,
  })).rejects.toMatchObject({ code: 'credit_dispute_resolution_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires an explicit actor for Credit dispute mutations', async () => {
  await expect(service.openCreditDispute({
    customerId: CUSTOMER_ID,
    transactionId: 'transaction-1',
    reasonCode: 'unauthorized',
    description: 'Please review this transaction.',
    idempotencyKey: 'dispute-actor-1',
  })).rejects.toMatchObject({ code: 'credit_dispute_actor_required', status: 403 });

  await expect(service.resolveCreditDispute({
    disputeId: 'dispute-1',
    status: 'in_review',
    resolution: 'Assigned for review.',
  })).rejects.toMatchObject({ code: 'credit_dispute_actor_required', status: 403 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('credit verification requires posted customer history indexes', () => {
  expect(REQUIRED_INDEXES).toEqual(expect.arrayContaining([
    'idx_oxsteed_credit_transactions_debit_posted_history',
    'idx_oxsteed_credit_transactions_credit_posted_history',
    'idx_oxsteed_credit_disputes_customer_history',
    'idx_oxsteed_credit_disputes_status_history',
    'uq_oxsteed_credit_dispute_idempotency',
    'idx_oxsteed_credit_notification_outbox_sent_retention',
    'idx_oxsteed_credit_notification_outbox_pending_due',
    'idx_oxsteed_credit_notification_outbox_sending_lock',
    'idx_oxsteed_credit_notification_outbox_failed_history',
    'idx_oxsteed_credit_worker_heartbeats_last_run',
    'idx_oxsteed_credit_transactions_debit_velocity',
    'idx_oxsteed_credit_holds_customer_currency_active',
    'idx_oxsteed_credit_audit_action_created',
    'idx_oxsteed_credit_audit_resource_created',
    'idx_oxsteed_credit_audit_correlation',
  ]));
});

test('credit verification requires velocity query indexes', () => {
  const verifierSource = require('fs').readFileSync(require.resolve('../scripts/verify-oxsteed-credit'), 'utf8');
  expect(verifierSource).toContain("['511_oxsteed_credit_velocity_indexes.sql']");
  expect(verifierSource).toContain('!checks.velocityIndexesMigrationApplied');
});

test('credit verification requires audit query indexes', () => {
  const verifierSource = require('fs').readFileSync(require.resolve('../scripts/verify-oxsteed-credit'), 'utf8');
  expect(verifierSource).toContain("['512_oxsteed_credit_audit_query_indexes.sql']");
  expect(verifierSource).toContain('!checks.auditQueryIndexesMigrationApplied');
});

test('customer Credit mutation responses omit internal hold and ledger fields', () => {
  const response = controller.formatCustomerCreditMutationResult({
    hold: { id: 'hold-1', amountCents: 500, idempotencyKey: 'secret-hold-key' },
    transaction: {
      id: 'transaction-1',
      transactionType: 'transfer',
      status: 'posted',
      amountCents: 500,
      currencyCode: 'USD',
      referenceType: 'customer_transfer',
      referenceId: 'transfer-1',
      description: 'Gift',
      postedAt: '2026-09-13T10:00:00.000Z',
      createdAt: '2026-09-13T10:00:00.000Z',
      debitAccountId: 'internal-debit',
      creditAccountId: 'internal-credit',
      idempotencyKey: 'secret-transfer-key',
      correlationId: 'internal-request-id',
      metadata: { internal: true },
      entries: [{ accountId: 'internal-account', entryHash: 'internal-hash' }],
    },
    replayed: false,
  });

  expect(response).toMatchObject({
    hold: { id: 'hold-1', amountCents: 500 },
    transaction: {
      id: 'transaction-1',
      transactionType: 'transfer',
      amountCents: 500,
      referenceType: 'customer_transfer',
      replayed: false,
    },
  });
  expect(response.hold.idempotencyKey).toBeUndefined();
  expect(response.transaction).not.toHaveProperty('debitAccountId');
  expect(response.transaction).not.toHaveProperty('creditAccountId');
  expect(response.transaction).not.toHaveProperty('idempotencyKey');
  expect(response.transaction).not.toHaveProperty('correlationId');
  expect(response.transaction).not.toHaveProperty('metadata');
  expect(response.transaction).not.toHaveProperty('entries');
});

test('exposes only currencies with verified two-decimal minor-unit support', () => {
  expect(service.SUPPORTED_CREDIT_CURRENCY_META.USD).toEqual({ code: 'USD', minorUnits: 2 });
  expect(Object.values(service.SUPPORTED_CREDIT_CURRENCY_META).every((currency) => currency.minorUnits === 2)).toBe(true);
  expect(service.SUPPORTED_CREDIT_CURRENCY_META.JPY).toBeUndefined();
});

test('customer allowlist agreements require an active entitlement in eligibility queries', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await expect(service.listEligiblePartners({ customerId: CUSTOMER_ID, currencyCode: 'USD' })).resolves.toEqual([]);

  expect(mockQuery.mock.calls[0][0]).toContain('a.requires_customer_entitlement = FALSE');
  expect(mockQuery.mock.calls[0][0]).toContain('a.requires_customer_entitlement = FALSE AND e.id IS NULL');
  expect(mockQuery.mock.calls[0][0]).toContain('e.id IS NOT NULL');
  expect(mockQuery.mock.calls[0][0]).toContain("customer.role = 'customer' AND customer.is_active = TRUE");
});

test('lets admins preview the exact restaurants a customer can spend at', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    partner_id: 41,
    restaurant_id: 12,
    restaurant_name: 'OxSteed Cafe',
    address_city: 'Springfield',
    address_state: 'OH',
    settlement_currency_code: 'USD',
    restaurant_currency_code: 'USD',
    agreement_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    version: 2,
    customer_terms: 'Pickup only',
    allowed_order_types: ['pickup'],
    allowed_categories: [],
    geography: { cities: ['Springfield'] },
    effective_max_transaction_cents: '2500',
    effective_daily_customer_limit_cents: '10000',
    lifetime_customer_limit_cents: null,
    requires_customer_entitlement: true,
    entitlement_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }] });

  const response = await request(createAdminApp()).get(`/accounts/${CUSTOMER_ID}/eligible-partners?currencyCode=USD&city=Springfield&orderType=pickup&limit=10&offset=20`);

  expect(response.status).toBe(200);
  expect(response.body.partners[0]).toMatchObject({
    partnerId: '41',
    restaurantName: 'OxSteed Cafe',
    hasCustomerEntitlement: true,
    maxTransactionCents: 2500,
  });
  expect(response.body.pagination).toEqual({ limit: 10, offset: 20, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[0][0]).toContain('e.id IS NOT NULL');
  expect(mockQuery.mock.calls[0][1].slice(-2)).toEqual([11, 20]);
});

test('transfer replay requires the original sender and recipient', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'transfer-1',
    transaction_type: 'transfer',
    sender_customer_id: CUSTOMER_ID,
    recipient_customer_id: '33333333-3333-4333-8333-333333333333',
  }] });

  await expect(service.findExistingTransferForReplay({ query: mockQuery }, {
    senderCustomerId: CUSTOMER_ID,
    recipientCustomerId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'transfer-replay-1',
  })).resolves.toMatchObject({ id: 'transfer-1' });
});

test('transfer replay rejects reuse by a different recipient', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'transfer-2',
    transaction_type: 'transfer',
    sender_customer_id: CUSTOMER_ID,
    recipient_customer_id: '33333333-3333-4333-8333-333333333333',
  }] });

  await expect(service.findExistingTransferForReplay({ query: mockQuery }, {
    senderCustomerId: CUSTOMER_ID,
    recipientCustomerId: '44444444-4444-4444-8444-444444444444',
    idempotencyKey: 'transfer-replay-2',
  })).rejects.toMatchObject({ code: 'credit_idempotency_conflict', status: 409 });
});

afterAll(() => {
  delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
});

test('creates a customer OxSteed Credit account with zero balance', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active', ledger_version: '0', updated_at: '2026-09-12T12:00:00.000Z' }] });

  const response = await request(createCustomerApp()).get('/account');

  expect(response.status).toBe(200);
  expect(response.body.name).toBe('OxSteed Credit');
  expect(response.body.account).toMatchObject({
    accountId: '7001',
    balanceCents: 0,
    availableBalanceCents: 0,
    currencyCode: 'USD',
  });
});

test('returns customer-facing daily Credit limits and remaining allowance', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    resets_at: '2026-09-14T00:00:00.000Z',
    spend_count: 3,
    spend_cents: '4250',
    transfer_count: 2,
    transfer_cents: '900',
  }] });

  const response = await request(createCustomerApp()).get('/limits?currencyCode=USD');

  expect(response.status).toBe(200);
  expect(response.body.limits).toMatchObject({
    currencyCode: 'USD',
    resetsAt: '2026-09-14T00:00:00.000Z',
    spending: { countUsed: 3, centsUsed: 4250, countRemaining: 47, centsRemaining: 995750 },
    transfers: { countUsed: 2, centsUsed: 900, countRemaining: 18, centsRemaining: 999100 },
  });
  expect(mockQuery.mock.calls[0][0]).toContain("h.status = 'active'");
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, 'USD']);
});

test('does not create or expose an OxSteed Credit wallet for a non-customer role', async () => {
  const response = await request(createCustomerApp('helper')).get('/account');

  expect(response.status).toBe(404);
  expect(response.body.code).toBe('credit_customer_not_found');
  expect(mockQuery.mock.calls[0][0]).toContain("role = 'customer'");
  expect(mockQuery.mock.calls[1][0]).toContain('JOIN users owner');
});

test('creates and reads a customer account in a supported non-USD currency', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    .mockResolvedValueOnce({ rows: [{ id: 7002, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'EUR', balance_cents: '1250', reserved_cents: '0', status: 'active', ledger_version: '1', updated_at: '2026-09-12T12:00:00.000Z' }] });

  const response = await request(createCustomerApp()).get('/account?currencyCode=EUR');

  expect(response.status).toBe(200);
  expect(response.body.account).toMatchObject({ accountId: '7002', balanceCents: 1250, currencyCode: 'EUR' });
  expect(mockQuery.mock.calls[1][1]).toEqual(['customer_wallet', CUSTOMER_ID, 'EUR']);
});

test('keeps admin credit overview balances separated by currency', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [
      { currency_code: 'EUR', customer_accounts: 1, customer_balance_cents: '2500', customer_reserved_cents: '500', partner_accounts: 1, partner_payable_cents: '2000', inactive_accounts: 0 },
      { currency_code: 'USD', customer_accounts: 2, customer_balance_cents: '10000', customer_reserved_cents: '1000', partner_accounts: 2, partner_payable_cents: '9000', inactive_accounts: 1 },
    ] })
    .mockResolvedValueOnce({ rows: [{ partner_id: 41, restaurant_id: 7, restaurant_name: 'Ox Burger Lab', status: 'active', settlement_currency_code: 'EUR', agreement_count: 1, active_agreement_count: 1, total_partner_count: 125, active_partner_count: 118, pending_partner_count: 4, active_partners_without_agreement_count: 2, expiring_agreement_count: 3 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      pending_count: 2,
      sending_count: 1,
      failed_count: 1,
      oldest_pending_at: '2026-09-13T12:00:00.000Z',
      oldest_failed_at: '2026-09-12T12:00:00.000Z',
      worker_heartbeats: {
        'oxsteed-credit-reconciliation': { jobName: 'oxsteed-credit-reconciliation', stale: false, consecutiveFailures: 0 },
      },
    }] });

  const response = await request(createAdminApp()).get('/overview');

  expect(response.status).toBe(200);
  expect(response.body.summary).toMatchObject({ currencyCode: 'USD', customerBalanceCents: 10000, customerAvailableCents: 9000 });
  expect(response.body.supportedCurrencies).toEqual(expect.arrayContaining(['USD', 'EUR']));
  expect(response.body.riskLimits).toEqual(expect.objectContaining({
    maxTransactionCents: expect.any(Number),
    maxCustomerBalanceCents: expect.any(Number),
    maxTotalIssuanceCents: expect.any(Number),
    maxDailyCustomerIssuanceCents: expect.any(Number),
    maxDailyCustomerTransferCents: expect.any(Number),
    maxDailyCustomerTransferCount: expect.any(Number),
    maxDailyCustomerSpendCents: expect.any(Number),
    maxDailyCustomerSpendCount: expect.any(Number),
  }));
  expect(response.body.summaryByCurrency).toEqual(expect.arrayContaining([
    expect.objectContaining({ currencyCode: 'EUR', customerBalanceCents: 2500, customerAvailableCents: 2000 }),
    expect.objectContaining({ currencyCode: 'USD', customerBalanceCents: 10000, customerAvailableCents: 9000 }),
  ]));
  expect(response.body.partnerCounts).toEqual({ total: 125, active: 118 });
  expect(response.body.coverageAlerts).toEqual({ pendingPartners: 4, activePartnersWithoutAgreement: 2, expiringAgreements: 3 });
  expect(response.body.notificationHealth).toEqual({ pending: 2, sending: 1, failed: 1, oldestPendingAt: '2026-09-13T12:00:00.000Z', backlogStale: false, backlogStaleAfterMinutes: 15, oldestFailedAt: '2026-09-12T12:00:00.000Z', failedNotifications: [], workerHeartbeat: {} });
  expect(response.body.workerHeartbeats).toEqual({
    'oxsteed-credit-reconciliation': { jobName: 'oxsteed-credit-reconciliation', stale: false, consecutiveFailures: 0 },
  });
  expect(response.body.partners[0].settlementCurrencyCode).toBe('EUR');
  expect(mockQuery.mock.calls[0][0]).toContain('GROUP BY currency_code');
});

test('returns paginated admin Credit settlements with status filters', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'settlement-1',
    partner_id: 41,
    agreement_id: 'agreement-1',
    restaurant_id: 7,
    restaurant_name: 'Ox Burger Lab',
    currency_code: 'USD',
    period_start: '2026-09-01T00:00:00.000Z',
    period_end: '2026-09-02T00:00:00.000Z',
    gross_cents: '2500',
    refund_cents: '0',
    fee_cents: '250',
    net_cents: '2250',
    status: 'pending',
    payment_reference: null,
    paid_at: null,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  }] });

  const response = await request(createAdminApp()).get('/settlements?status=pending&limit=1&offset=2');

  expect(response.status).toBe(200);
  expect(response.body.settlements).toEqual([expect.objectContaining({ id: 'settlement-1', netCents: 2250, status: 'pending' })]);
  expect(response.body.pagination).toEqual({ limit: 1, offset: 2, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[0][0]).toContain('s.status = $1');
  expect(mockQuery.mock.calls[0][1]).toEqual(['pending', 2, 2]);
});

test('returns paginated Credit reconciliation history for admins', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'run-1',
    currency_code: 'USD',
    period_start: '2026-09-01T00:00:00.000Z',
    period_end: '2026-09-02T00:00:00.000Z',
    status: 'balanced',
    account_balance_cents: '2500',
    journal_balance_cents: '2500',
    difference_cents: '0',
    account_count: 2,
    entry_count: 4,
    started_at: '2026-09-02T01:00:00.000Z',
    completed_at: '2026-09-02T01:00:01.000Z',
  }] });

  const response = await request(createAdminApp()).get('/reconciliation?currencyCode=USD&status=balanced&limit=10&offset=20');

  expect(response.status).toBe(200);
  expect(response.body.runs[0]).toMatchObject({ id: 'run-1', status: 'balanced', differenceCents: 0 });
  expect(response.body.pagination).toEqual({ limit: 10, offset: 20, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[0][1]).toEqual(['USD', 'balanced', 11, 20]);
});

test('exports filtered, formula-safe Credit reconciliation evidence', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'run-2',
    currency_code: 'USD',
    period_start: '2026-09-03T00:00:00.000Z',
    period_end: '2026-09-04T00:00:00.000Z',
    status: 'failed',
    account_balance_cents: '3000',
    journal_balance_cents: '2999',
    difference_cents: '1',
    account_count: 3,
    entry_count: 6,
    error_message: '=CMD("unsafe")',
    completed_by: ADMIN_ID,
    started_at: '2026-09-04T01:00:00.000Z',
    completed_at: '2026-09-04T01:00:02.000Z',
    metadata: { scope: 'all_time_ledger' },
  }] });

  const response = await request(createAdminApp()).get('/reconciliation.csv?currencyCode=USD&status=failed');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.headers['content-disposition']).toContain('oxsteed-credit-reconciliation-');
  expect(response.text).toContain("'=CMD(\"\"unsafe\"\")");
  expect(response.text).toContain('all_time_ledger');
  expect(mockQuery.mock.calls[0][0]).toContain('currency_code = $1');
  expect(mockQuery.mock.calls[0][0]).toContain('status = $2');
  expect(mockQuery.mock.calls[0][1]).toEqual(['USD', 'failed', 251, 0]);
});

test('returns paginated admin Credit transactions with movement filters', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'transaction-1',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '2500',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'agreement-1',
    reference_type: 'food_order',
    reference_id: '9001',
    debit_customer_id: CUSTOMER_ID,
    credit_customer_id: null,
    posted_at: '2026-09-12T12:00:00.000Z',
    created_at: '2026-09-12T12:00:00.000Z',
  }, {
    id: 'transaction-older',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '1000',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'agreement-1',
    reference_type: 'food_order',
    reference_id: '8999',
  }] });

  const response = await request(createAdminApp()).get('/transactions?partnerId=41&transactionType=purchase&status=posted&currencyCode=USD&limit=1&offset=2');

  expect(response.status).toBe(200);
  expect(response.body.transactions[0]).toMatchObject({ id: 'transaction-1', orderId: '9001', partnerId: '41' });
  expect(response.body.pagination).toEqual({ limit: 1, offset: 2, hasMore: true, nextOffset: 3 });
});

test('filters Credit audit history by request correlation id', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp()).get('/audit-events?correlationId=request-incident-1');

  expect(response.status).toBe(200);
  expect(mockQuery.mock.calls[0][0]).toContain('correlation_id = $1');
  expect(mockQuery.mock.calls[0][1]).toEqual(['request-incident-1', 101, 0]);
});

test('exports a bounded filtered Credit transaction CSV safely', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'transaction-1',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '2500',
    currency_code: 'USD',
    partner_id: 41,
    reference_type: 'food_order',
    reference_id: '9001',
    description: '=2+2',
    actor_type: 'customer',
    actor_user_id: CUSTOMER_ID,
    posted_at: '2026-09-12T12:00:00.000Z',
    created_at: '2026-09-12T12:00:00.000Z',
    restaurant_name: 'OxSteed Cafe',
  }] });

  const response = await request(createAdminApp()).get('/transactions.csv?transactionType=purchase');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/csv/);
  expect(response.headers['content-disposition']).toMatch(/oxsteed-credit-transactions-/);
  expect(response.text).toContain('Transaction ID');
  expect(response.text).toContain('"\'=2+2"');
  expect(mockQuery.mock.calls[0][1]).toEqual(['purchase', 251, 0]);
});

test('exports a filtered settlement CSV without exposing spreadsheet formulas', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'settlement-1',
    partner_id: 41,
    agreement_id: 'agreement-1',
    restaurant_id: 9,
    restaurant_name: '=Restaurant Cafe',
    currency_code: 'USD',
    period_start: '2026-09-01T00:00:00.000Z',
    period_end: '2026-09-08T00:00:00.000Z',
    gross_cents: '5000',
    refund_cents: '500',
    fee_cents: '100',
    net_cents: '4400',
    status: 'paid',
    payment_reference: '+bank-1',
    approved_by: ADMIN_ID,
    paid_at: '2026-09-09T00:00:00.000Z',
    metadata: {},
    created_at: '2026-09-08T00:00:00.000Z',
    updated_at: '2026-09-09T00:00:00.000Z',
  }] });

  const response = await request(createAdminApp()).get('/settlements.csv?partnerId=41&status=paid&currencyCode=USD');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/csv/);
  expect(response.headers['content-disposition']).toMatch(/oxsteed-credit-settlements-/);
  expect(response.text).toContain('Settlement ID');
  expect(response.text).toContain('"\'=Restaurant Cafe"');
  expect(response.text).toContain('"\'+bank-1"');
  expect(mockQuery.mock.calls[0][1]).toEqual([41, 'paid', 'USD', 251, 0]);
});

test('exports filtered Credit partner coverage with formula-safe values', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '1' }] })
    .mockResolvedValueOnce({ rows: [{
      partner_id: 41,
      restaurant_id: 12,
      restaurant_name: '=Cafe',
      business_id: 99,
      status: 'active',
      settlement_currency_code: 'USD',
      requires_customer_entitlement: true,
      agreement_count: 2,
      active_agreement_count: 1,
      notes: '+approved',
      created_at: '2026-09-12T12:03:00.000Z',
      updated_at: '2026-09-12T12:04:00.000Z',
    }] });

  const response = await request(createAdminApp()).get('/partners.csv?search=restaurant&status=active');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/csv/);
  expect(response.headers['content-disposition']).toMatch(/oxsteed-credit-partners-/);
  expect(response.text).toContain('Agreement count');
  expect(response.text).toContain('"\'=Cafe"');
  expect(response.text).toContain('"\'+approved"');
  expect(mockQuery.mock.calls[0][1]).toEqual(['%restaurant%', 'active']);
  expect(mockQuery.mock.calls[1][1]).toEqual(['%restaurant%', 'active', 251, 0]);
});

test('lists a paginated Credit partner directory without changing selector results', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '26' }] })
    .mockResolvedValueOnce({ rows: [{
      partner_id: 41,
      restaurant_id: 12,
      restaurant_name: 'OxSteed Cafe',
      status: 'active',
      settlement_currency_code: 'USD',
      agreement_count: 2,
      active_agreement_count: 1,
      updated_at: '2026-09-12T12:04:00.000Z',
    }] });

  const response = await request(createAdminApp()).get('/partners/directory?search=cafe&status=active&limit=10&offset=20');

  expect(response.status).toBe(200);
  expect(response.body.partners[0]).toMatchObject({ partnerId: '41', restaurantName: 'OxSteed Cafe', status: 'active' });
  expect(response.body.pagination).toEqual({ limit: 10, offset: 20, total: 26, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[0][1]).toEqual(['%cafe%', 'active']);
  expect(mockQuery.mock.calls[1][1]).toEqual(['%cafe%', 'active', 11, 20]);
});

test('exports filtered Credit agreements with formula-safe terms', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '1' }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-1',
      partner_id: 41,
      restaurant_id: 12,
      restaurant_name: '=Cafe',
      settlement_currency_code: 'USD',
      version: 2,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      customer_terms: '+approved terms',
      allowed_order_types: ['pickup'],
      allowed_categories: ['food'],
      allowed_menu_item_ids: [7],
      geography: { cities: ['Springfield'] },
      max_transaction_cents: '5000',
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      requires_customer_entitlement: false,
      approved_by: ADMIN_ID,
      created_by: ADMIN_ID,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-02T00:00:00.000Z',
      metadata: {},
    }] });

  const response = await request(createAdminApp()).get('/agreements.csv?partnerId=41&status=active');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/csv/);
  expect(response.headers['content-disposition']).toMatch(/oxsteed-credit-agreements-/);
  expect(response.text).toContain('Allowed order types');
  expect(response.text).toContain('"\'=Cafe"');
  expect(response.text).toContain('"\'+approved terms"');
  expect(mockQuery.mock.calls[0][1]).toEqual([41, 'active']);
  expect(mockQuery.mock.calls[1][1]).toEqual([41, 'active', 251, 0]);
});

test('exports customer Credit wallets with active filters and formula-safe values', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ total: '1' }] })
    .mockResolvedValueOnce({ rows: [{
      account_id: 7001,
      customer_id: CUSTOMER_ID,
      first_name: '=Customer',
      last_name: 'Test',
      email: '+customer@example.com',
      is_active: true,
      is_banned: false,
      currency_code: 'USD',
      balance_cents: '2500',
      reserved_cents: '500',
      status: 'active',
      ledger_version: '3',
      last_posted_at: '2026-09-12T12:00:00.000Z',
      updated_at: '2026-09-12T12:01:00.000Z',
    }] });

  const response = await request(createAdminApp()).get('/accounts.csv?search=customer&status=active&currencyCode=USD');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/csv/);
  expect(response.headers['content-disposition']).toMatch(/oxsteed-credit-customer-wallets-/);
  expect(response.text).toContain('Customer ID');
  expect(response.text).toContain('"\'=Customer Test"');
  expect(response.text).toContain('"\'+customer@example.com"');
  expect(response.text).toContain('"2000"');
  expect(mockQuery.mock.calls[0][1]).toEqual(['%customer%', 'USD', 'active']);
});

test('exports filtered Credit audit history with formula-safe state snapshots', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'audit-1',
    action_type: 'credit.rail.enabled',
    actor_user_id: ADMIN_ID,
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    resource_type: 'credit_rail',
    resource_id: 'rail',
    reason: '=manual review',
    correlation_id: 'request-audit-export',
    before_state: { enabled: false },
    after_state: { enabled: true },
    metadata: { source: 'test' },
    created_at: '2026-09-12T12:02:00.000Z',
  }] });

  const response = await request(createAdminApp()).get(`/audit-events.csv?actionType=credit.rail.enabled&resourceType=credit_rail&customerId=${CUSTOMER_ID}&partnerId=41`);

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/text\/csv/);
  expect(response.headers['content-disposition']).toMatch(/oxsteed-credit-audit-/);
  expect(response.text).toContain('Before state');
  expect(response.text).toContain('"\'=manual review"');
  expect(response.text).toContain('"{""enabled"":false}"');
  expect(mockQuery.mock.calls[0][1]).toEqual(['credit.rail.enabled', 'credit_rail', CUSTOMER_ID, 41, 251, 0]);
});

test('updates the selected non-USD customer credit wallet status', async () => {
  const account = {
    id: 7002,
    account_type: 'customer_wallet',
    customer_id: CUSTOMER_ID,
    partner_id: null,
    currency_code: 'EUR',
    balance_cents: '0',
    reserved_cents: '0',
    status: 'active',
    ledger_version: '0',
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [account] })
    .mockResolvedValueOnce({ rows: [{ ...account, status: 'suspended', updated_at: '2026-09-12T12:01:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp())
    .post(`/status/${CUSTOMER_ID}`)
    .send({ currencyCode: 'EUR', status: 'suspended', reason: 'Partner settlement review' });

  expect(response.status).toBe(200);
  expect(response.body.account).toMatchObject({ currencyCode: 'EUR', status: 'suspended' });
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, 'EUR']);
  expect(mockQuery.mock.calls[2][1][2]).toBe(String(account.id));
});

test('does not create a wallet while changing customer credit account status', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp())
    .post(`/status/${CUSTOMER_ID}`)
    .send({ currencyCode: 'CAD', status: 'suspended', reason: 'Safety review' });

  expect(response.status).toBe(404);
  expect(response.body.code).toBe('credit_account_not_found');
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toContain("account_type = 'customer_wallet'");
});

test('does not reopen a closed customer credit wallet', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 7003,
    account_type: 'customer_wallet',
    customer_id: CUSTOMER_ID,
    partner_id: null,
    currency_code: 'USD',
    balance_cents: '0',
    reserved_cents: '0',
    status: 'closed',
    ledger_version: '2',
  }] });

  const response = await request(createAdminApp())
    .post(`/status/${CUSTOMER_ID}`)
    .send({ currencyCode: 'USD', status: 'active', reason: 'Reactivation test' });

  expect(response.status).toBe(409);
  expect(response.body.code).toBe('credit_account_closed');
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('shows only spendable partner restaurants in the customer currency', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    {
      partner_id: 41,
      restaurant_id: 7,
      settlement_currency_code: 'USD',
      restaurant_currency_code: 'USD',
      restaurant_name: 'Ox Burger Lab',
      agreement_id: 'agreement-usd',
      version: 2,
      customer_terms: 'Use for lunch.',
      geography: null,
      allowed_order_types: ['pickup'],
      allowed_categories: [],
      max_transaction_cents: '5000',
      daily_customer_limit_cents: null,
      effective_max_transaction_cents: '4500',
      effective_daily_customer_limit_cents: '4500',
      lifetime_customer_limit_cents: '10000',
      entitlement_id: null,
    },
    {
      partner_id: 42,
      restaurant_id: 8,
      settlement_currency_code: 'EUR',
      restaurant_currency_code: 'EUR',
      restaurant_name: 'Ox Cafe Europe',
      agreement_id: 'agreement-eur',
      version: 1,
      customer_terms: 'Use for dinner.',
      geography: null,
      allowed_order_types: ['dine_in'],
      allowed_categories: [],
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      effective_max_transaction_cents: null,
      effective_daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
    },
  ] });

  const response = await request(createCustomerApp()).get('/eligible-partners?currencyCode=USD');

  expect(response.status).toBe(200);
  expect(response.body.partners).toHaveLength(1);
  expect(response.body.partners[0]).toMatchObject({ partnerId: '41', currencyCode: 'USD', maxTransactionCents: 4500, dailyCustomerLimitCents: 4500, lifetimeCustomerLimitCents: 10000, geography: {} });
  expect(mockQuery.mock.calls[0][0]).toContain('fr.currency_code');
  expect(mockQuery.mock.calls[0][0]).toContain('p.settlement_currency_code = $2');
  expect(mockQuery.mock.calls[0][0]).toContain("ca.status = 'active'");
  expect(mockQuery.mock.calls[0][0]).toContain('LEAST(a.max_transaction_cents, e.max_transaction_cents)');
});

test('shows geographic partner coverage before a customer enters a location and filters it when they do', async () => {
  const row = {
    partner_id: 41,
    restaurant_id: 7,
    settlement_currency_code: 'USD',
    restaurant_currency_code: 'USD',
    restaurant_name: 'Springfield Kitchen',
    agreement_id: 'agreement-geography',
    version: 1,
    customer_terms: null,
    geography: { cities: ['Springfield'], states: ['OH'], countries: ['US'], ignored: ['not public'] },
    allowed_order_types: [],
    allowed_categories: [],
    effective_max_transaction_cents: null,
    effective_daily_customer_limit_cents: null,
    lifetime_customer_limit_cents: null,
    entitlement_id: null,
    requires_customer_entitlement: true,
  };

  mockQuery.mockResolvedValueOnce({ rows: [row] });
  const directory = await service.listEligiblePartners({ customerId: CUSTOMER_ID, currencyCode: 'USD' });
  expect(directory).toHaveLength(1);
  expect(directory[0]).toMatchObject({
    requiresCustomerEntitlement: true,
    geography: { cities: ['Springfield'], states: ['OH'], countries: ['US'] },
  });

  mockQuery.mockResolvedValueOnce({ rows: [row] });
  await expect(service.listEligiblePartners({ customerId: CUSTOMER_ID, currencyCode: 'USD', city: 'Dayton', state: 'OH', country: 'US' })).resolves.toEqual([]);
});

test('supports bounded server-side partner directory search and pagination', async () => {
  const rows = [1, 2].map((partnerId) => ({
    partner_id: partnerId,
    restaurant_id: partnerId + 10,
    settlement_currency_code: 'USD',
    restaurant_currency_code: 'USD',
    restaurant_name: `Cafe ${partnerId}`,
    agreement_id: `agreement-${partnerId}`,
    version: 1,
    customer_terms: null,
    geography: {},
    allowed_order_types: ['pickup'],
    allowed_categories: [],
    effective_max_transaction_cents: null,
    effective_daily_customer_limit_cents: null,
    lifetime_customer_limit_cents: null,
    entitlement_id: null,
    requires_customer_entitlement: false,
  }));
  mockQuery.mockResolvedValueOnce({ rows });

  const response = await request(createCustomerApp()).get('/eligible-partners?currencyCode=USD&search=Cafe&limit=1&offset=1');

  expect(response.status).toBe(200);
  expect(response.body.partners).toHaveLength(1);
  expect(response.body.pagination).toEqual({ limit: 1, offset: 1, hasMore: true, nextOffset: 2 });
  expect(mockQuery.mock.calls[0][0]).toContain('fr.display_name ILIKE');
  expect(mockQuery.mock.calls[0][0]).toContain('LIMIT $9 OFFSET $10');
  expect(mockQuery.mock.calls[0][1].slice(-2)).toEqual([2, 1]);
});

test('lists a customer credit hold page without exposing other account holds', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    {
      id: 'hold-1', customer_id: CUSTOMER_ID, partner_id: 41, agreement_id: 'agreement-1',
      amount_cents: 1200, currency_code: 'USD', status: 'active', purpose: 'Dinner order',
      reference_type: 'food_order', reference_id: 'order-1', idempotency_key: 'hold-key-1',
      expires_at: '2026-09-13T10:00:00.000Z', created_at: '2026-09-13T09:30:00.000Z',
      restaurant_name: 'Ox Burger Lab',
    },
    {
      id: 'hold-2', customer_id: CUSTOMER_ID, partner_id: 42, agreement_id: 'agreement-2',
      amount_cents: 900, currency_code: 'USD', status: 'active', purpose: 'Coffee order',
      reference_type: 'food_order', reference_id: 'order-2', idempotency_key: 'hold-key-2',
      expires_at: '2026-09-13T10:30:00.000Z', created_at: '2026-09-13T09:20:00.000Z',
      restaurant_name: 'Ox Cafe',
    },
  ] });

  const response = await request(createCustomerApp()).get('/holds?currencyCode=USD&limit=1&offset=0');

  expect(response.status).toBe(200);
  expect(response.body.holds).toHaveLength(1);
  expect(response.body.holds[0]).toMatchObject({ restaurantName: 'Ox Burger Lab', amountCents: 1200, status: 'active' });
  expect(response.body.holds[0].idempotencyKey).toBeUndefined();
  expect(response.body.holds[0].actorEvidenceLegacy).toBeUndefined();
  expect(response.body.pagination).toEqual({ limit: 1, offset: 0, hasMore: true, nextOffset: 1 });
  expect(mockQuery.mock.calls[0][0]).toContain("a.account_type = 'customer_wallet'");
});

test('exposes only safe Credit rail status to customers', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ key: 'oxsteed_credit_enabled', is_enabled: false, updated_by: ADMIN_ID, updated_at: '2026-09-13T09:00:00.000Z' }] });

  const response = await request(createCustomerApp()).get('/status');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ credit: { enabled: false, status: 'suspended' } });
});

test('rejects unsupported credit currencies before creating a wallet', async () => {
  const response = await request(createCustomerApp()).get('/account?currencyCode=JPY');

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_currency_not_supported');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects credit hold creation without an idempotency key', async () => {
  const response = await request(createCustomerApp())
    .post('/holds')
    .send({ partnerId: 41, amountCents: 1500 });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_idempotency_key_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects a credit hold expiry that is too far in the future before database work', async () => {
  const response = await request(createCustomerApp())
    .post('/holds')
    .set('Idempotency-Key', 'hold-too-long-1')
    .send({ partnerId: 41, amountCents: 1500, expiresAt: '2099-09-12T00:00:00.000Z' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_hold_expiry_too_long');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects malformed recipient ids before any credit transfer query', async () => {
  const response = await request(createCustomerApp())
    .post('/transfers')
    .set('Idempotency-Key', 'transfer-test-1')
    .send({ recipientCustomerId: 'not-a-uuid', amountCents: 100 });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('invalid_recipientCustomerId');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('keeps credit transfers restricted to customer accounts', async () => {
  const response = await request(createCustomerApp('helper'))
    .post('/transfers')
    .set('Idempotency-Key', 'transfer-helper-1')
    .send({ recipientCustomerId: '22222222-2222-4222-8222-222222222222', amountCents: 100 });

  expect(response.status).toBe(403);
  expect(response.body.code).toBe('credit_transfer_customer_only');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects an empty bulk Credit entitlement request before database work', async () => {
  const response = await request(createAdminApp())
    .post('/entitlements/bulk')
    .send({ customerId: CUSTOMER_ID, agreementIds: [], reason: 'Partner access' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_entitlement_agreements_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires an idempotency key for a non-empty bulk Credit entitlement request', async () => {
  const response = await request(createAdminApp())
    .post('/entitlements/bulk')
    .send({ customerId: CUSTOMER_ID, agreementIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], reason: 'Partner access' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_idempotency_key_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('returns a bounded customer statement with period totals and safe transaction fields', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    account_id: 7001,
    currency_code: 'USD',
    opening_balance_cents: '1000',
    closing_balance_cents: '800',
    transaction_count: 2,
    total_credits_cents: '500',
    total_debits_cents: '700',
    transactions: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '700',
      currency_code: 'USD',
      direction: 'debit',
      related_partner_id: 41,
      restaurant_name: 'Ox Burger Lab',
      description: 'Lunch',
      reference_type: 'food_order',
      reference_id: '123',
      posted_at: '2026-09-10T15:00:00.000Z',
    }],
  }] });

  const response = await request(createCustomerApp())
    .get('/statement?from=2026-09-01&to=2026-09-12&limit=50');

  expect(response.status).toBe(200);
  expect(response.body.statement).toMatchObject({
    accountId: '7001',
    currencyCode: 'USD',
    period: { from: '2026-09-01', to: '2026-09-12' },
    openingBalanceCents: 1000,
    closingBalanceCents: 800,
    totalCreditsCents: 500,
    totalDebitsCents: 700,
    netChangeCents: -200,
    transactionCount: 2,
  });
  expect(response.body.statement.transactions[0]).toEqual(expect.objectContaining({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    restaurantName: 'Ox Burger Lab',
    direction: 'debit',
    orderId: '123',
  }));
  expect(response.body.statement.transactions[0].idempotencyKey).toBeUndefined();
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, '2026-09-01', '2026-09-12', 50, 0, 'USD']);
  expect(mockQuery.mock.calls[0][0]).toContain('t.currency_code = $6');
});

test('allows super admins to export a customer statement with inactive-owner history', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    account_id: 7001,
    currency_code: 'USD',
    opening_balance_cents: '1000',
    closing_balance_cents: '800',
    transaction_count: 1,
    total_credits_cents: '0',
    total_debits_cents: '200',
    transactions: [{
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '200',
      currency_code: 'USD',
      direction: 'debit',
      restaurant_name: 'Ox Burger Lab',
      description: 'Archived customer history',
      posted_at: '2026-09-10T15:00:00.000Z',
    }],
  }] });

  const response = await request(createAdminApp())
    .get(`/accounts/${CUSTOMER_ID}/statement.csv?from=2026-09-01&to=2026-09-12`);

  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-disposition']).toContain(`oxsteed-credit-customer-${CUSTOMER_ID}-statement-2026-09-01-2026-09-12.csv`);
  expect(response.text).toContain('Archived customer history');
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, '2026-09-01', '2026-09-12', 5000, 0, 'USD']);
  expect(mockQuery.mock.calls[0][0]).not.toContain('owner.is_active = TRUE');
});

test('keeps legacy customer transaction reads free of ledger secrets', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '700',
    currency_code: 'USD',
    reference_type: 'food_order',
    reference_id: '123',
    description: 'Lunch',
    posted_at: '2026-09-10T15:00:00.000Z',
    created_at: '2026-09-10T15:00:00.000Z',
    direction: 'debit',
    related_partner_id: 41,
    restaurant_name: 'Ox Burger Lab',
    idempotency_key: 'must-not-leak',
    debit_account_id: 7001,
    credit_account_id: 8001,
    actor_user_id: ADMIN_ID,
    metadata: { internal: 'must-not-leak' },
  }] });

  const response = await request(createCustomerApp())
    .get('/transactions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  expect(response.status).toBe(200);
  expect(response.body.transaction).toMatchObject({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    restaurantName: 'Ox Burger Lab',
    direction: 'debit',
    partnerId: '41',
  });
  expect(response.body.transaction).not.toHaveProperty('idempotencyKey');
  expect(response.body.transaction).not.toHaveProperty('debitAccountId');
  expect(response.body.transaction).not.toHaveProperty('creditAccountId');
  expect(response.body.transaction).not.toHaveProperty('actorUserId');
  expect(response.body.transaction).not.toHaveProperty('metadata');
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).not.toContain('SELECT t.*');
  expect(mockQuery.mock.calls[0][0]).toContain("t.status = 'posted'");
  expect(mockQuery.mock.calls[0][0]).toContain('t.currency_code = $3');
});

test('returns bounded customer transaction pages with a continuation cursor', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      transaction_type: 'purchase',
      status: 'posted',
      amount_cents: '700',
      currency_code: 'USD',
      reference_type: 'food_order',
      reference_id: '123',
      description: 'Lunch',
      posted_at: '2026-09-10T15:00:00.000Z',
      created_at: '2026-09-10T15:00:00.000Z',
      direction: 'debit',
      related_partner_id: 41,
      restaurant_name: 'Ox Burger Lab',
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      transaction_type: 'load',
      status: 'posted',
      amount_cents: '1200',
      currency_code: 'USD',
      reference_type: 'admin_load',
      reference_id: 'load-1',
      description: 'Credit load',
      posted_at: '2026-09-09T15:00:00.000Z',
      created_at: '2026-09-09T15:00:00.000Z',
      direction: 'credit',
      related_partner_id: null,
      restaurant_name: null,
    },
  ] });

  const response = await request(createCustomerApp())
    .get('/transactions?limit=1&offset=1');

  expect(response.status).toBe(200);
  expect(response.body.transactions).toHaveLength(1);
  expect(response.body.transactions[0]).toMatchObject({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', orderId: '123' });
  expect(response.body.pagination).toEqual({ limit: 1, offset: 1, hasMore: true, nextOffset: 2 });
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, 2, 1, 'USD']);
  expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY COALESCE(t.posted_at, t.created_at) DESC, t.id DESC');
});

test('rejects an invalid or oversized customer statement period before querying', async () => {
  const response = await request(createCustomerApp())
    .get('/statement?from=2025-01-01&to=2026-09-12');

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_statement_period_invalid');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('creates a quoted CSV statement without exposing ledger secrets', () => {
  const csv = service.customerCreditStatementCsv({
    transactions: [{
      postedAt: '2026-09-10T15:00:00.000Z',
      id: 'tx-1',
      transactionType: 'purchase',
      description: '=HYPERLINK("https://example.com","special")',
      restaurantName: 'Ox Burger Lab',
      direction: 'debit',
      amountCents: 700,
      currencyCode: 'USD',
    referenceType: 'food_order',
      referenceId: '123',
      orderId: '123',
    }],
  });

  expect(csv).toContain('"Description","Restaurant"');
  expect(csv).toContain('"Order ID"');
  expect(csv).toContain('"123"');
  expect(csv).toContain('"\'=HYPERLINK(""https://example.com"",""special"")"');
  expect(csv).not.toContain('idempotency');
});

test('requires a funding reference for Super Admin credit loads', async () => {
  const response = await request(createAdminApp())
    .post(`/load/${CUSTOMER_ID}`)
    .set('Idempotency-Key', 'admin-load-test-1')
    .send({ amountCents: 10000, reason: 'test grant' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_funding_reference_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires an audit reason for Super Admin credit loads', async () => {
  const response = await request(createAdminApp())
    .post(`/load/${CUSTOMER_ID}`)
    .set('Idempotency-Key', 'admin-load-reason-test-1')
    .send({ amountCents: 10000, referenceId: 'funding-1' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_load_reason_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires a funding reference for positive administrative adjustments', async () => {
  const response = await request(createAdminApp())
    .post(`/adjust/${CUSTOMER_ID}`)
    .set('Idempotency-Key', 'admin-adjustment-test-1')
    .send({ amountCents: 10000, direction: 'credit', reason: 'test grant' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_funding_reference_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('serializes the global outstanding issuance cap before a new load', async () => {
  const customerAccount = {
    id: 7001,
    account_type: 'customer_wallet',
    customer_id: CUSTOMER_ID,
    partner_id: null,
    currency_code: 'USD',
    balance_cents: '0',
    reserved_cents: '0',
    status: 'active',
    ledger_version: '0',
    last_entry_hash: null,
  };
  const treasuryAccount = {
    id: 9001,
    account_type: 'platform_treasury',
    customer_id: null,
    partner_id: null,
    currency_code: 'USD',
    balance_cents: '0',
    reserved_cents: '0',
    status: 'active',
    ledger_version: '0',
    last_entry_hash: null,
  };
  const transaction = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'load',
    status: 'posted',
    debit_account_id: 9001,
    credit_account_id: 7001,
    amount_cents: '100',
    currency_code: 'USD',
    partner_id: null,
    agreement_id: null,
    idempotency_key: 'issuance-test-1',
    reference_type: 'admin_load',
    reference_id: null,
    posted_at: '2026-09-12T12:00:00.000Z',
    created_at: '2026-09-12T12:00:00.000Z',
  };
  const entry = {
    id: 1,
    transaction_id: transaction.id,
    account_id: 9001,
    entry_side: 'debit',
    amount_cents: '100',
    balance_after_cents: '-100',
    sequence: '1',
    previous_entry_hash: null,
    entry_hash: 'hash-1',
    metadata: {},
    created_at: transaction.created_at,
  };
  const updatedTreasury = { ...treasuryAccount, balance_cents: '-100', ledger_version: '1', last_entry_hash: 'hash-1' };
  const updatedCustomer = { ...customerAccount, balance_cents: '100', ledger_version: '1', last_entry_hash: 'hash-2' };
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [treasuryAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount, treasuryAccount] })
    .mockResolvedValueOnce({ rows: [transaction] })
    .mockResolvedValueOnce({ rows: [updatedTreasury] })
    .mockResolvedValueOnce({ rows: [entry] })
    .mockResolvedValueOnce({ rows: [updatedCustomer] })
    .mockResolvedValueOnce({ rows: [{ ...entry, id: 2, account_id: 7001, entry_side: 'credit', balance_after_cents: '100', entry_hash: 'hash-2' }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.loadCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    idempotencyKey: 'issuance-test-1',
    reason: 'Approved customer grant',
    actorUserId: ADMIN_ID,
  });

  expect(result.transaction.amountCents).toBe(100);
  expect(mockQuery.mock.calls[7][0]).toContain('pg_advisory_xact_lock');
  expect(mockQuery.mock.calls[7][1]).toEqual(['oxsteed-credit:issuance-limit:USD']);
  expect(mockQuery.mock.calls[8][0]).toContain('SUM(balance_cents)');
  expect(mockQuery.mock.calls[9][0]).toContain('CURRENT_DATE');
  expect(mockQuery.mock.calls[9][1]).toEqual(['USD', CUSTOMER_ID]);
});

test('replays a committed credit load while the rail is suspended', async () => {
  const existing = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'load',
    status: 'posted',
    debit_account_id: 9001,
    credit_account_id: 7001,
    amount_cents: '100',
    currency_code: 'USD',
    partner_id: null,
    agreement_id: null,
    idempotency_key: 'load-replay-rail-off',
    reference_type: 'admin_load',
    reference_id: 'funding-1',
    description: 'Replay approved customer grant',
    reason: 'Replay approved customer grant',
    metadata: {},
    customer_account_customer_id: CUSTOMER_ID,
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [existing] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.loadCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    idempotencyKey: existing.idempotency_key,
    reason: 'Replay approved customer grant',
    referenceId: existing.reference_id,
  });

  expect(result.replayed).toBe(true);
  expect(result.transaction).toMatchObject({ id: existing.id, amountCents: 100, replayed: true });
  expect(mockQuery.mock.calls[0][0]).toContain('customer_account.customer_id');
  expect(mockQuery.mock.calls[1][0]).toContain('oxsteed_credit_transaction_entries');
});

test('requires an administrator identity for a new credit load', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await expect(service.loadCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    idempotencyKey: 'load-without-actor-1',
    reason: 'Approved customer grant',
  })).rejects.toMatchObject({ code: 'credit_load_actor_required', status: 400 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('rejects an administrative credit load replay with a different reason', async () => {
  const existing = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'load',
    status: 'posted',
    debit_account_id: 9001,
    credit_account_id: 7001,
    amount_cents: '100',
    currency_code: 'USD',
    partner_id: null,
    agreement_id: null,
    idempotency_key: 'load-replay-reason-conflict',
    reference_type: 'admin_load',
    reference_id: 'funding-1',
    description: 'Original approved grant',
    reason: 'Original approved grant',
    metadata: {},
    customer_account_customer_id: CUSTOMER_ID,
  };
  mockQuery.mockResolvedValueOnce({ rows: [existing] });

  await expect(service.loadCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    idempotencyKey: existing.idempotency_key,
    reason: 'Different explanation',
    referenceId: existing.reference_id,
  })).rejects.toMatchObject({ code: 'credit_idempotency_conflict', status: 409 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('allows approved adjustments into suspended wallets but never closed wallets', async () => {
  const treasury = { id: 9001, account_type: 'platform_treasury', customer_id: null, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active', ledger_version: '0', last_entry_hash: null };
  const customer = { id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'suspended', ledger_version: '0', last_entry_hash: null };
  const transaction = { id: 'suspended-adjustment-transaction', transaction_type: 'adjustment', status: 'posted', debit_account_id: treasury.id, credit_account_id: customer.id, amount_cents: '100', currency_code: 'USD', partner_id: null, agreement_id: null, idempotency_key: 'suspended-adjustment-1', reference_type: 'admin_adjustment', reference_id: 'funding-1', description: 'Credit grant', actor_type: 'admin', actor_user_id: ADMIN_ID, metadata: {}, posted_at: '2026-09-13T00:00:00.000Z', created_at: '2026-09-13T00:00:00.000Z' };
  const client = { query: (...args) => mockQuery(...args) };
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customer, treasury] })
    .mockResolvedValueOnce({ rows: [transaction] })
    .mockResolvedValueOnce({ rows: [{ ...treasury, balance_cents: '-100', ledger_version: '1', last_entry_hash: 'hash-treasury' }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, transaction_id: transaction.id, account_id: treasury.id, entry_side: 'debit', amount_cents: '100', balance_after_cents: '-100', sequence: '1', previous_entry_hash: null, entry_hash: 'hash-treasury', metadata: {}, created_at: transaction.created_at }] })
    .mockResolvedValueOnce({ rows: [{ ...customer, balance_cents: '100', ledger_version: '1', last_entry_hash: 'hash-customer' }] })
    .mockResolvedValueOnce({ rows: [{ id: 2, transaction_id: transaction.id, account_id: customer.id, entry_side: 'credit', amount_cents: '100', balance_after_cents: '100', sequence: '1', previous_entry_hash: null, entry_hash: 'hash-customer', metadata: {}, created_at: transaction.created_at }] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.postJournalTransaction(client, {
    transactionType: 'adjustment',
    debitAccountId: treasury.id,
    creditAccountId: customer.id,
    amountCents: 100,
    currencyCode: 'USD',
    idempotencyKey: 'suspended-adjustment-1',
    actorType: 'admin',
    actorUserId: ADMIN_ID,
    customerId: CUSTOMER_ID,
    reason: 'Approved customer grant',
    metadata: { direction: 'credit' },
    referenceType: 'admin_adjustment',
    referenceId: 'funding-1',
    allowSuspendedAccounts: true,
  });

  expect(result.transaction.amountCents).toBe(100);
  expect(mockQuery.mock.calls[1][0]).toContain('FOR UPDATE');

  mockQuery.mockReset();
  mockQuery.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...customer, status: 'closed' }, treasury] });
  await expect(service.postJournalTransaction(client, {
    transactionType: 'adjustment',
    debitAccountId: treasury.id,
    creditAccountId: customer.id,
    amountCents: 100,
    currencyCode: 'USD',
    idempotencyKey: 'closed-adjustment-1',
    reason: 'Closed wallet test',
    metadata: { direction: 'credit' },
    allowSuspendedAccounts: true,
  })).rejects.toMatchObject({ code: 'credit_account_inactive', status: 409 });
});

test('applies the global issuance cap to positive administrative adjustments', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '100', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 9001, account_type: 'platform_treasury', customer_id: null, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '5000000' }] });

  await expect(service.adjustCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    direction: 'credit',
    idempotencyKey: 'adjustment-cap-1',
    reason: 'Cap test',
    referenceId: 'funding-adjustment-cap-1',
    actorUserId: ADMIN_ID,
  })).rejects.toMatchObject({ code: 'credit_total_issuance_limit' });
  expect(mockQuery.mock.calls[5][1]).toEqual(['oxsteed-credit:issuance-limit:USD']);
});

test('applies the per-customer daily issuance cap to positive administrative adjustments', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '100', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 9001, account_type: 'platform_treasury', customer_id: null, partner_id: null, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [{ total_cents: '1000000' }] });

  await expect(service.adjustCustomerCredit({
    customerId: CUSTOMER_ID,
    amountCents: 100,
    direction: 'credit',
    idempotencyKey: 'daily-cap-1',
    reason: 'Daily cap test',
    referenceId: 'funding-daily-cap-1',
    actorUserId: ADMIN_ID,
  })).rejects.toMatchObject({ code: 'credit_daily_issuance_limit' });
  expect(mockQuery.mock.calls[5][1]).toEqual(['oxsteed-credit:issuance-limit:USD']);
  expect(mockQuery.mock.calls[7][1]).toEqual(['USD', CUSTOMER_ID]);
});

test('serializes customer Credit transfer velocity and rejects the daily cap', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ transfer_count: 20, total_cents: '250000' }] });

  await expect(service.assertCustomerTransferCapacity({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    amountCents: 100,
    currencyCode: 'USD',
  })).rejects.toMatchObject({ code: 'credit_daily_transfer_limit' });

  expect(mockQuery.mock.calls[0][1]).toEqual(['USD', CUSTOMER_ID, `oxsteed-credit-transfer-limit:${CUSTOMER_ID}:USD`]);
});

test('serializes customer Credit spending across partners and rejects the daily cap', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ movement_count: 50, movement_cents: '1000000' }] });

  await expect(service.assertCustomerSpendCapacity({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    amountCents: 100,
    currencyCode: 'USD',
    excludeHoldId: null,
  })).rejects.toMatchObject({ code: 'credit_daily_spend_limit' });

  expect(mockQuery.mock.calls[0][1]).toEqual(['USD', CUSTOMER_ID, null, `oxsteed-credit-spend-limit:${CUSTOMER_ID}:USD`]);
});

test('rejects malformed hold capture ids before any database query', async () => {
  const response = await request(createAdminApp())
    .post('/capture/not-a-uuid')
    .set('Idempotency-Key', 'capture-test-1')
    .send({});

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('invalid_holdId');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires a reason before an administrative hold capture queries the database', async () => {
  await expect(service.captureCreditHold({
    holdId: 'hold-without-reason',
    idempotencyKey: 'capture-without-reason-1',
    actorType: 'admin',
  })).rejects.toMatchObject({ code: 'credit_capture_reason_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires an administrator identity before an administrative hold capture queries the database', async () => {
  await expect(service.captureCreditHold({
    holdId: 'hold-without-actor',
    idempotencyKey: 'capture-without-actor-1',
    actorType: 'admin',
    reason: 'Capture review',
  })).rejects.toMatchObject({ code: 'credit_capture_actor_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires the customer owner before creating a Credit hold', async () => {
  await expect(service.createCreditHold({
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    idempotencyKey: 'hold-without-actor-1',
  })).rejects.toMatchObject({ code: 'credit_hold_actor_required', status: 403 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires the customer owner before releasing a Credit hold', async () => {
  await expect(service.releaseCreditHold({
    customerId: CUSTOMER_ID,
    holdId: 'hold-without-release-actor',
  })).rejects.toMatchObject({ code: 'credit_hold_release_actor_required', status: 403 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects a Credit purchase when its customer actor does not own the balance', async () => {
  await expect(service.purchaseWithCreditInTransaction({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    idempotencyKey: 'purchase-wrong-actor-1',
    actorType: 'customer',
    actorUserId: ADMIN_ID,
  })).rejects.toMatchObject({ code: 'credit_purchase_actor_required', status: 403 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires a reason before an administrative Credit refund queries the database', async () => {
  await expect(service.refundCreditInTransaction({ query: mockQuery }, {
    purchaseTransactionId: 'purchase-without-refund-reason',
    amountCents: 100,
    idempotencyKey: 'refund-without-reason-1',
    actorUserId: ADMIN_ID,
    actorType: 'admin',
  })).rejects.toMatchObject({ code: 'credit_refund_reason_required', status: 400 });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('rejects a captured hold replay when its committed purchase details differ', async () => {
  const hold = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    amount_cents: '100',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'agreement-captured-replay',
    status: 'captured',
    capture_idempotency_key: 'capture-replay-1',
    captured_transaction_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    purpose: 'Dinner',
    reference_type: 'food_order',
    reference_id: 'order-captured-1',
    metadata: { source: 'hold' },
  };
  const transaction = {
    id: hold.captured_transaction_id,
    transaction_type: 'purchase',
    status: 'posted',
    debit_account_id: 7001,
    credit_account_id: 8001,
    amount_cents: '100',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: hold.agreement_id,
    reference_type: 'food_order',
    reference_id: hold.reference_id,
    description: 'Dinner',
    metadata: { source: 'hold', capturedHoldId: hold.id },
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [hold] })
    .mockResolvedValueOnce({ rows: [transaction] });

  await expect(service.captureCreditHold({
    holdId: hold.id,
    idempotencyKey: hold.capture_idempotency_key,
    actorType: 'admin',
    actorUserId: ADMIN_ID,
    reason: 'Replay capture',
    description: 'Different description',
  })).rejects.toMatchObject({ code: 'credit_idempotency_conflict', status: 409 });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});

test('opens disputes only for posted transactions with an atomic duplicate guard', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'tx-1', partner_id: 41 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'dispute-1',
      transaction_id: 'tx-1',
      customer_id: CUSTOMER_ID,
      partner_id: 41,
      status: 'open',
      reason_code: 'unauthorized',
      description: 'I do not recognize this purchase',
      opened_by: CUSTOMER_ID,
      resolved_by: null,
      opened_at: '2026-09-12T12:00:00.000Z',
      resolved_at: null,
      updated_at: '2026-09-12T12:00:00.000Z',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(createCustomerApp())
    .post('/disputes')
    .set('Idempotency-Key', 'dispute-test-1')
    .send({ transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reasonCode: 'unauthorized', description: 'I do not recognize this purchase' });

  expect(response.status).toBe(201);
  expect(response.body.dispute).toMatchObject({ id: 'dispute-1', status: 'open' });
  expect(mockQuery.mock.calls[0][0]).toContain("t.status = 'posted'");
  expect(mockQuery.mock.calls[0][0]).toContain('a.id = t.credit_account_id');
  expect(mockQuery.mock.calls[1][0]).toContain('d.idempotency_key = $1');
  expect(mockQuery.mock.calls[3][0]).toContain("ON CONFLICT (transaction_id) WHERE status IN ('open', 'in_review') DO NOTHING");
});

test('requires an idempotency key before opening a credit dispute', async () => {
  const response = await request(createCustomerApp())
    .post('/disputes')
    .send({ transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reasonCode: 'unauthorized', description: 'I do not recognize this purchase' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('credit_idempotency_key_required');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('replays a credit dispute when the request key and details match', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 'tx-1', partner_id: 41 }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'dispute-1',
      transaction_id: 'tx-1',
      customer_id: CUSTOMER_ID,
      partner_id: 41,
      status: 'open',
      reason_code: 'unauthorized',
      description: 'I do not recognize this purchase',
      opened_by: CUSTOMER_ID,
      opened_at: '2026-09-12T12:00:00.000Z',
      updated_at: '2026-09-12T12:00:00.000Z',
    }] });

  const response = await request(createCustomerApp())
    .post('/disputes')
    .set('Idempotency-Key', 'dispute-replay-1')
    .send({ transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', reasonCode: 'unauthorized', description: 'I do not recognize this purchase' });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ replayed: true, dispute: { id: 'dispute-1', status: 'open' } });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});

test('includes safe transaction context when listing credit disputes', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'dispute-1',
    transaction_id: 'tx-1',
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    restaurant_name: 'OxSteed Cafe',
    transaction_amount_cents: '2500',
    transaction_currency_code: 'USD',
    transaction_type: 'purchase',
    transaction_reference_type: 'food_order',
    transaction_reference_id: '123',
    transaction_posted_at: '2026-09-12T12:00:00.000Z',
    status: 'in_review',
    reason_code: 'incorrect_amount',
    description: 'The posted amount does not match the order.',
    resolution: null,
    opened_by: CUSTOMER_ID,
    resolved_by: null,
    opened_at: '2026-09-12T12:30:00.000Z',
    resolved_at: null,
    updated_at: '2026-09-12T12:30:00.000Z',
  }] });

  await expect(service.listCreditDisputes({ customerId: CUSTOMER_ID, limit: 10 })).resolves.toEqual([expect.objectContaining({
    id: 'dispute-1',
    amountCents: 2500,
    currencyCode: 'USD',
    transactionType: 'purchase',
    referenceType: 'food_order',
    referenceId: '123',
    postedAt: '2026-09-12T12:00:00.000Z',
  })]);
  expect(mockQuery.mock.calls[0][0]).toContain('LEFT JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id');
});

test('paginates the customer credit dispute history', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'dispute-4',
    transaction_id: 'tx-4',
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    restaurant_name: 'OxSteed Cafe',
    transaction_amount_cents: '900',
    transaction_currency_code: 'USD',
    transaction_type: 'purchase',
    status: 'open',
    reason_code: 'other',
    description: 'Please review this transaction.',
    opened_by: CUSTOMER_ID,
    opened_at: '2026-09-12T15:00:00.000Z',
    updated_at: '2026-09-12T15:00:00.000Z',
  }] });

  const response = await request(createCustomerApp()).get('/disputes?limit=10&offset=20');

  expect(response.status).toBe(200);
  expect(response.body.disputes[0]).toMatchObject({ id: 'dispute-4', amountCents: 900 });
  expect(response.body.pagination).toEqual({ limit: 10, offset: 20, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[0][0]).toContain('LIMIT $2 OFFSET $3');
  expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, 11, 20]);
});

test('paginates and filters the admin credit dispute queue', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'dispute-2',
    transaction_id: 'tx-2',
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    restaurant_name: 'OxSteed Cafe',
    transaction_amount_cents: '1800',
    transaction_currency_code: 'USD',
    transaction_type: 'purchase',
    transaction_reference_type: 'food_order',
    transaction_reference_id: '456',
    transaction_posted_at: '2026-09-12T13:00:00.000Z',
    status: 'resolved',
    reason_code: 'duplicate_charge',
    description: 'The order was charged twice.',
    resolution: 'Refund issued through the compensating ledger flow.',
    opened_by: CUSTOMER_ID,
    resolved_by: ADMIN_ID,
    opened_at: '2026-09-12T13:30:00.000Z',
    resolved_at: '2026-09-12T14:00:00.000Z',
    updated_at: '2026-09-12T14:00:00.000Z',
  }] });

  const response = await request(createAdminApp()).get('/disputes?status=resolved&limit=10&offset=20');

  expect(response.status).toBe(200);
  expect(response.body.disputes[0]).toMatchObject({ id: 'dispute-2', status: 'resolved', amountCents: 1800 });
  expect(response.body.pagination).toEqual({ limit: 10, offset: 20, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[0][0]).toContain('d.status = $1');
  expect(mockQuery.mock.calls[0][0]).toContain('LIMIT $2 OFFSET $3');
  expect(mockQuery.mock.calls[0][1]).toEqual(['resolved', 11, 20]);
});

test('exports a filtered, formula-safe admin credit dispute queue', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'dispute-3',
    transaction_id: 'tx-3',
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    restaurant_name: 'OxSteed Cafe',
    transaction_amount_cents: '2400',
    transaction_currency_code: 'USD',
    transaction_type: 'purchase',
    transaction_reference_type: 'food_order',
    transaction_reference_id: '789',
    transaction_posted_at: '2026-09-12T15:00:00.000Z',
    status: 'resolved',
    reason_code: '=HYPERLINK("https://example.com")',
    description: 'Customer said "the order was duplicated".',
    resolution: 'Refund issued.',
    opened_by: CUSTOMER_ID,
    resolved_by: ADMIN_ID,
    opened_at: '2026-09-12T15:30:00.000Z',
    resolved_at: '2026-09-12T16:00:00.000Z',
    updated_at: '2026-09-12T16:00:00.000Z',
  }] });

  const response = await request(createAdminApp()).get('/disputes.csv?status=resolved&partnerId=41');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.headers['content-disposition']).toContain('oxsteed-credit-disputes-');
  expect(response.text).toContain("'=HYPERLINK(\"\"https://example.com\"\")");
  expect(response.text).toContain('Customer said ""the order was duplicated"".');
  expect(mockQuery.mock.calls[0][0]).toContain('d.partner_id = $1');
  expect(mockQuery.mock.calls[0][0]).toContain('d.status = $2');
  expect(mockQuery.mock.calls[0][1]).toEqual([41, 'resolved', 251, 0]);
});

test('exports a filtered, formula-safe customer entitlement directory', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'entitlement-2',
    customer_id: CUSTOMER_ID,
    first_name: 'Alice',
    last_name: 'Customer',
    email: 'alice@example.com',
    agreement_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    partner_id: 41,
    restaurant_id: 9,
    restaurant_name: 'OxSteed Cafe',
    agreement_version: 3,
    agreement_status: 'active',
    settlement_currency_code: 'USD',
    status: 'active',
    starts_at: null,
    ends_at: null,
    max_transaction_cents: '2500',
    daily_limit_cents: '10000',
    reason: '=HYPERLINK("https://example.com")',
    created_by: ADMIN_ID,
    created_at: '2026-09-12T12:00:00.000Z',
    updated_at: '2026-09-12T12:30:00.000Z',
    total_count: 1,
  }] });

  const response = await request(createAdminApp()).get('/entitlements.csv?search=alice&status=active');

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/csv');
  expect(response.headers['content-disposition']).toContain('oxsteed-credit-entitlements-');
  expect(response.text).toContain("'=HYPERLINK(\"\"https://example.com\"\")");
  expect(response.text).toContain('Alice Customer');
  expect(mockQuery.mock.calls[0][0]).toContain('u.email ILIKE $1');
  expect(mockQuery.mock.calls[0][0]).toContain('e.status = $2');
  expect(mockQuery.mock.calls[0][1]).toEqual(['%alice%', 'active', 250, 0]);
});

test('hashes the same journal payload deterministically', () => {
  const payload = {
    transactionId: 'tx-1',
    transactionType: 'purchase',
    accountId: 7,
    entrySide: 'debit',
    amountCents: 500,
    balanceAfterCents: 1500,
    currencyCode: 'USD',
    sequence: 2,
    previousEntryHash: 'abc',
    metadata: { b: 2, a: 1 },
  };

  expect(service.computeEntryHash(payload)).toBe(service.computeEntryHash({ ...payload, metadata: { a: 1, b: 2 } }));
});

test('requires a dedicated ledger secret in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLedgerSecret = process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
  process.env.NODE_ENV = 'production';
  delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;

  expect(() => service.computeEntryHash({ transactionId: 'tx-1', accountId: 7, entrySide: 'debit', amountCents: 1 })).toThrow('OXSTEED_CREDIT_LEDGER_HMAC_SECRET');

  process.env.NODE_ENV = originalNodeEnv;
  if (originalLedgerSecret === undefined) delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET;
  else process.env.OXSTEED_CREDIT_LEDGER_HMAC_SECRET = originalLedgerSecret;
});

test('counts active credit holds toward agreement spending limits', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'USD',
      daily_customer_limit_cents: '5000',
      lifetime_customer_limit_cents: '10000',
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [{ daily_cents: '5000', lifetime_cents: '7000' }] });

  await expect(service.findSpendAgreement({
    query: mockQuery,
  }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 1,
  })).rejects.toMatchObject({ code: 'credit_daily_limit_reached' });

  expect(mockQuery.mock.calls[1][0]).toContain('oxsteed_credit_holds');
  expect(mockQuery.mock.calls[1][0]).toContain("h.status = 'active'");
});

test('can exclude the hold being captured from agreement usage totals', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'USD',
      daily_customer_limit_cents: '5000',
      lifetime_customer_limit_cents: '10000',
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [{ daily_cents: '0', lifetime_cents: '0' }] });

  await expect(service.findSpendAgreement({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 5000,
    excludeHoldId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  })).resolves.toBeTruthy();

  expect(mockQuery.mock.calls[1][0]).toContain('h.id <> $4::uuid');
  expect(mockQuery.mock.calls[1][1]).toEqual([41, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', CUSTOMER_ID, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
});

test('fails closed when a scoped agreement is missing request context', async () => {
  const agreement = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    partner_id: 41,
    status: 'active',
    starts_at: '2026-09-01T00:00:00.000Z',
    ends_at: null,
    allowed_order_types: ['pickup'],
    allowed_categories: ['food'],
    allowed_menu_item_ids: [7],
    geography: {},
    settlement_currency_code: 'USD',
    entitlement_id: null,
    entitlement_status: null,
  };

  mockQuery.mockResolvedValueOnce({ rows: [agreement] });
  await expect(service.findSpendAgreement({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    category: 'food',
    menuItemId: 7,
    amountCents: 100,
  })).rejects.toMatchObject({ code: 'credit_order_type_not_eligible' });

  resetMocks();
  mockQuery.mockResolvedValueOnce({ rows: [agreement] });
  await expect(service.findSpendAgreement({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    orderType: 'pickup',
    menuItemId: 7,
    amountCents: 100,
  })).rejects.toMatchObject({ code: 'credit_category_not_eligible' });

  resetMocks();
  mockQuery.mockResolvedValueOnce({ rows: [agreement] });
  await expect(service.findSpendAgreement({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    orderType: 'pickup',
    category: 'food',
    amountCents: 100,
  })).rejects.toMatchObject({ code: 'credit_menu_item_not_eligible' });
});

test('passes the requested agreement through purchase authorization', async () => {
  const agreementId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const customerAccount = { id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '1000', reserved_cents: '0', status: 'active', ledger_version: '0', last_entry_hash: null };
  const partnerAccount = { id: 8001, account_type: 'partner_payable', customer_id: null, partner_id: 41, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active', ledger_version: '0', last_entry_hash: null };
  const transaction = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', transaction_type: 'purchase', status: 'posted', debit_account_id: 7001, credit_account_id: 8001, amount_cents: '100', currency_code: 'USD', partner_id: 41, agreement_id: agreementId, idempotency_key: 'purchase-agreement-1', reference_type: 'food_order', reference_id: 'order-1', metadata: {}, posted_at: '2026-09-12T12:00:00.000Z' };
  const entry = { id: 1, account_id: 7001, entry_side: 'debit', amount_cents: '100', balance_after_cents: '900', sequence: 1, previous_entry_hash: null, entry_hash: 'hash-1' };

  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: agreementId, partner_id: 41, status: 'active', starts_at: '2026-09-01T00:00:00.000Z', ends_at: null, allowed_order_types: [], allowed_categories: [], allowed_menu_item_ids: [], geography: {}, settlement_currency_code: 'USD', restaurant_currency_code: 'USD', daily_customer_limit_cents: '10000', entitlement_id: null, entitlement_status: null }] })
    .mockResolvedValueOnce({ rows: [{ daily_cents: '0', lifetime_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [{ movement_count: '0', movement_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [partnerAccount] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [customerAccount, partnerAccount] })
    .mockResolvedValueOnce({ rows: [transaction] })
    .mockResolvedValueOnce({ rows: [{ ...customerAccount, balance_cents: '900', ledger_version: '1', last_entry_hash: 'hash-1' }] })
    .mockResolvedValueOnce({ rows: [entry] })
    .mockResolvedValueOnce({ rows: [{ ...partnerAccount, balance_cents: '100', ledger_version: '1', last_entry_hash: 'hash-2' }] })
    .mockResolvedValueOnce({ rows: [{ ...entry, id: 2, account_id: 8001, entry_side: 'credit', balance_after_cents: '100', entry_hash: 'hash-2' }] })
    .mockResolvedValueOnce({ rows: [] });

  await service.purchaseWithCreditInTransaction({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    agreementId,
    excludeHoldId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    amountCents: 100,
    currencyCode: 'USD',
    idempotencyKey: 'purchase-agreement-1',
    referenceType: 'food_order',
    referenceId: 'order-1',
  });

  expect(mockQuery.mock.calls[4][0]).toContain('AND ($3::uuid IS NULL OR a.id = $3::uuid)');
  expect(mockQuery.mock.calls[4][1]).toEqual([CUSTOMER_ID, 41, agreementId]);
  expect(mockQuery.mock.calls[5][1]).toEqual([41, agreementId, CUSTOMER_ID, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc']);
});

test('replays a committed purchase while the credit rail is suspended', async () => {
  const existing = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'purchase',
    status: 'posted',
    debit_account_id: 7001,
    credit_account_id: 8001,
    amount_cents: '1250',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    idempotency_key: 'purchase-replay-rail-off',
    reference_type: 'food_order',
    reference_id: 'order-replay-1',
    metadata: {},
    debit_account_customer_id: CUSTOMER_ID,
    credit_account_partner_id: 41,
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [existing] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.purchaseWithCreditInTransaction({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 1250,
    currencyCode: 'USD',
    idempotencyKey: existing.idempotency_key,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  });

  expect(result.replayed).toBe(true);
  expect(result.transaction).toMatchObject({ id: existing.id, amountCents: 1250, replayed: true });
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[0][0]).toContain('debit_account.customer_id');
  expect(mockQuery.mock.calls[1][0]).toContain('oxsteed_credit_transaction_entries');
});

test('fails closed when an idempotency key points to a non-posted transaction', async () => {
  const existing = {
    id: 'pending-credit-1',
    transaction_type: 'purchase',
    status: 'pending',
    debit_account_id: 7001,
    credit_account_id: 8001,
    amount_cents: '1250',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    idempotency_key: 'pending-credit-key',
    reference_type: 'food_order',
    reference_id: 'order-pending-1',
  };
  mockQuery.mockResolvedValueOnce({ rows: [existing] });

  await expect(service.postJournalTransaction({ query: mockQuery }, {
    transactionType: 'purchase',
    debitAccountId: 7001,
    creditAccountId: 8001,
    amountCents: 1250,
    currencyCode: 'USD',
    partnerId: 41,
    agreementId: existing.agreement_id,
    idempotencyKey: existing.idempotency_key,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  })).rejects.toMatchObject({ code: 'credit_idempotency_retry_required', status: 409 });

  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('rejects a purchase retry with a different committed spend scope', async () => {
  const existing = {
    id: 'scoped-purchase-1',
    transaction_type: 'purchase',
    status: 'posted',
    debit_account_id: 7001,
    credit_account_id: 8001,
    amount_cents: '1250',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    idempotency_key: 'scoped-purchase-key',
    reference_type: 'food_order',
    reference_id: 'order-scoped-1',
    metadata: { orderType: 'pickup', categories: ['food'], menuItemIds: ['44'] },
    debit_account_customer_id: CUSTOMER_ID,
    credit_account_partner_id: 41,
  };
  mockQuery.mockResolvedValueOnce({ rows: [existing] });

  await expect(service.purchaseWithCreditInTransaction({ query: mockQuery }, {
    customerId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 1250,
    currencyCode: 'USD',
    idempotencyKey: existing.idempotency_key,
    orderType: 'delivery',
    category: 'food',
    menuItemId: 44,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  })).rejects.toMatchObject({ code: 'credit_idempotency_conflict', status: 409 });

  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('does not create a new hold for a suspended credit account', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'USD',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [{ movement_count: '0', movement_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 7001,
      account_type: 'customer_wallet',
      customer_id: CUSTOMER_ID,
      currency_code: 'USD',
      balance_cents: '1000',
      reserved_cents: '0',
      status: 'suspended',
    }] })
    .mockResolvedValueOnce({ rows: [] });

  await expect(service.createCreditHold({
    customerId: CUSTOMER_ID,
    actorUserId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    idempotencyKey: 'suspended-hold-1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  })).rejects.toMatchObject({ code: 'credit_account_inactive' });

  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_holds'))).toBe(false);
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('reserved_cents = reserved_cents +'))).toBe(false);
});

test('rejects credit hold idempotency reuse for a different agreement or reference', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-current',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'USD',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
      entitlement_lifetime_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [{ movement_count: '0', movement_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, currency_code: 'USD', balance_cents: '1000', reserved_cents: '0', status: 'active' }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'hold-existing',
      amount_cents: '100',
      partner_id: 41,
      agreement_id: 'agreement-old',
      currency_code: 'USD',
      purpose: 'Old order',
      reference_type: 'food_order',
      reference_id: 'order-old',
    }] });

  await expect(service.createCreditHold({
    customerId: CUSTOMER_ID,
    actorUserId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    idempotencyKey: 'hold-replay-conflict-1',
    purpose: 'New order',
    referenceType: 'food_order',
    referenceId: 'order-new',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  })).rejects.toMatchObject({ code: 'credit_hold_idempotency_conflict' });
});

test('replays a non-USD credit hold when the settlement currency matches', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ is_enabled: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 'agreement-eur',
      partner_id: 41,
      status: 'active',
      starts_at: '2026-09-01T00:00:00.000Z',
      ends_at: null,
      allowed_order_types: [],
      allowed_categories: [],
      allowed_menu_item_ids: [],
      geography: {},
      settlement_currency_code: 'EUR',
      max_transaction_cents: null,
      daily_customer_limit_cents: null,
      lifetime_customer_limit_cents: null,
      entitlement_id: null,
      entitlement_status: null,
      entitlement_starts_at: null,
      entitlement_ends_at: null,
      entitlement_max_transaction_cents: null,
      entitlement_daily_limit_cents: null,
    }] })
    .mockResolvedValueOnce({ rows: [{ movement_count: '0', movement_cents: '0' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 7001,
      account_type: 'customer_wallet',
      customer_id: CUSTOMER_ID,
      currency_code: 'EUR',
      balance_cents: '1000',
      reserved_cents: '0',
      status: 'active',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 'hold-eur',
      amount_cents: '100',
      partner_id: 41,
      agreement_id: 'agreement-eur',
      currency_code: 'EUR',
      purpose: 'Order retry',
      reference_type: 'food_order',
      reference_id: 'order-eur',
      idempotency_key: 'hold-eur-replay-1',
      status: 'active',
      expires_at: '2026-09-12T13:00:00.000Z',
      created_at: '2026-09-12T12:00:00.000Z',
    }] });

  const result = await service.createCreditHold({
    customerId: CUSTOMER_ID,
    actorUserId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    currencyCode: 'EUR',
    idempotencyKey: 'hold-eur-replay-1',
    purpose: 'Order retry',
    referenceType: 'food_order',
    referenceId: 'order-eur',
  });

  expect(result.replayed).toBe(true);
  expect(result.hold).toMatchObject({ id: 'hold-eur', currencyCode: 'EUR' });
});

test('replays a committed credit hold while the rail is suspended', async () => {
  const existing = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    account_id: 7001,
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    agreement_id: 'agreement-hold-replay',
    amount_cents: '100',
    currency_code: 'USD',
    status: 'active',
    purpose: 'Order retry',
    reference_type: 'food_order',
    reference_id: 'order-hold-replay-1',
    idempotency_key: 'hold-replay-rail-off',
    expires_at: '2026-09-12T13:00:00.000Z',
    created_at: '2026-09-12T12:00:00.000Z',
  };
  mockQuery.mockResolvedValueOnce({ rows: [existing] });

  const result = await service.createCreditHold({
    customerId: CUSTOMER_ID,
    actorUserId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    currencyCode: 'USD',
    idempotencyKey: existing.idempotency_key,
    purpose: existing.purpose,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  });

  expect(result.replayed).toBe(true);
  expect(result.hold).toMatchObject({ id: existing.id, amountCents: 100, currencyCode: 'USD' });
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toContain('WHERE idempotency_key = $1');
});

test('rejects a Credit hold replay when its stored spend scope differs', async () => {
  const existing = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    customer_id: CUSTOMER_ID,
    partner_id: 41,
    agreement_id: 'agreement-scoped-hold',
    amount_cents: '100',
    currency_code: 'USD',
    purpose: 'Scoped order',
    reference_type: 'food_order',
    reference_id: 'order-scoped-1',
    idempotency_key: 'hold-scope-replay-1',
    status: 'active',
    metadata: {
      _oxsteedCreditRequest: {
        orderType: 'pickup',
        category: 'entrees',
        menuItemId: 'menu-1',
        city: 'springfield',
        state: 'oh',
        postalCode: '45503',
        country: 'us',
      },
    },
  };
  mockQuery.mockResolvedValueOnce({ rows: [existing] });

  await expect(service.createCreditHold({
    customerId: CUSTOMER_ID,
    actorUserId: CUSTOMER_ID,
    partnerId: 41,
    amountCents: 100,
    idempotencyKey: existing.idempotency_key,
    orderType: 'delivery',
    category: 'entrees',
    menuItemId: 'menu-1',
    city: 'Springfield',
    state: 'OH',
    postalCode: '45503',
    country: 'US',
    purpose: existing.purpose,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  })).rejects.toMatchObject({ code: 'credit_hold_idempotency_conflict', status: 409 });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('recomputes the full OxSteed Credit hash chain and account heads', () => {
  const first = {
    transaction_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    account_id: 7001,
    entry_side: 'credit',
    amount_cents: '1000',
    balance_after_cents: '1000',
    sequence: 1,
    previous_entry_hash: null,
    transaction_type: 'load',
    currency_code: 'USD',
    metadata: { source: 'test' },
  };
  first.entry_hash = service.computeEntryHash({
    transactionId: first.transaction_id,
    transactionType: first.transaction_type,
    accountId: first.account_id,
    entrySide: first.entry_side,
    amountCents: 1000,
    balanceAfterCents: 1000,
    currencyCode: 'USD',
    sequence: 1,
    previousEntryHash: null,
    metadata: first.metadata,
  });
  const second = {
    ...first,
    transaction_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    entry_side: 'debit',
    amount_cents: '250',
    balance_after_cents: '750',
    sequence: 2,
    previous_entry_hash: first.entry_hash,
    transaction_type: 'purchase',
  };
  second.entry_hash = service.computeEntryHash({
    transactionId: second.transaction_id,
    transactionType: second.transaction_type,
    accountId: second.account_id,
    entrySide: second.entry_side,
    amountCents: 250,
    balanceAfterCents: 750,
    currencyCode: 'USD',
    sequence: 2,
    previousEntryHash: second.previous_entry_hash,
    metadata: second.metadata,
  });

  expect(verifyEntryHashes([first, second], [{ id: 7001, ledger_version: 2, last_entry_hash: second.entry_hash }])).toEqual({
    invalidEntryHashes: 0,
    invalidHashChains: 0,
    invalidAccountHashHeads: 0,
  });
  expect(verifyEntryHashes([{ ...second, entry_hash: 'tampered' }], [{ id: 7001, ledger_version: 2, last_entry_hash: second.entry_hash }])).toMatchObject({
    invalidEntryHashes: 1,
    invalidHashChains: 1,
    invalidAccountHashHeads: 1,
  });
});

test('verifies historical entries with a retained prior ledger signing key', () => {
  const previousVersion = process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION;
  const previousKeys = process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON;
  process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION = 'v2';
  process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON = JSON.stringify({
    v1: 'credit-test-previous-ledger-secret-32!!',
  });
  const entry = {
    transaction_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    account_id: 7001,
    entry_side: 'credit',
    amount_cents: '1000',
    balance_after_cents: '1000',
    sequence: 1,
    previous_entry_hash: null,
    transaction_type: 'load',
    currency_code: 'USD',
    metadata: { source: 'rotation-test' },
    hash_key_version: 'v1',
  };
  entry.entry_hash = service.computeEntryHash({
    transactionId: entry.transaction_id,
    transactionType: entry.transaction_type,
    accountId: entry.account_id,
    entrySide: entry.entry_side,
    amountCents: 1000,
    balanceAfterCents: 1000,
    currencyCode: 'USD',
    sequence: 1,
    previousEntryHash: null,
    metadata: entry.metadata,
  }, 'v1');

  expect(verifyEntryHashes([entry], [{ id: 7001, ledger_version: 1, last_entry_hash: entry.entry_hash }])).toEqual({
    invalidEntryHashes: 0,
    invalidHashChains: 0,
    invalidAccountHashHeads: 0,
  });
  if (previousVersion === undefined) delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION;
  else process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEY_VERSION = previousVersion;
  if (previousKeys === undefined) delete process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON;
  else process.env.OXSTEED_CREDIT_LEDGER_HMAC_KEYS_JSON = previousKeys;
});

test('replays the winning transaction when a concurrent idempotent insert loses the race', async () => {
  const existing = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'purchase',
    status: 'posted',
    debit_account_id: 7001,
    credit_account_id: 8001,
    amount_cents: '1250',
    currency_code: 'USD',
    partner_id: 41,
    agreement_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    idempotency_key: 'purchase-race-1',
    reference_type: 'food_order',
    reference_id: 'order-1',
    metadata: {},
  };
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [
      { id: 7001, account_type: 'customer_wallet', customer_id: CUSTOMER_ID, partner_id: null, currency_code: 'USD', balance_cents: '5000', reserved_cents: '0', status: 'active' },
      { id: 8001, account_type: 'partner_payable', customer_id: null, partner_id: 41, currency_code: 'USD', balance_cents: '0', reserved_cents: '0', status: 'active' },
    ] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [existing] })
    .mockResolvedValueOnce({ rows: [] });

  const result = await service.postJournalTransaction({ query: mockQuery }, {
    transactionType: 'purchase',
    debitAccountId: 7001,
    creditAccountId: 8001,
    amountCents: 1250,
    currencyCode: 'USD',
    partnerId: 41,
    agreementId: existing.agreement_id,
    idempotencyKey: existing.idempotency_key,
    referenceType: existing.reference_type,
    referenceId: existing.reference_id,
  });

  expect(result.replayed).toBe(true);
  expect(result.transaction).toMatchObject({ id: existing.id, amountCents: 1250, replayed: true });
  expect(mockQuery.mock.calls[2][0]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_transaction_entries'))).toBe(false);
});

test('fails closed when the OxSteed Credit emergency flag is disabled', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ is_enabled: false }] });

  expect(await service.isCreditRailEnabled({ query: mockQuery })).toBe(false);
  await expect(service.assertCreditRailEnabled({ query: mockQuery }))
    .rejects.toMatchObject({ code: 'credit_rail_suspended', status: 503 });
});

test('rejects a rail status change without a strict boolean', async () => {
  const response = await request(createAdminApp())
    .post('/rail')
    .send({ enabled: 'yes', reason: 'test change' });

  expect(response.status).toBe(400);
  expect(response.body.code).toBe('invalid_enabled');
  expect(mockQuery).not.toHaveBeenCalled();
});

test('requires an administrator identity for a real rail status change', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ key: 'oxsteed_credit_enabled', is_enabled: false, description: 'Credit rail', updated_by: null, updated_at: '2026-09-12T12:00:00.000Z' }] });

  await expect(service.setCreditRailStatus({
    enabled: true,
    reason: 'Approved after custody review',
  })).rejects.toMatchObject({ code: 'credit_rail_actor_required', status: 400 });
  expect(mockQuery).toHaveBeenCalledTimes(2);
});

test('changes the rail status with an audit reason and serialized control lock', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ key: 'oxsteed_credit_enabled', is_enabled: false, description: 'Credit rail', updated_by: null, updated_at: '2026-09-12T12:00:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [{ key: 'oxsteed_credit_enabled', is_enabled: true, description: 'Credit rail', updated_by: ADMIN_ID, updated_at: '2026-09-12T12:01:00.000Z' }] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(createAdminApp())
    .post('/rail')
    .send({ enabled: true, reason: 'Approved after custody review' });

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ changed: true, rail: { enabled: true, status: 'enabled', updatedBy: ADMIN_ID } });
  expect(mockQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  expect(mockQuery.mock.calls[2][0]).toContain('UPDATE feature_flags');
  expect(mockQuery.mock.calls[3][1][0]).toBe('credit.rail.enabled');
});

test('lists bounded OxSteed Credit audit events with state snapshots', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 55,
    action_type: 'credit.rail.suspended',
    actor_user_id: ADMIN_ID,
    customer_id: null,
    partner_id: null,
    resource_type: 'credit_rail',
    resource_id: 'oxsteed_credit_enabled',
    reason: 'Incident response',
    correlation_id: 'audit-test-1',
    before_state: { enabled: true },
    after_state: { enabled: false },
    metadata: { emergencyControl: true },
    previous_event_hash: null,
    event_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    created_at: '2026-09-12T12:00:00.000Z',
  }] });

  const response = await request(createAdminApp())
    .get('/audit-events?resourceType=credit_rail&limit=10');

  expect(response.status).toBe(200);
  expect(response.body.auditEvents[0]).toMatchObject({
    id: '55',
    actionType: 'credit.rail.suspended',
    resourceType: 'credit_rail',
    beforeState: { enabled: true },
    afterState: { enabled: false },
    previousEventHash: null,
    eventHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  expect(response.body.pagination).toMatchObject({ limit: 10, offset: 0, hasMore: false, nextOffset: null });
  expect(mockQuery.mock.calls[0][1]).toEqual(['credit_rail', 11, 0]);
});

test('returns the customer ledger balance after a transaction on its receipt', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    transaction_type: 'purchase',
    status: 'posted',
    amount_cents: '250',
    currency_code: 'USD',
    reference_type: 'food_order',
    reference_id: '12345',
    description: 'Restaurant purchase',
    posted_at: '2026-09-13T12:00:00.000Z',
    created_at: '2026-09-13T12:00:00.000Z',
    direction: 'debit',
    related_partner_id: 41,
    balance_after_cents: '750',
    restaurant_name: 'Test Restaurant',
  }] });

  const response = await request(createCustomerApp())
    .get('/transactions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?currencyCode=USD');

  expect(response.status).toBe(200);
  expect(response.body.transaction).toMatchObject({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    balanceAfterCents: 750,
    orderId: '12345',
  });
  expect(mockQuery.mock.calls[0][0]).toContain('oxsteed_credit_transaction_entries');
});
