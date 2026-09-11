'use strict';

const {
  VALID_STATUSES,
  canTransition,
  isValidStatus,
  transitionError,
} = require('../services/supportConversationStateMachine');

describe('support conversation state machine', () => {
  test('recognizes every public support lifecycle status', () => {
    expect(VALID_STATUSES).toEqual([
      'open',
      'pending',
      'reopened',
      'in_progress',
      'waiting_for_customer',
      'waiting_for_agent',
      'escalated',
      'resolved',
      'closed',
    ]);
    expect(isValidStatus(' RESOLVED ')).toBe(true);
    expect(isValidStatus('merged')).toBe(false);
  });

  test('allows normal work and reopen paths', () => {
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'pending')).toBe(true);
    expect(canTransition('resolved', 'reopened')).toBe(true);
    expect(canTransition('closed', 'reopened')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
    expect(canTransition('open', 'open')).toBe(true);
  });

  test('blocks unsafe backwards transitions and unknown states', () => {
    expect(canTransition('closed', 'open')).toBe(false);
    expect(canTransition('resolved', 'in_progress')).toBe(false);
    expect(canTransition('merged', 'open')).toBe(false);
    expect(transitionError('closed', 'open')).toContain("'closed' to 'open'");
  });
});
