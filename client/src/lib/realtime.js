export function resolveRealtimeBaseUrl() {
  const apiUrl = import.meta.env?.VITE_API_URL?.replace(/\/api\/?$/, '');
  if (apiUrl) return apiUrl;

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // A production-style static build serves API and Socket.IO from the same
      // origin. Development can still point at a separate API through
      // VITE_API_URL or VITE_DEV_API_PROXY_TARGET.
      return origin;
    }
    return origin;
  }

  return 'http://localhost:5000';
}

export function realtimeNamespaceUrl(namespace) {
  const normalized = String(namespace || '').replace(/^\/+|\/+$/g, '');
  return normalized ? `${resolveRealtimeBaseUrl()}/${normalized}` : resolveRealtimeBaseUrl();
}
// PWA silent updates (D-445): live-data socket events. Mirror of
// server/realtime/socketEvents.js; keep the two in sync. Payloads are
// nudges only — the client re-fetches authoritative state on receipt.
export const CREDIT_BALANCE_EVENT = 'credit:balance';
export const BID_CREATED_EVENT = 'bid:created';
export const BID_UPDATED_EVENT = 'bid:updated';
export const BID_WITHDRAWN_EVENT = 'bid:withdrawn';
export const SOCKET_EVENTS = [
  CREDIT_BALANCE_EVENT,
  BID_CREATED_EVENT,
  BID_UPDATED_EVENT,
  BID_WITHDRAWN_EVENT,
];
