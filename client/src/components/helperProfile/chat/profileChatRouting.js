/**
 * Pure routing decisions for public profile messenger AI ↔ human handoff.
 * Kept free of React so unit tests stay simple.
 */

/**
 * @typedef {'switch_helper_live' | 'verify_for_live' | 'escalate_support' | 'retry' | null} SuggestedAction
 * @typedef {'switch_helper_live' | 'verify_for_live' | 'escalate_support' | 'retry' | null} AiFailureAction
 * @typedef {'fallback_to_ai' | 'offer_connect_live' | null} PresenceAction
 */

/**
 * Decide what to do when profile AI hard-fails (callWithFallback exhausted
 * or client received an AI error).
 *
 * @param {object} opts
 * @param {boolean} [opts.aiFailed]
 * @param {'helper'|'business'|'oxsteed'} [opts.destination] current destination (informational)
 * @param {boolean} [opts.providerOnline] helper or business rep online
 * @param {boolean} [opts.canLive] authenticated OR OTP-verified guest
 * @param {boolean} [opts.allowLiveChat] profile allows live chat
 * @param {boolean} [opts.canBeProvider] profile has a helper/business destination
 * @returns {{
 *   action: AiFailureAction,
 *   suggestedAction: SuggestedAction,
 *   autoSwitchHelper: boolean,
 *   autoRetryLive: boolean,
 *   showVerifyBanner: boolean,
 *   showEscalationPanel: boolean,
 * }}
 */
export function resolveAiFailureRouting({
  aiFailed = false,
  destination = 'helper',
  providerOnline = false,
  canLive = false,
  allowLiveChat = true,
  canBeProvider = true,
} = {}) {
  if (!aiFailed) {
    return {
      action: null,
      suggestedAction: null,
      autoSwitchHelper: false,
      autoRetryLive: false,
      showVerifyBanner: false,
      showEscalationPanel: false,
    };
  }

  const liveEligible =
    Boolean(canBeProvider) && Boolean(allowLiveChat) && Boolean(providerOnline);

  if (liveEligible && canLive) {
    return {
      action: 'switch_helper_live',
      suggestedAction: 'switch_helper_live',
      autoSwitchHelper: destination !== 'helper' && destination !== 'business',
      autoRetryLive: true,
      showVerifyBanner: false,
      showEscalationPanel: false,
    };
  }

  if (liveEligible && !canLive) {
    return {
      action: 'verify_for_live',
      suggestedAction: 'verify_for_live',
      autoSwitchHelper: false,
      autoRetryLive: false,
      showVerifyBanner: true,
      showEscalationPanel: false,
    };
  }

  // Provider offline, live disabled, or no provider destination → support handoff.
  // Prefer escalate over a dead retry when AI already hard-failed.
  return {
    action: 'escalate_support',
    suggestedAction: 'escalate_support',
    autoSwitchHelper: false,
    autoRetryLive: false,
    showVerifyBanner: false,
    showEscalationPanel: true,
  };
}

/**
 * Map a server `suggestedAction` (+ flags) into the same client decision shape.
 * Falls back to local resolveAiFailureRouting when the server omits the flag.
 *
 * @param {object} opts
 * @param {string|null} [opts.suggestedAction]
 * @param {boolean} [opts.aiFailed]
 * @param {boolean} [opts.providerOnline]
 * @param {boolean} [opts.canLive]
 * @param {boolean} [opts.allowLiveChat]
 * @param {'helper'|'business'|'oxsteed'} [opts.destination]
 * @param {boolean} [opts.canBeProvider]
 */
export function resolveAiFailureFromServer({
  suggestedAction = null,
  aiFailed = true,
  providerOnline = false,
  canLive = false,
  allowLiveChat = true,
  destination = 'helper',
  canBeProvider = true,
} = {}) {
  if (!aiFailed) {
    return resolveAiFailureRouting({ aiFailed: false });
  }

  if (
    suggestedAction === 'switch_helper_live' ||
    suggestedAction === 'verify_for_live' ||
    suggestedAction === 'escalate_support' ||
    suggestedAction === 'retry'
  ) {
    if (suggestedAction === 'switch_helper_live') {
      return {
        action: 'switch_helper_live',
        suggestedAction: 'switch_helper_live',
        autoSwitchHelper: destination !== 'helper' && destination !== 'business',
        autoRetryLive: true,
        showVerifyBanner: false,
        showEscalationPanel: false,
      };
    }
    if (suggestedAction === 'verify_for_live') {
      return {
        action: 'verify_for_live',
        suggestedAction: 'verify_for_live',
        autoSwitchHelper: false,
        autoRetryLive: false,
        showVerifyBanner: true,
        showEscalationPanel: false,
      };
    }
    if (suggestedAction === 'escalate_support') {
      return {
        action: 'escalate_support',
        suggestedAction: 'escalate_support',
        autoSwitchHelper: false,
        autoRetryLive: false,
        showVerifyBanner: false,
        showEscalationPanel: true,
      };
    }
    // retry — keep error + let user resend; still surface escalation if offline
    return {
      action: 'retry',
      suggestedAction: 'retry',
      autoSwitchHelper: false,
      autoRetryLive: false,
      showVerifyBanner: false,
      showEscalationPanel: !providerOnline,
    };
  }

  return resolveAiFailureRouting({
    aiFailed: true,
    destination,
    providerOnline,
    canLive,
    allowLiveChat,
    canBeProvider,
  });
}

/**
 * Coherent online/offline transitions while destination=helper|business.
 *
 * @param {object} opts
 * @param {string} [opts.previousStatus]
 * @param {string} [opts.nextStatus]
 * @param {'helper'|'business'|'oxsteed'} [opts.destination]
 * @returns {{ action: PresenceAction, showAiBanner: boolean, showConnectLiveCta: boolean }}
 */
export function resolveProviderPresenceTransition({
  previousStatus = null,
  nextStatus = null,
  destination = 'helper',
} = {}) {
  if (destination !== 'helper' && destination !== 'business') {
    return { action: null, showAiBanner: false, showConnectLiveCta: false };
  }
  if (!previousStatus || !nextStatus || previousStatus === nextStatus) {
    return { action: null, showAiBanner: false, showConnectLiveCta: false };
  }

  const wasLive = previousStatus === 'live';
  const isLive = nextStatus === 'live';

  if (wasLive && !isLive) {
    return { action: 'fallback_to_ai', showAiBanner: true, showConnectLiveCta: false };
  }
  if (!wasLive && isLive) {
    return { action: 'offer_connect_live', showAiBanner: false, showConnectLiveCta: true };
  }
  return { action: null, showAiBanner: false, showConnectLiveCta: false };
}

/**
 * Whether a visitor may enter live helper chat (client-side mirror of server gate).
 */
export function canVisitorLive({
  isAuthenticated = false,
  guestVerified = false,
} = {}) {
  return Boolean(isAuthenticated || guestVerified);
}

/**
 * OxSteed dock destination is always AI — never treat it as live platform agents.
 */
export function isOxsteedDestinationLiveAgent() {
  return false;
}
