// Pure helpers for the AI support widget (SupportWidget.jsx). Kept free of
// React and browser globals so they can be unit-tested with node --test.

// Keep in sync with MAX_IMAGE_BYTES in server/constants/supportChatLimits.js.
export const SUPPORT_CHAT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * i18n key for a failed /chat/message send. A 413 means the body (usually the
 * attached image) was too large, which is actionable, so it gets its own copy.
 */
export function sendErrorMessageKey(err) {
  const status = err?.response?.status;
  if (status === 413) return 'supportWidget.requestTooLarge';
  return 'supportWidget.errorMessage';
}

/**
 * Retry plan for a failed send. The failed user message is still in the
 * list (followed by the error bubble), so a retry drops only the error and
 * re-sends that same message, image included, instead of appending a copy.
 * Returns null when the last message is not a retryable error.
 */
export function prepareRetry(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return null;
  const last = messages[messages.length - 1];
  if (!last?.isError) return null;
  const base = messages.slice(0, -1);
  const failedUser = base[base.length - 1];
  if (!failedUser || failedUser.role !== 'user') return null;
  return { base, failedUser };
}

/**
 * Ticket number for display inside translated copy. First-strong isolates
 * keep "#1234" intact inside Arabic (RTL) sentences.
 */
export function formatTicketNumberForCopy(ticketNumber) {
  if (ticketNumber === undefined || ticketNumber === null || ticketNumber === '') return '';
  return `\u2068#${String(ticketNumber)}\u2069`;
}

/**
 * True when the key event's target (or, failing that, the focused element)
 * is inside the widget panel.
 */
export function isFocusInside(panel, target, activeElement = globalThis.document?.activeElement) {
  if (!panel || typeof panel.contains !== 'function') return false;
  const node = target && target !== globalThis.document?.body ? target : activeElement;
  return Boolean(node) && panel.contains(node);
}
