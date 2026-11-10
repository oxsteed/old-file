"use strict";

/**
 * Sentry event scrubber (utils/telemetryPrivacy.js).
 *
 * Security review 2026-11-10 F-05: Sentry is a third-party processor, so
 * events must carry no credentials, capability tokens or personal data:
 *   - request bodies, cookies and query strings are never sent;
 *   - only an allow-list of request headers survives;
 *   - capability tokens in URL paths (invoice, tracking, unsubscribe, offer
 *     links...) are replaced with ':redacted' in the request URL, the
 *     transaction name, breadcrumbs and span data;
 *   - keys that name secrets, PINs, OTPs or financial identifiers are
 *     redacted anywhere in the event;
 *   - emails, phone numbers and card-length digit runs are masked in every
 *     string (messages, exception values, breadcrumbs, extra).
 */

const { redactUrlForTelemetry, redactPath } = require("./sensitiveUrl");
const { redactPiiInString, isFinancialKey } = require("./piiRedaction");

const PRIVATE_KEYS = new Set([
  "query_norm", "props", "totp", "stepupcode", "password", "currentpassword", "newpassword",
  "password_hash", "token", "accesstoken", "refreshtoken", "mfatoken", "otp", "otp_code",
  "code", "pin", "currentpin", "newpin", "staffpin", "secret", "authorization", "cookie",
  "cookies", "set-cookie", "x-csrf-token", "api_key", "apikey", "backup_codes", "totp_code",
  "totpcode", "activationcode", "credential", "assertion", "client_secret",
]);
const SENSITIVE_KEY_FRAGMENTS = ["password", "secret", "token", "apikey", "api_key", "private_key"];
const SAFE_HEADERS = new Set([
  "user-agent", "content-type", "content-length", "accept", "accept-language", "host",
  "x-correlation-id", "x-request-id", "sentry-trace", "baggage",
]);
const URL_KEYS = new Set(["url", "http.url", "url.full", "http.target", "url.path", "http.route", "to", "from"]);

function isPrivateKey(key) {
  const lower = String(key).toLowerCase();
  return PRIVATE_KEYS.has(lower) || isFinancialKey(lower) || SENSITIVE_KEY_FRAGMENTS.some((f) => lower.includes(f));
}

function scrubString(key, value) {
  if (URL_KEYS.has(String(key).toLowerCase())) return redactUrlForTelemetry(value);
  return redactPiiInString(value);
}

function deepScrub(value) {
  const seen = new WeakSet();
  function scrub(item, key, depth) {
    if (typeof item === "string") return scrubString(key, item);
    if (!item || typeof item !== "object") return item;
    if (depth > 12 || seen.has(item)) return "[REDACTED]";
    seen.add(item);
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map((entry) => scrub(entry, key, depth + 1));
    const result = Object.create(null);
    for (const [k, v] of Object.entries(item)) {
      result[k] = isPrivateKey(k) ? "[REDACTED]" : scrub(v, k, depth + 1);
    }
    return result;
  }
  return scrub(value, "", 0);
}

function scrubRequest(request) {
  if (!request || typeof request !== "object") return request;
  const out = { ...request };
  if ("data" in out) out.data = "[REDACTED]";
  delete out.cookies;
  delete out.query_string;
  if (out.url) out.url = redactUrlForTelemetry(out.url);
  if (out.headers && typeof out.headers === "object") {
    const headers = {};
    for (const [name, v] of Object.entries(out.headers)) {
      if (SAFE_HEADERS.has(name.toLowerCase())) headers[name] = v;
    }
    out.headers = headers;
  }
  if (out.env) delete out.env;
  return out;
}

function scrubTelemetryEvent(event) {
  if (!event || typeof event !== "object") return event;
  const result = deepScrub(event);
  if (result.request) result.request = scrubRequest(result.request);
  if (typeof result.transaction === "string") {
    const [method, ...rest] = result.transaction.split(" ");
    result.transaction = rest.length ? `${method} ${redactPath(rest.join(" "))}` : redactPath(method);
  }
  if (Array.isArray(result.spans)) {
    result.spans = result.spans.map((span) => (typeof span?.description === "string"
      ? { ...span, description: span.description.replace(/(\s)(\/\S*)/, (_m, sp, p) => `${sp}${redactPath(p)}`) }
      : span));
  }
  if (result.user && typeof result.user === "object") {
    // Keep the opaque id for grouping; never the email, name or IP.
    result.user = result.user.id != null ? { id: result.user.id } : {};
  }
  return result;
}

function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== "object") return breadcrumb;
  return deepScrub(breadcrumb);
}

// Backwards-compatible name used by existing callers and tests.
const scrubGrowthTelemetry = scrubTelemetryEvent;

module.exports = { scrubTelemetryEvent, scrubGrowthTelemetry, scrubBreadcrumb, scrubRequest };
