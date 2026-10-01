// server/middleware/verifyCaptcha.js
//
// Bot-mitigation hook point (audit L1). The /auth/check-email enumeration
// oracle was closed by making responses uniform; this middleware is the
// integration point for a CAPTCHA/attestation provider when Emile wants one.
//
// Disabled by default: set CAPTCHA_ENABLED=true plus CAPTCHA_PROVIDER and
// CAPTCHA_SECRET to enforce. Until then it is a passthrough and changes
// nothing.
//
// Follow-up decision for Emile: pick a provider (Cloudflare Turnstile,
// hCaptcha, or reCAPTCHA v3), add the client widget that produces the token,
// and set the secrets in the deployment secret store. Wire this middleware in
// front of abuse-sensitive routes (check-email, register/start, login,
// password reset) once enabled.

const logger = require('../utils/logger');

const ENABLED = String(process.env.CAPTCHA_ENABLED || '').toLowerCase() === 'true';
const PROVIDER = String(process.env.CAPTCHA_PROVIDER || 'turnstile').toLowerCase();
const SECRET = process.env.CAPTCHA_SECRET || '';

const VERIFY_URLS = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
};

async function verifyWithProvider(token, remoteIp) {
  const url = VERIFY_URLS[PROVIDER];
  if (!url) throw new Error(`Unknown CAPTCHA provider: ${PROVIDER}`);
  const params = new URLSearchParams({ secret: SECRET, response: token });
  if (remoteIp) params.set('remoteip', remoteIp);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  return Boolean(data.success);
}

// Express middleware. Off by default (passthrough). When enabled, expects
// the client token in `captchaToken` (body), `x-captcha-token` (header), or
// `captcha_token` (body, snake_case).
async function verifyCaptcha(req, res, next) {
  try {
    if (!ENABLED) return next();
    if (!SECRET) {
      logger.error('[captcha] CAPTCHA_ENABLED=true but CAPTCHA_SECRET is unset');
      return res.status(503).json({ error: 'Verification unavailable' });
    }
    const token =
      req.body?.captchaToken || req.body?.captcha_token || req.headers?.['x-captcha-token'];
    if (!token) {
      return res.status(400).json({ error: 'captcha_required', message: 'CAPTCHA verification required' });
    }
    const ok = await verifyWithProvider(String(token), req.ip);
    if (!ok) {
      return res.status(403).json({ error: 'captcha_failed', message: 'CAPTCHA verification failed' });
    }
    return next();
  } catch (err) {
    logger.error('[captcha] verification error', { err: err.message });
    return res.status(503).json({ error: 'Verification unavailable' });
  }
}

function isCaptchaEnabled() {
  return ENABLED;
}

module.exports = { verifyCaptcha, isCaptchaEnabled };
