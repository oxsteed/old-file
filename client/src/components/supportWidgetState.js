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
