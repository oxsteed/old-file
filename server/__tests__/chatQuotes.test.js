'use strict';

const {
  buildQuoteMarker,
  parseQuoteMarker,
  isQuoteExpired,
  canRespond,
  toChatStatus,
  toDbAcceptStatus,
  normalizeLineItems,
  calculateTotals,
  toPublicQuoteCard,
  buildRequestChangesMessage,
} = require('../services/chatQuotes');

describe('chatQuotes service', () => {
  test('marker round-trip', () => {
    const marker = buildQuoteMarker({
      kind: 'helper',
      id: 'a1b2',
      token: 'tok',
      status: 'sent',
      totalCents: 9900,
      title: 'Yard work',
      validUntil: '2026-11-01',
      version: 1,
    });
    const parsed = parseQuoteMarker(marker);
    expect(parsed.kind).toBe('helper');
    expect(parsed.id).toBe('a1b2');
    expect(parsed.totalCents).toBe(9900);
    expect(parsed.title).toBe('Yard work');
  });

  test('status mapping business approved ↔ chat accepted', () => {
    expect(toChatStatus('business', 'approved')).toBe('accepted');
    expect(toDbAcceptStatus('business')).toBe('approved');
    expect(toDbAcceptStatus('helper')).toBe('accepted');
  });

  test('canRespond blocks expired and non-sent', () => {
    expect(canRespond({ status: 'sent', valid_until: '2099-01-01' }).ok).toBe(true);
    expect(canRespond({ status: 'sent', valid_until: '2000-01-01' }).reason).toBe('expired');
    expect(canRespond({ status: 'accepted' }).reason).toBe('already_accepted');
    expect(canRespond({ status: 'sent', superseded_at: new Date() }).reason).toBe('superseded');
  });

  test('isQuoteExpired date-only inclusive', () => {
    expect(isQuoteExpired({ status: 'sent', valid_until: '2099-06-01' })).toBe(false);
    expect(isQuoteExpired({ status: 'sent', valid_until: '2010-06-01' })).toBe(true);
  });

  test('normalizeLineItems + totals', () => {
    const { items, error } = normalizeLineItems([
      { description: 'Labor', quantity: 2, unit_price: 50 },
    ]);
    expect(error).toBeUndefined();
    expect(items[0].unit_price_cents).toBe(5000);
    const totals = calculateTotals(items, 10);
    expect(totals.subtotal).toBe(10000);
    expect(totals.tax).toBe(1000);
    expect(totals.total).toBe(11000);
  });

  test('toPublicQuoteCard shape', () => {
    const card = toPublicQuoteCard('business', {
      id: 7,
      title: 'Paint',
      status: 'approved',
      total_cents: 20000,
      subtotal_cents: 20000,
      tax_rate: 0,
      line_items: [],
      token: 't',
      version: 1,
    });
    expect(card.status).toBe('accepted');
    expect(card.kind).toBe('business');
    expect(card.id).toBe('7');
  });

  test('request changes template', () => {
    expect(buildRequestChangesMessage({ title: 'X', reason: 'lower price' })).toMatch(/lower price/);
  });
});
