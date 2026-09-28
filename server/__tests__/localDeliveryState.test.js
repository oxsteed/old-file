const {
  canStatusTransition,
  canInternalAssign,
  canReleaseToMarketplace,
  intervalsOverlap,
} = require('../services/localDeliveryState');

describe('local delivery lifecycle guards', () => {
  test('allows only forward milestone transitions and pre-pickup cancellation', () => {
    expect(canStatusTransition('assigned', 'picked_up')).toBe(true);
    expect(canStatusTransition('picked_up', 'in_transit')).toBe(true);
    expect(canStatusTransition('in_transit', 'delivered')).toBe(true);
    expect(canStatusTransition('in_transit', 'cancelled')).toBe(false);
    expect(canStatusTransition('delivered', 'in_transit')).toBe(false);
  });

  test('prevents stale or terminal internal handoffs', () => {
    expect(canInternalAssign({ status: 'posted', dispatch_state: 'internal_review' })).toBe(true);
    expect(canInternalAssign({ status: 'cancelled', dispatch_state: 'exception' })).toBe(false);
    expect(canInternalAssign({ status: 'in_transit', dispatch_state: 'internal_assigned' })).toBe(false);
    expect(canReleaseToMarketplace({ status: 'assigned', dispatch_state: 'internal_assigned', helper_user_id: null })).toBe(true);
    expect(canReleaseToMarketplace({ status: 'assigned', dispatch_state: 'internal_assigned', helper_user_id: 'helper-1' })).toBe(false);
  });

  test('detects overlapping driver and vehicle reservations', () => {
    expect(intervalsOverlap('2026-09-27T10:00:00Z', '2026-09-27T11:00:00Z', '2026-09-27T10:30:00Z', '2026-09-27T11:30:00Z')).toBe(true);
    expect(intervalsOverlap('2026-09-27T10:00:00Z', '2026-09-27T11:00:00Z', '2026-09-27T11:00:00Z', '2026-09-27T12:00:00Z')).toBe(false);
  });
});
