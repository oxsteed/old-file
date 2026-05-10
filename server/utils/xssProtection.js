// XSS Protection Utility
// Sanitizes user input to prevent XSS attacks while preserving safe HTML formatting

const logger = require('./logger');

/**
 * HTML escape for plain text contexts (no formatting allowed)
 */
function htmlEscape(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize plain text fields (no HTML allowed)
 * Used for: names, emails, titles, descriptions without formatting
 */
function sanitizePlainText(str, maxLength = 500) {
  if (typeof str !== 'string') return '';

  // Remove all HTML tags
  let clean = str.replace(/<[^>]*>/g, '');

  // Remove control characters
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim and limit length
  clean = clean.trim().substring(0, maxLength);

  return clean;
}

/**
 * Sanitize rich text fields (basic HTML allowed)
 * Allows: <b>, <i>, <u>, <p>, <br>, <ul>, <ol>, <li>
 * Blocks: <script>, <iframe>, event handlers, javascript: URLs
 */
function sanitizeRichText(html) {
  if (typeof html !== 'string') return '';

  // Remove script tags and content
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove iframe tags
  clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  // Remove event handlers (onclick, onerror, onload, etc.)
  clean = clean.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  clean = clean.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: URLs
  clean = clean.replace(/javascript:/gi, '');
  clean = clean.replace(/data:text\/html/gi, '');
  clean = clean.replace(/vbscript:/gi, '');

  // Remove potentially dangerous attributes
  clean = clean.replace(/\s*(action|formaction|href|poster|src)\s*=\s*["']?(?!https?:\/\/)[^"\s>]*/gi, (match) => {
    if (match.toLowerCase().includes('http')) return match; // Allow safe URLs
    return ''; // Remove unsafe URLs
  });

  return clean;
}

/**
 * Validate and sanitize file names (prevent directory traversal and XSS)
 */
function sanitizeFileName(filename) {
  if (typeof filename !== 'string') return 'file';

  // Remove path traversal attempts
  let clean = filename.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');

  // Remove special characters except dots and hyphens
  clean = clean.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Limit length
  clean = clean.substring(0, 255);

  return clean || 'file';
}

/**
 * Sanitize URLs (prevent javascript: and data: attacks)
 */
function sanitizeURL(url) {
  if (typeof url !== 'string') return '';

  const trimmed = url.trim().toLowerCase();

  // Block dangerous protocols
  if (trimmed.startsWith('javascript:') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('vbscript:')) {
    return '';
  }

  // Allow http/https URLs
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return url;
  }

  // Allow relative URLs
  if (trimmed.startsWith('/')) {
    return url;
  }

  return '';
}

module.exports = {
  htmlEscape,
  sanitizePlainText,
  sanitizeRichText,
  sanitizeFileName,
  sanitizeURL
};
