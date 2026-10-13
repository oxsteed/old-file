// Review P3-912: only render http(s) links from stored, user-supplied URLs.
// Anything else (javascript:, data:, protocol-relative, malformed) is dropped.
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
