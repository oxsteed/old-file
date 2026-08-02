export function resolveRealtimeBaseUrl() {
  const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '');
  if (apiUrl) return apiUrl;

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5000';
    }
    return origin;
  }

  return 'http://localhost:5000';
}

export function realtimeNamespaceUrl(namespace) {
  const normalized = String(namespace || '').replace(/^\/+|\/+$/g, '');
  return normalized ? `${resolveRealtimeBaseUrl()}/${normalized}` : resolveRealtimeBaseUrl();
}
