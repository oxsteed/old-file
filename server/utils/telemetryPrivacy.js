"use strict";
const PRIVATE_KEYS = new Set(["query_norm", "props", "totp", "stepupcode"]);
function scrubGrowthTelemetry(event) {
  const seen = new WeakSet();
  function scrub(value, depth = 0) {
    if (!value || typeof value !== "object") return value;
    if (depth > 12 || seen.has(value)) return "[REDACTED]";
    seen.add(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value))
      return value.map((item) => scrub(item, depth + 1));
    const result = Object.create(null);
    for (const [key, item] of Object.entries(value))
      result[key] = PRIVATE_KEYS.has(key.toLowerCase())
        ? "[REDACTED]"
        : scrub(item, depth + 1);
    return result;
  }
  const result = scrub(event);
  if (
    result?.request &&
    /\/api\/(?:activity|consent\/tracking)(?:\/|\?|$)/.test(
      String(result.request.url || ""),
    )
  )
    result.request.data = "[REDACTED]";
  return result;
}
module.exports = { scrubGrowthTelemetry };
