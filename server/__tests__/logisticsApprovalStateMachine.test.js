'use strict';

// Phase 2 (logistics refactor): the campaign approval state machine lives
// separately from the fulfillment (pooled order) state machine. Approving a
// pending campaign publishes it; the fulfillment transitions stay untouched.

const {
  approval,
  pooled,
  APPROVAL_TRANSITIONS,
  POOLED_TRANSITIONS,
} = require('../services/logisticsStateMachine');

describe('campaign approval state machine', () => {
  test('draft can only be submitted for review', () => {
    expect(approval.allowedFrom('draft')).toEqual(['pending_review']);
    expect(approval.canTransition('draft', 'pending_review')).toBe(true);
    expect(approval.canTransition('draft', 'approved')).toBe(false);
  });

  test('pending review can be approved, sent back, or rejected', () => {
    expect(approval.canTransition('pending_review', 'approved')).toBe(true);
    expect(approval.canTransition('pending_review', 'revisions_requested')).toBe(true);
    expect(approval.canTransition('pending_review', 'rejected')).toBe(true);
    expect(approval.canTransition('pending_review', 'pending_review')).toBe(true);
  });

  test('revisions_requested returns to the organizer for rework or resubmission', () => {
    expect(approval.canTransition('revisions_requested', 'pending_review')).toBe(true);
    expect(approval.canTransition('revisions_requested', 'draft')).toBe(true);
    expect(approval.canTransition('revisions_requested', 'approved')).toBe(false);
  });

  test('approved campaigns cannot silently jump back to draft', () => {
    expect(approval.canTransition('approved', 'draft')).toBe(false);
    expect(approval.canTransition('approved', 'pending_review')).toBe(true);
  });

  test('illegal transitions throw with code illegal_state_transition', () => {
    expect(() => approval.assertTransition('draft', 'approved')).toThrow(
      expect.objectContaining({ code: 'illegal_state_transition', status: 409 })
    );
  });

  test('approval states stay out of the fulfillment transition map', () => {
    const fulfillmentStates = Object.keys(POOLED_TRANSITIONS);
    for (const state of Object.keys(APPROVAL_TRANSITIONS)) {
      if (state === 'draft') continue; // both lifecycles start at draft
      expect(fulfillmentStates).not.toContain(state);
    }
    // Fulfillment draft still opens the campaign on publication.
    expect(pooled.canTransition('draft', 'open')).toBe(true);
  });
});
