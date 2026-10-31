'use strict';

const crypto = require('crypto');

/**
 * Per-response CSP nonce (CSP nonce-source, base64-value). Used for
 * server-rendered documents that carry their own <style> block, starting
 * with the gift-card print page: the nonce is generated per response,
 * stamped on the <style> tag, and listed in that response's CSP header.
 * It is intentionally NOT wired into the global helmet policy yet: the
 * SPA still renders thousands of inline style attributes, and a nonce
 * alongside 'unsafe-inline' would be ignored by browsers, so global
 * nonce plumbing waits until the style={} conversion reaches zero.
 */
function createCspNonce() {
  return crypto.randomBytes(16).toString('base64');
}

module.exports = { createCspNonce };
