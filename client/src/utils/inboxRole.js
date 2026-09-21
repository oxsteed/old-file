/**
 * Per-thread side for the unified inbox. Dual-role users keep customer and
 * helper conversations in one list instead of losing replies after a mode switch.
 */
export function isGuestConversation(conv) {
  return Boolean(conv?.is_guest_inquiry || String(conv?.id || '').startsWith('guest-'));
}

export function conversationSide(userId, conv) {
  if (!conv) return 'customer';
  if (isGuestConversation(conv)) return 'helper';
  if (userId != null && conv.customer_id != null && String(conv.customer_id) === String(userId)) {
    return 'customer';
  }
  if (userId != null && conv.helper_id != null && String(conv.helper_id) === String(userId)) {
    return 'helper';
  }
  if (conv.business_id) return 'helper';
  return 'customer';
}

export function conversationMatchesSide(userId, conv, side) {
  if (!side || side === 'all') return true;
  return conversationSide(userId, conv) === side;
}

export function hasHelperInboxWork(userId, conversations = [], isHelper = false) {
  if (isHelper) return true;
  return conversations.some((conv) => conversationSide(userId, conv) === 'helper');
}
