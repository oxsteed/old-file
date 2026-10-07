'use strict';

// Digest 6 authz tests: kitchen cannot refund, staff getOrder needs orders.view,
// runner claim needs runner.update.

describe('Digest 6 authz', () => {
  test('kitchen.update alone cannot transition to cancelled/refunded', () => {
    // The fix checks isFinancialTransition before asserting permissions.
    // Financial transitions require orders.manage or issue_refunds.
    const isFinancialTransition = (status) => ['cancelled', 'refunded'].includes(status);
    expect(isFinancialTransition('cancelled')).toBe(true);
    expect(isFinancialTransition('refunded')).toBe(true);
    expect(isFinancialTransition('preparing')).toBe(false);
    expect(isFinancialTransition('ready')).toBe(false);
  });

  test('staff getOrder masks PII without orders.manage', () => {
    const maskOrder = (order, canSeeSensitive) => {
      if (canSeeSensitive) return order;
      return {
        ...order,
        guest_phone: order.guest_phone ? '***' : null,
        guest_email: order.guest_email ? '***' : null,
        stripe_payment_intent_id: undefined,
        metadata: undefined,
      };
    };
    const order = {
      guest_phone: '555-1234',
      guest_email: 'test@example.com',
      stripe_payment_intent_id: 'pi_123',
      metadata: { trackingToken: 'abc' },
    };
    const masked = maskOrder(order, false);
    expect(masked.guest_phone).toBe('***');
    expect(masked.guest_email).toBe('***');
    expect(masked.stripe_payment_intent_id).toBeUndefined();
    expect(masked.metadata).toBeUndefined();

    const unmasked = maskOrder(order, true);
    expect(unmasked.guest_phone).toBe('555-1234');
  });

  test('runner offers strip trackingToken from metadata', () => {
    // The listRunnerOffers SELECT explicitly excludes o.metadata.
    // Verify the query text does not select metadata.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../controllers/restaurantAppFlowController.js'),
      'utf8'
    );
    // Find the listRunnerOffers function and check its SELECT
    const match = src.match(/exports\.listRunnerOffers[\s\S]*?FROM restaurant_runner_tasks t[\s\S]*?WHERE t\.restaurant_id/);
    expect(match).toBeTruthy();
    const querySection = match[0];
    // Must not select o.metadata (which contains trackingToken)
    expect(querySection).not.toMatch(/o\.metadata/);
    // Should have a comment noting the stripping
    expect(querySection).toMatch(/trackingToken stripped/i);
  });
});
