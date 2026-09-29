import '../instrument.jsx';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import AdminProviders from './AdminProviders';
import AdminApp from './AdminApp';
import i18next, { i18nReady } from '../i18n';
import '../index.css';
import {
  clearBootstrapRecoveryMarker,
  recoverFromBootstrapFailure,
  registerServiceWorker,
} from '../utils/serviceWorkerRegistration';

function sentryAdminFallback({ error, resetError }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col items-center justify-center px-6 py-16">
      <p className="text-lg font-semibold text-white mb-2">{i18next.t('errorBoundary.title', 'Admin - something went wrong')}</p>
      <p className="text-sm text-gray-500 text-center max-w-md mb-6">
        {error instanceof Error ? error.message : i18next.t('errorBoundary.message', 'An unexpected error occurred.')}
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          type="button"
          onClick={resetError}
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium"
        >
          {i18next.t('errorBoundary.tryAgain', 'Try again')}
        </button>
      </div>
    </div>
  );
}

function renderAdmin() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Sentry.ErrorBoundary fallback={sentryAdminFallback}>
        <AdminProviders>
          <AdminApp />
        </AdminProviders>
      </Sentry.ErrorBoundary>
    </React.StrictMode>
  );
}

function renderAdminBootstrapFailure() {
  document.getElementById('root').innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:2rem;background:#030712;color:#e5e7eb;font-family:system-ui,sans-serif;text-align:center">
      <section style="max-width:30rem">
        <h1 style="font-size:1.25rem;margin:0 0 .75rem">OxSteed Admin is refreshing</h1>
        <p style="color:#9ca3af;margin:0 0 1.25rem">The admin language resources could not be loaded. Please try again.</p>
        <button type="button" onclick="window.location.reload()" style="border:0;border-radius:.5rem;background:#f97316;color:white;padding:.65rem 1rem;font-weight:600;cursor:pointer">Try again</button>
      </section>
    </main>`;
}

registerServiceWorker();

// Never mount an admin shell with an uninitialized i18next instance. That
// turns a recoverable asset/cache failure into a page full of raw keys.
i18nReady.then(() => {
  clearBootstrapRecoveryMarker();
  renderAdmin();
}).catch(async () => {
  if (await recoverFromBootstrapFailure()) {
    window.location.reload();
    return;
  }
  renderAdminBootstrapFailure();
});
