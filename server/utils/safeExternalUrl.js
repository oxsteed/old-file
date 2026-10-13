'use strict';

// Review P3-912: user-supplied links are stored and rendered only when they
// are plain https URLs without embedded credentials. Anything else
// (javascript:, data:, http:, protocol-relative, malformed) is rejected.
function normalizeSafeHttpsUrl(value, { maxLength = 2048 } = {}) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
  return parsed.toString();
}

module.exports = { normalizeSafeHttpsUrl };
