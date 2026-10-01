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

// H8c: scrub sensitive query params (auth/impersonation/reset tokens) from
// every URL Sentry captures. Tokens in ?token= / ?code= must never leave the
// browser inside an error report.
const SENSITIVE_QUERY_PARAMS = new Set([
  'token', 'access_token', 'accesstoken', 'refresh_token', 'refreshtoken',
  'code', 'otp', 'password', 'reset_token', 'mfa_token', 'mfatoken',
  'exchange_code', 'guest_token', 'guesttoken',
]);

function scrubUrl(raw) {
  if (typeof raw !== 'string' || !raw) return raw;
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://oxsteed.com';
    const url = new URL(raw, base);
    let changed = false;
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[REDACTED]');
        changed = true;
      }
    }
    return changed ? url.toString() : raw;
  } catch {
    return raw;
  }
}

function scrubEvent(event) {
  try {
    if (event?.request?.url) event.request.url = scrubUrl(event.request.url);
    for (const breadcrumb of event?.breadcrumbs?.values || []) {
      if (breadcrumb?.data?.url) breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
      if (typeof breadcrumb?.message === 'string' && breadcrumb.message.includes('?')) {
        breadcrumb.message = scrubUrl(breadcrumb.message);
      }
    }
    for (const value of event?.exception?.values || []) {
      if (typeof value?.value === 'string' && value.value.includes('?')) {
        value.value = scrubUrl(value.value);
      }
    }
  } catch {
    // Scrubbing must never break error reporting.
  }
  return event;
}

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

    // H8c: redact tokens from captured URLs (impersonation ?token=, reset
    // links, OTP codes) before they leave the browser.
    beforeSend: scrubEvent,

    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}
