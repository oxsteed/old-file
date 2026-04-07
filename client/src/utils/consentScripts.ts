/**
 * consentScripts.ts
 *
 * Centralized consent-gated script loader.
 * Scripts are injected into the DOM only after the user has explicitly
 * consented to the corresponding category.
 *
 * Usage:
 *   import { initAnalytics, initMarketing, initFunctional } from '../utils/consentScripts';
 *   initAnalytics();   // safe to call any time — no-ops if already loaded
 */

type ScriptEntry = { id: string; src: string; async?: boolean; defer?: boolean };

function injectScript({ id, src, async = true, defer = false }: ScriptEntry): void {
  if (document.getElementById(id)) return; // already loaded
  const s = document.createElement('script');
  s.id      = id;
  s.src     = src;
  s.async   = async;
  s.defer   = defer;
  document.head.appendChild(s);
}

function injectInlineScript(id: string, code: string): void {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id        = id;
  s.textContent = code;
  document.head.appendChild(s);
}

// ─── Analytics ────────────────────────────────────────────────────────────────
// Google Analytics 4 — replace GA_MEASUREMENT_ID with your real ID via env var.
// If the env var is absent the function is a no-op (safe in all environments).
export function initAnalytics(): void {
  const gaId = (import.meta as Record<string, unknown> & { env: Record<string, string> })
    .env?.VITE_GA_MEASUREMENT_ID;
  if (!gaId) return;

  injectScript({
    id:  'ga4-script',
    src: `https://www.googletagmanager.com/gtag/js?id=${gaId}`,
  });

  injectInlineScript('ga4-init', `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${gaId}', { anonymize_ip: true });
  `);
}

export function disableAnalytics(): void {
  const gaId = (import.meta as Record<string, unknown> & { env: Record<string, string> })
    .env?.VITE_GA_MEASUREMENT_ID;
  if (!gaId) return;
  // GA consent mode: tell GA not to store cookies
  if (typeof (window as Window & { gtag?: (...args: unknown[]) => void }).gtag === 'function') {
    (window as Window & { gtag?: (...args: unknown[]) => void }).gtag!(
      'consent', 'update', { analytics_storage: 'denied' }
    );
  }
}

// ─── Marketing ────────────────────────────────────────────────────────────────
// Meta Pixel — replace with VITE_META_PIXEL_ID env var.
export function initMarketing(): void {
  const pixelId = (import.meta as Record<string, unknown> & { env: Record<string, string> })
    .env?.VITE_META_PIXEL_ID;
  if (!pixelId) return;

  injectInlineScript('meta-pixel-init', `
    !function(f,b,e,v,n,t,s){
      if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window,document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '${pixelId}');
    fbq('track', 'PageView');
  `);
}

// ─── Functional ───────────────────────────────────────────────────────────────
// Placeholder for chat widgets, Intercom, Crisp, etc.
export function initFunctional(): void {
  // Example: Crisp chat
  // const crispId = import.meta.env.VITE_CRISP_WEBSITE_ID;
  // if (!crispId) return;
  // injectInlineScript('crisp-init', `
  //   window.$crisp=[];window.CRISP_WEBSITE_ID="${crispId}";
  //   (function(){var d=document;var s=d.createElement("script");
  //    s.src="https://client.crisp.chat/l.js";s.async=1;d.head.appendChild(s);})();
  // `);
}

// ─── Boot: called once on app start with persisted preferences ────────────────
export function bootConsentedScripts(prefs: {
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
}): void {
  if (prefs.analytics)  initAnalytics();
  else                  disableAnalytics();
  if (prefs.marketing)  initMarketing();
  if (prefs.functional) initFunctional();
}
