'use strict';

const {
  buildPopMarker,
  parsePopMarker,
  stripPopMarkers,
  normalizePopPayload,
  toPublicPopCard,
  redactPopForLog,
} = require('../services/chatProofOfPayment');

const {
  buildAgreementMarker,
  parseAgreementMarker,
  canRespondToAgreement,
  normalizeAgreementPayload,
  scheduleBlockedByAgreements,
  toPublicAgreementCard,
} = require('../services/chatAgreements');

const {
  normalizeBreakGlassReason,
  BREAK_GLASS_REASON_MIN,
} = require('../services/chatThreadAccess');

describe('chatProofOfPayment', () => {
  test('marker round-trip', () => {
    const marker = buildPopMarker({
      id: 'p1',
      status: 'submitted',
      amountCents: 12550,
      paymentMethod: 'Zelle',
      transactionId: 'txn-9',
      paidOn: '2026-09-20',
      quoteKind: 'helper',
      quoteId: 'q1',
    });
    const parsed = parsePopMarker(`Receipt\n${marker}`);
    expect(parsed.id).toBe('p1');
    expect(parsed.amountCents).toBe(12550);
    expect(parsed.paymentMethod).toBe('Zelle');
    expect(parsed.quoteKind).toBe('helper');
    expect(stripPopMarkers(`Hi\n${marker}\nBye`)).toMatch(/Hi/);
    expect(stripPopMarkers(`Hi\n${marker}\nBye`)).not.toMatch(/\[pop:/);
  });

  test('normalizePopPayload validates amount and requires details', () => {
    expect(normalizePopPayload({}).error).toMatch(/Provide payment/);
    expect(normalizePopPayload({ amount: -1, payment_method: 'x' }).error).toMatch(/Invalid amount/);
    const ok = normalizePopPayload({ amount: 10.5, payment_method: 'Venmo', transaction_id: 'a' });
    expect(ok.error).toBeUndefined();
    expect(ok.amountCents).toBe(1050);
  });

  test('redacts sensitive fields for logs', () => {
    const redacted = redactPopForLog({
      id: '1',
      status: 'submitted',
      amount_cents: 999,
      transaction_id: 'secret',
      attachment_key: 'k',
    });
    expect(redacted.amount_cents).toBe('[redacted]');
    expect(redacted.transaction_id).toBe('[redacted]');
  });

  test('toPublicPopCard shape', () => {
    const card = toPublicPopCard({
      id: 'x',
      status: 'confirmed',
      amount_cents: 100,
      currency: 'USD',
      attachment_key: 'k',
      attachment_name: 'r.pdf',
    });
    expect(card.has_attachment).toBe(true);
    expect(card.id).toBe('x');
  });
});

describe('chatAgreements', () => {
  test('marker round-trip', () => {
    const marker = buildAgreementMarker({
      id: 'a1',
      token: 'tok',
      status: 'shared',
      version: 2,
      title: 'Service terms',
    });
    const parsed = parseAgreementMarker(marker);
    expect(parsed.id).toBe('a1');
    expect(parsed.version).toBe(2);
    expect(parsed.title).toBe('Service terms');
  });

  test('canRespond gates', () => {
    expect(canRespondToAgreement({ status: 'shared' }).ok).toBe(true);
    expect(canRespondToAgreement({ status: 'accepted' }).reason).toBe('already_accepted');
    expect(canRespondToAgreement({ status: 'shared', superseded_at: new Date() }).reason).toBe('superseded');
  });

  test('normalizeAgreementPayload', () => {
    expect(normalizeAgreementPayload({ title: '' }).error).toMatch(/Title/);
    const ok = normalizeAgreementPayload({
      title: 'Terms',
      body_text: 'Pay on completion',
      required_before_schedule: 'true',
    });
    expect(ok.requiredBeforeSchedule).toBe(true);
    expect(normalizeAgreementPayload({ title: 'T', required_before_schedule: 'false', body_text: 'x' }).requiredBeforeSchedule).toBe(false);
  });

  test('scheduleBlockedByAgreements', () => {
    const blocked = scheduleBlockedByAgreements([
      { id: '1', title: 'A', status: 'shared', required_before_schedule: true },
    ]);
    expect(blocked.blocked).toBe(true);
    expect(
      scheduleBlockedByAgreements([
        { id: '1', title: 'A', status: 'accepted', required_before_schedule: true },
      ]).blocked,
    ).toBe(false);
    expect(
      scheduleBlockedByAgreements([
        { id: '2', title: 'Ack', status: 'acknowledged', required_before_schedule: true },
      ]).blocked,
    ).toBe(false);
  });

  test('toPublicAgreementCard', () => {
    const card = toPublicAgreementCard({
      id: 'z',
      title: 'T',
      status: 'shared',
      version: 1,
      body_text: 'Hello',
    });
    expect(card.can_respond).toBe(true);
    expect(card.body_text).toBe('Hello');
  });
});

describe('admin break-glass reason', () => {
  test('requires minimum length', () => {
    expect(normalizeBreakGlassReason('short').ok).toBe(false);
    expect(BREAK_GLASS_REASON_MIN).toBeGreaterThanOrEqual(10);
    const ok = normalizeBreakGlassReason('Customer dispute review for refund');
    expect(ok.ok).toBe(true);
    expect(ok.reason).toMatch(/dispute/);
  });
});
