import '../instrument.jsx';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import AdminProviders from './AdminProviders';
import AdminApp from './AdminApp';
import i18next, { i18nReady } from '../i18n';
import '../index.css';

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

// Keep admin startup consistent with the public app: every component sees an
// initialized i18next instance before its first render. If resource loading
// fails, still mount the app so the error boundary can provide recovery UI.
i18nReady.then(renderAdmin).catch(renderAdmin);
