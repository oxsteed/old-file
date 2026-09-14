/**
 * Sentry must load before React / App (see sentry-for-ai sentry-react-sdk skill).
 * Imported as the first line in main.jsx and admin/main.jsx.
 */
import * as Sentry from '@sentry/react';
import React from 'react';
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (!dsn) {
  // No-op when DSN unset (local dev without Sentry)
} else {
  const apiBase = import.meta.env.VITE_API_URL || '';
  const tracePropagationTargets = ['localhost', '127.0.0.1'];
  if (apiBase.startsWith('http')) {
    tracePropagationTargets.push(apiBase);
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || import.meta.env.VITE_APP_VERSION || undefined,

    // Skill default is true; keep false unless explicitly enabled (privacy)
    sendDefaultPii: import.meta.env.VITE_SENTRY_SEND_DEFAULT_PII === 'true',

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    tracePropagationTargets,

    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
