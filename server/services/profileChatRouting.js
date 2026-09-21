'use strict';

/**
 * Server-side mirror of client profileChatRouting for structured AI-failure flags.
 * Keep suggestedAction values aligned with the client helper.
 */

/**
 * @param {object} opts
 * @param {boolean} [opts.providerOnline]
 * @param {boolean} [opts.canLive] authenticated user OR OTP-verified guest
 * @param {boolean} [opts.allowLiveChat]
 * @returns {'switch_helper_live'|'verify_for_live'|'escalate_support'|'retry'}
 */
function resolveProfileAiFailureSuggestedAction({
  providerOnline = false,
  canLive = false,
  allowLiveChat = true,
} = {}) {
  if (allowLiveChat && providerOnline && canLive) {
    return 'switch_helper_live';
  }
  if (allowLiveChat && providerOnline && !canLive) {
    return 'verify_for_live';
  }
  return 'escalate_support';
}

/**
 * Build the structured AI-failure payload for profile-message responses.
 */
function buildProfileAiFailurePayload({
  destination = 'helper',
  providerOnline = false,
  canLive = false,
  allowLiveChat = true,
  threadId = null,
  helperOnline = false,
} = {}) {
  const suggestedAction = resolveProfileAiFailureSuggestedAction({
    providerOnline,
    canLive,
    allowLiveChat,
  });

  return {
    type: 'ai_error',
    aiFailed: true,
    providerOnline: Boolean(providerOnline),
    suggestedAction,
    helperOnline: Boolean(helperOnline || providerOnline),
    authorType: destination === 'oxsteed' ? 'oxsteed_ai' : 'helper_ai',
    reply: null,
    threadId: threadId || null,
    mode: 'ai_failed',
  };
}

module.exports = {
  resolveProfileAiFailureSuggestedAction,
  buildProfileAiFailurePayload,
};
