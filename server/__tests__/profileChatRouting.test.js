'use strict';

const {
  resolveProfileAiFailureSuggestedAction,
  buildProfileAiFailurePayload,
} = require('../services/profileChatRouting');

describe('profileChatRouting', () => {
  test('suggestedAction switch_helper_live when online + canLive', () => {
    expect(resolveProfileAiFailureSuggestedAction({
      providerOnline: true,
      canLive: true,
    })).toBe('switch_helper_live');
  });

  test('suggestedAction verify_for_live when online but not eligible', () => {
    expect(resolveProfileAiFailureSuggestedAction({
      providerOnline: true,
      canLive: false,
    })).toBe('verify_for_live');
  });

  test('suggestedAction escalate_support when offline', () => {
    expect(resolveProfileAiFailureSuggestedAction({
      providerOnline: false,
      canLive: true,
    })).toBe('escalate_support');
  });

  test('failure payload includes structured flags', () => {
    const payload = buildProfileAiFailurePayload({
      destination: 'oxsteed',
      providerOnline: false,
      canLive: false,
      threadId: 't1',
    });
    expect(payload.aiFailed).toBe(true);
    expect(payload.type).toBe('ai_error');
    expect(payload.suggestedAction).toBe('escalate_support');
    expect(payload.authorType).toBe('oxsteed_ai');
    expect(payload.threadId).toBe('t1');
    expect(payload.providerOnline).toBe(false);
  });
});
