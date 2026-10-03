/**
 * Message Sanitizer
 * Prevents XSS attacks by escaping dangerous HTML and allowing safe formatting.
 * Also deters off-platform contact sharing (Guideline: warn + mask, never block).
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

// ── Off-platform contact deterrence ──────────────────────────────────────────
// Warn + mask, NOT a hard block. Phone numbers are masked in the stored
// content (digits replaced with middle dots so the reader sees a number was
// here). Emails and URLs stay visible but are flagged so the client can warn.

const PHONE_CANDIDATE_RE = /(?<![\w+])\+?\d[\d\s().-]{5,}\d(?![\w])/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Middle dot used to mask phone digits in stored content. */
const MASK_CHAR = '·';

function findSpans(text, re) {
  const spans = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  while ((m = rx.exec(text)) !== null) {
    spans.push([m.index, m.index + m[0].length]);
    // Guard against zero-length matches looping forever.
    if (m[0].length === 0) rx.lastIndex += 1;
  }
  return spans;
}

function spansOverlap(spans, start, end) {
  return spans.some(([s, e]) => start < e && end > s);
}

/**
 * A candidate only counts as a phone number when it carries a phone-like
 * digit run: 7-15 digits (E.164 max). This keeps short numeric strings
 * ("Call 911", zip "90210", street addresses like "123 Main St") untouched.
 */
function isPhoneLike(candidate) {
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  // Guard common non-phone digit runs: ISO-ish dates (2026-10-03).
  if (/^\d{4}[-.]\d{1,2}[-.]\d{1,2}$/.test(candidate.trim())) return false;
  return true;
}

/**
 * Mask phone numbers in text: every digit becomes a middle dot, separators
 * (+, spaces, dashes, dots, parens) are kept so it still reads as a number.
 * Emails and URLs are never touched (they stay visible; only flagged).
 */
function maskPhoneNumbers(text) {
  if (!text) return '';
  const input = String(text);
  const protectedSpans = [
    ...findSpans(input, EMAIL_RE),
    ...findSpans(input, URL_RE),
  ];
  return input.replace(PHONE_CANDIDATE_RE, (match, offset) => {
    if (spansOverlap(protectedSpans, offset, offset + match.length)) return match;
    if (!isPhoneLike(match)) return match;
    return match.replace(/\d/g, MASK_CHAR);
  });
}

/**
 * Detect off-platform contact details in raw (unescaped) message text.
 * @param {string} rawText
 * @returns {{phone: boolean, email: boolean, url: boolean}}
 */
function detectOffPlatformContact(rawText) {
  const input = rawText ? String(rawText) : '';
  const email = new RegExp(EMAIL_RE.source).test(input);
  const url = new RegExp(URL_RE.source, 'i').test(input);
  let phone = false;
  if (input) {
    const protectedSpans = [
      ...findSpans(input, EMAIL_RE),
      ...findSpans(input, URL_RE),
    ];
    const rx = new RegExp(PHONE_CANDIDATE_RE.source, 'g');
    let m;
    while ((m = rx.exec(input)) !== null) {
      if (!spansOverlap(protectedSpans, m.index, m.index + m[0].length) && isPhoneLike(m[0])) {
        phone = true;
        break;
      }
    }
  }
  return { phone, email, url };
}

/**
 * Sanitize message content to prevent XSS
 * - Escapes all HTML entities
 * - Masks phone numbers in the stored content (off-platform deterrence)
 * - Preserves newlines for readability
 * - Does NOT render markdown (safety first)
 * @param {string} rawText - Raw message text from user
 * @returns {string} - Safe text ready for display/storage
 */
function sanitizeMessage(rawText) {
  if (!rawText) return '';

  // 1. Escape all HTML to prevent injection
  const escaped = escapeHtml(rawText);

  // 2. Mask phone numbers (digits -> middle dots); emails/URLs stay visible
  //    and are only flagged via detectOffPlatformContact at the call site.
  const masked = maskPhoneNumbers(escaped);

  // 3. URLs are already escaped above, so they're safe to identify
  //    For now, keep them as-is; client can linkify if needed

  return masked;
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
  detectOffPlatformContact,
  maskPhoneNumbers,
};
