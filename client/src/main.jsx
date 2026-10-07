import './instrument.jsx';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import i18next from 'i18next';
import App from './App';
import './index.css';
import { initMobileBridge } from './utils/mobileBridge';
import { i18nReady } from './i18n';
import { installGlobalChunkReload } from './utils/lazyWithRetry';
import {
  clearBootstrapRecoveryMarker,
  recoverFromBootstrapFailure,
  registerServiceWorker,
} from './utils/serviceWorkerRegistration';
import { initPwaInstall } from './utils/pwaInstall';

/**
 * warmServiceWorkerAssets — on idle, hand the service worker this page's
 * asset URLs so it caches them proactively. Money-route navigations
 * (checkout, wallet, post-job) then skip the network for their chunks.
 * Best-effort; never blocks boot.
 */
function warmServiceWorkerAssets() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const warm = () => {
    try {
      const urls = new Set();
      document.querySelectorAll('script[src]').forEach((s) => urls.add(s.src));
      document.querySelectorAll('link[rel="stylesheet"][href]').forEach((l) => urls.add(l.href));
      document.querySelectorAll('link[rel="preload"][href],link[rel="prefetch"][href]').forEach((l) => urls.add(l.href));
      if (!urls.size) return;
      navigator.serviceWorker.ready.then((reg) => {
        const sw = reg.active;
        if (sw) sw.postMessage({ type: 'precache', urls: [...urls] });
      }).catch(() => { /* worker not ready; skip */ });
    } catch { /* warming is a progressive enhancement */ }
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warm, { timeout: 8000 });
  } else {
    window.setTimeout(warm, 4000);
  }
}

function sentryRootFallback({ error, resetError }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col items-center justify-center px-6 py-16">
      <p className="text-lg font-semibold text-white mb-2">{i18next.t('errorBoundary.title')}</p>
      <p className="text-sm text-gray-500 text-center max-w-md mb-6">
        {error instanceof Error ? error.message : i18next.t('errorBoundary.message')}
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          type="button"
          onClick={resetError}
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium"
        >
          {i18next.t('errorBoundary.tryAgain')}
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = '/';
          }}
          className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium border border-gray-700"
        >
          {i18next.t('errorBoundary.goHome')}
        </button>
      </div>
    </div>
  );
}

function renderBootstrapFailure() {
  document.getElementById('root').innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:2rem;background:#030712;color:#e5e7eb;font-family:system-ui,sans-serif;text-align:center">
      <section style="max-width:30rem">
        <h1 style="font-size:1.25rem;margin:0 0 .75rem">OxSteed is refreshing</h1>
        <p style="color:#9ca3af;margin:0 0 1.25rem">A new version is being loaded. Please try again.</p>
        <button type="button" onclick="window.location.reload()" style="border:0;border-radius:.5rem;background:#f97316;color:white;padding:.65rem 1rem;font-weight:600;cursor:pointer">Try again</button>
      </section>
    </main>`;
}

registerServiceWorker();
initPwaInstall();
installGlobalChunkReload();
warmServiceWorkerAssets();
i18nReady.then(() => {
  clearBootstrapRecoveryMarker();
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Sentry.ErrorBoundary fallback={sentryRootFallback}>
        <App />
      </Sentry.ErrorBoundary>
    </React.StrictMode>
  );
}).catch(async () => {
  if (await recoverFromBootstrapFailure()) {
    window.location.reload();
    return;
  }
  renderBootstrapFailure();
});

initMobileBridge();
