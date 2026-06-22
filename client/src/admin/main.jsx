import '../instrument.jsx';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { ThemeProvider } from '../context/ThemeContext';
import AdminApp from './AdminApp';
import '../i18n'; // Initialize i18next before any component renders
import '../index.css';

function sentryAdminFallback({ error, resetError }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-200 flex flex-col items-center justify-center px-6 py-16">
      <p className="text-lg font-semibold text-white mb-2">Admin - something went wrong</p>
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
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={sentryAdminFallback}>
      <HelmetProvider>
        <LanguageProvider>
          <ThemeProvider>
            <AuthProvider>
              <AdminApp />
            </AuthProvider>
          </ThemeProvider>
        </LanguageProvider>
      </HelmetProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
