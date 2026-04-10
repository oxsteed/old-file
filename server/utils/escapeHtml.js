/**
 * Escape HTML special characters to prevent XSS when interpolating
 * untrusted strings into HTML templates (emails, server-rendered pages, etc.).
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

module.exports = escapeHtml;
