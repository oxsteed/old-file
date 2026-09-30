import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useCookieConsentContext } from '../context/CookieConsentContext';

// In-house visitor analytics beacon. Sends one fire-and-forget pageview per
// client-side navigation to POST /api/analytics/pageview. Uses a keepalive
// fetch (not sendBeacon) so the signed-in user's Bearer token can be attached
// for attribution; anonymous visitors are recorded without a user.
//
// Privacy: only fires after the visitor grants the `analytics` cookie-consent
// category, and the server additionally skips `DNT: 1` visitors, stores only a
// salted IP hash (never the raw IP), and prunes rows after the retention
// window. Failures are swallowed: analytics must never break the page.
export default function PageviewBeacon() {
  const location = useLocation();
  const { hasConsent } = useCookieConsentContext();
  const lastSent = useRef('');

  useEffect(() => {
    if (!hasConsent('analytics')) return;
    const path = location.pathname;
    if (lastSent.current === path) return;
    lastSent.current = path;
    try {
      const token = localStorage.getItem('accessToken');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      fetch('/api/analytics/pageview', {
        method: 'POST',
        headers,
        body: JSON.stringify({ path, referrer: document.referrer || '' }),
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => {});
    } catch {
      // Never break the page for analytics.
    }
  }, [location.pathname, hasConsent]);

  return null;
}
