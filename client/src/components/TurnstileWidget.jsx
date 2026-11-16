import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Cloudflare Turnstile widget for routes behind the server's verifyCaptcha
// middleware. Renders only when given a site key; the parent decides that
// from the server's public captcha config. Tokens are single-use: the parent
// calls ref.reset() after every request that consumed one.

export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise = null;

export function loadTurnstile(doc = globalThis.document, win = globalThis.window) {
  if (win?.turnstile) return Promise.resolve(win.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (!doc?.createElement) {
      reject(new Error('turnstile_unavailable'));
      return;
    }
    const script = doc.createElement('script');
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (win?.turnstile ? resolve(win.turnstile) : reject(new Error('turnstile_unavailable')));
    script.onerror = () => reject(new Error('turnstile_unavailable'));
    doc.head.appendChild(script);
  }).catch((error) => {
    // Allow a later mount to retry a failed load.
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

const TurnstileWidget = forwardRef(function TurnstileWidget({
  siteKey,
  onToken,
  onExpire,
  onError,
  language,
  theme = 'auto',
  className = '',
}, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbacks = useRef({ onToken, onExpire, onError });
  callbacks.current = { onToken, onExpire, onError };

  useImperativeHandle(ref, () => ({
    reset() {
      const api = globalThis.window?.turnstile;
      if (api && widgetIdRef.current !== null) api.reset(widgetIdRef.current);
    },
  }), []);

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          language: language || 'auto',
          callback: (token) => callbacks.current.onToken?.(token),
          'expired-callback': () => callbacks.current.onExpire?.(),
          'timeout-callback': () => callbacks.current.onExpire?.(),
          'error-callback': () => { callbacks.current.onError?.(); return true; },
        });
      })
      .catch(() => { if (!cancelled) callbacks.current.onError?.(); });
    return () => {
      cancelled = true;
      const api = globalThis.window?.turnstile;
      if (api && widgetIdRef.current !== null) api.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [siteKey, theme, language]);

  if (!siteKey) return null;
  return <div ref={containerRef} className={`turnstile-widget ${className}`.trim()} data-testid="turnstile-widget" />;
});

export default TurnstileWidget;
