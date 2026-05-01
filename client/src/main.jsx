import './instrument.jsx';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

function sentryRootFallback({ error, resetError }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col items-center justify-center px-6 py-16">
      <p className="text-lg font-semibold text-white mb-2">Something went wrong</p>
      <p className="text-sm text-gray-500 text-center max-w-md mb-6">
        {error instanceof Error ? error.message : 'An unexpected error occurred.'}
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          type="button"
          onClick={resetError}
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = '/';
          }}
          className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium border border-gray-700"
        >
          Go home
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={sentryRootFallback}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration is non-fatal - app works without it
    });
  });
}
