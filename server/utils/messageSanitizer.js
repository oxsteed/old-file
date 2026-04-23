/**
 * Message Sanitizer
 * Prevents XSS attacks by escaping dangerous HTML and allowing safe formatting
 */

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize message content to prevent XSS
 * - Escapes all HTML entities
 * - Preserves newlines for readability
 * - Does NOT render markdown (safety first)
 * @param {string} rawText - Raw message text from user
 * @returns {string} - Safe text ready for display
 */
function sanitizeMessage(rawText) {
  if (!rawText) return '';

  // 1. Escape all HTML to prevent injection
  const escaped = escapeHtml(rawText);

  // 2. Preserve URLs as clickable (safely escaped already)
  // URLs are already escaped above, so they're safe to identify
  // For now, keep them as-is; client can linkify if needed

  // 3. Return the escaped, safe text
  return escaped;
}

/**
 * Sanitize HTML strings more aggressively (for rare cases)
 * Removes ALL HTML tags
 * @param {string} htmlString - String potentially containing HTML
 * @returns {string} - Plain text
 */
function stripHtml(htmlString) {
  if (!htmlString) return '';
  return String(htmlString)
    .replace(/<[^>]*>/g, '') // Remove all tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

module.exports = {
  escapeHtml,
  sanitizeMessage,
  stripHtml,
};
