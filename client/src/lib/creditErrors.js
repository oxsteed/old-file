const UNSAFE_ERROR_PATTERN = /(?:request failed|status code \d{3}|econn|etimedout|enotfound|postgres|database|sql|stack trace|syntax error|cannot read)/i;

export function safeCreditErrorMessage(error, fallback) {
  const serverMessage = error?.response?.data?.error?.message
    || error?.response?.data?.message
    || '';
  const message = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  if (!message || UNSAFE_ERROR_PATTERN.test(message) || message.length > 240) return fallback;
  return message;
}
