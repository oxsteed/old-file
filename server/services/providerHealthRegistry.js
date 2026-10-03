'use strict';

/**
 * V2-P1-07 — uniform provider-health contract.
 *
 * Every external provider OxSteed depends on is registered here with one
 * shape:
 *
 *   - capabilities: what the provider does for us, each with its own
 *     failure mode (fail_closed / fail_open / degraded / queued_retry) and
 *     the customer-safe unavailable copy shown when it is down.
 *   - owner: the accountable role (rotations live in the ops runbook).
 *   - alertChannel: where incidents route (see incidentAlertService).
 *   - retryPolicy: how callers retry before giving up.
 *   - circuitBreaker: config for the per-provider breaker in
 *     utils/providerCircuitBreaker.js; callers should fail fast once open.
 *   - budget: monthly spend guardrails. `monthlyUsd: null` means spend is
 *     tracked outside this service (noted per provider) — the contract
 *     makes the gap visible rather than inventing a number.
 *   - rotationPolicy: credential rotation cadence and procedure.
 *   - dependencies: env vars / tables this provider needs.
 *   - probe(): cheap, timeout-bounded live check returning
 *     { status, latencyMs, detail }. Statuses:
 *       ok | degraded | down | not_configured | unknown
 *     'unknown' is honest: configured, but no free/cheap live check exists,
 *     so liveness is observed from real traffic via recordProviderOutcome().
 *
 * Call-site adoption: services that call a provider should wrap calls with
 * getCircuitBreaker(id).execute(...) and call recordProviderOutcome(id, ok)
 * on raw success/failure. The operator view (GET /api/provider-health)
 * aggregates registry + live probe + breaker state in one place.
 */

const net = require('net');
const logger = require('../utils/logger');
const { createTtlCache } = require('../utils/processState');
const { createCircuitBreaker } = require('../utils/providerCircuitBreaker');

const PROBE_TIMEOUT_MS = 6000;
const PROBE_CACHE_TTL_MS = 60_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => {
        const err = new Error(`Probe timed out after ${ms}ms: ${label}`);
        err.code = 'probe_timeout';
        reject(err);
      }, ms)
    ),
  ]);
}

function envFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = new net.Socket();
    const done = (ok, detail) => {
      try { socket.destroy(); } catch (_) { /* noop */ }
      resolve({ ok, latencyMs: Date.now() - started, detail });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true, `TCP connect to ${host}:${port} succeeded`));
    socket.once('timeout', () => done(false, `TCP connect to ${host}:${port} timed out`));
    socket.once('error', (err) => done(false, `TCP connect to ${host}:${port} failed: ${err.message}`));
    socket.connect(port, host);
  });
}

async function httpProbe(url, { method = 'GET', headers = {}, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, signal: controller.signal });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// ── Per-provider probes ─────────────────────────────────────────────────────

async function probeStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: 'not_configured', latencyMs: 0, detail: 'STRIPE_SECRET_KEY is not set' };
  }
  const started = Date.now();
  try {
    const Stripe = require('stripe');
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const balance = await withTimeout(stripe.balance.retrieve(), PROBE_TIMEOUT_MS, 'stripe.balance.retrieve');
    return {
      status: 'ok',
      latencyMs: Date.now() - started,
      detail: `Stripe API reachable (balance: ${(balance.available || []).length} available entries)`,
    };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - started, detail: `Stripe API error: ${err.message}` };
  }
}

async function probeMaps() {
  const enabled = envFlag(process.env.AWS_GEO_PLACES_ENABLED) && Boolean(process.env.AWS_REGION);
  if (!enabled) {
    return { status: 'not_configured', latencyMs: 0, detail: 'AWS_GEO_PLACES_ENABLED is not true or AWS_REGION is missing' };
  }
  // AWS Location has no free health ping; constructing the client validates
  // region/credential presence. Live health is observed from real traffic.
  try {
    const { GeoPlacesClient } = require('@aws-sdk/client-geo-places');
    const config = { region: process.env.AWS_REGION, maxAttempts: 2 };
    if (process.env.AWS_LOCATION_ACCESS_KEY_ID && process.env.AWS_LOCATION_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_LOCATION_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_LOCATION_SECRET_ACCESS_KEY,
      };
    }
    // eslint-disable-next-line no-new
    new GeoPlacesClient(config);
    return {
      status: 'unknown',
      latencyMs: 0,
      detail: 'AWS Geo Places SDK configured; no free live ping exists, liveness is observed from real traffic',
    };
  } catch (err) {
    return { status: 'down', latencyMs: 0, detail: `AWS Geo client construction failed: ${err.message}` };
  }
}

async function probeMessaging() {
  const started = Date.now();
  const parts = [];
  let worst = 'ok';

  // Email (SMTP)
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: PROBE_TIMEOUT_MS,
      });
      await withTimeout(transporter.verify(), PROBE_TIMEOUT_MS, 'smtp.verify');
      parts.push('email: SMTP verify ok');
    } catch (err) {
      worst = 'down';
      parts.push(`email: SMTP verify failed (${err.message})`);
    }
  } else {
    worst = worst === 'ok' ? 'degraded' : worst;
    parts.push('email: SMTP not configured');
  }

  // SMS (AWS SNS/Pinpoint)
  const smsEnabled = envFlag(process.env.AWS_SMS_ADMIN_VERIFICATION_ENABLED);
  if (smsEnabled) {
    parts.push('sms: enabled, no free live ping (liveness observed from real traffic)');
    if (worst === 'ok') worst = 'unknown';
  } else {
    parts.push('sms: not enabled');
  }

  // Push (Web Push / VAPID)
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    parts.push('push: VAPID keys configured');
  } else {
    parts.push('push: VAPID keys not configured');
  }
  if (worst === 'ok' && !process.env.VAPID_PUBLIC_KEY) worst = 'degraded';

  return { status: worst, latencyMs: Date.now() - started, detail: parts.join('; ') };
}

async function probeAi() {
  const started = Date.now();
  const parts = [];

  // Primary: Meta Model API — /v1/models is a cheap auth check, no tokens spent.
  if (process.env.META_AI_API_KEY) {
    const base = String(process.env.META_AI_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
    try {
      const res = await httpProbe(`${base}/models`, {
        headers: { Authorization: `Bearer ${process.env.META_AI_API_KEY}` },
      });
      if (res.ok) {
        parts.push(`meta: reachable (${res.latencyMs}ms)`);
      } else {
        parts.push(`meta: HTTP ${res.status}`);
      }
      return { status: res.ok ? 'ok' : 'degraded', latencyMs: Date.now() - started, detail: parts.join('; ') };
    } catch (err) {
      parts.push(`meta: unreachable (${err.message})`);
    }
  } else {
    parts.push('meta: META_AI_API_KEY not set');
  }

  // Fallbacks: OpenRouter (config-only), Ollama (local ping).
  if (process.env.OPENROUTER_API_KEY) {
    parts.push('openrouter: key configured (fallback chain intact)');
  }
  if (process.env.OLLAMA_URL) {
    try {
      const url = new URL(process.env.OLLAMA_URL);
      const res = await httpProbe(`${url.origin}/api/tags`, { timeoutMs: 4000 });
      parts.push(res.ok ? 'ollama: reachable' : `ollama: HTTP ${res.status}`);
      if (res.ok) {
        return { status: 'degraded', latencyMs: Date.now() - started, detail: `${parts.join('; ')} (primary down, local fallback up)` };
      }
    } catch (err) {
      parts.push(`ollama: unreachable (${err.message})`);
    }
  }

  const anyFallback = Boolean(process.env.OPENROUTER_API_KEY || process.env.OLLAMA_URL);
  return {
    status: anyFallback ? 'degraded' : 'down',
    latencyMs: Date.now() - started,
    detail: parts.join('; '),
  };
}

async function probeScanning() {
  const host = String(process.env.CLAMAV_HOST || '').trim();
  if (!host) {
    return {
      status: 'not_configured',
      latencyMs: 0,
      detail: 'CLAMAV_HOST not set; static extension and magic-byte checks remain the baseline',
    };
  }
  const port = Number.parseInt(process.env.CLAMAV_PORT, 10) || 3310;
  const started = Date.now();
  const { ok, latencyMs, detail } = await tcpProbe(host, port, 4000);
  return {
    status: ok ? 'ok' : 'down',
    latencyMs: Date.now() - started,
    detail: ok ? `clamd reachable at ${host}:${port} (${latencyMs}ms)` : detail,
  };
}

async function probeStorage() {
  const started = Date.now();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    try {
      const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
      const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || 'oxsteed-uploads';
      const client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        ...(process.env.AWS_S3_ENDPOINT || process.env.S3_ENDPOINT
          ? { endpoint: process.env.AWS_S3_ENDPOINT || process.env.S3_ENDPOINT } : {}),
        forcePathStyle: envFlag(process.env.S3_FORCE_PATH_STYLE),
        credentials: { accessKeyId, secretAccessKey },
      });
      await withTimeout(client.send(new HeadBucketCommand({ Bucket: bucket })), PROBE_TIMEOUT_MS, 's3.HeadBucket');
      try { client.destroy(); } catch (_) { /* noop */ }
      return { status: 'ok', latencyMs: Date.now() - started, detail: `S3 bucket "${bucket}" reachable` };
    } catch (err) {
      return { status: 'down', latencyMs: Date.now() - started, detail: `S3 HeadBucket failed: ${err.message}` };
    }
  }
  // Local filesystem fallback.
  const path = require('path');
  const fs = require('fs/promises');
  const root = path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'runtime', 'uploads'));
  try {
    await fs.access(root, fs.constants.W_OK);
    return { status: 'ok', latencyMs: Date.now() - started, detail: `Local upload dir writable: ${root}` };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - started, detail: `Local upload dir not writable: ${root} (${err.message})` };
  }
}

async function probeCalendars() {
  const started = Date.now();
  try {
    const db = require('../db');
    const { rows } = await withTimeout(
      db.query(
        `SELECT integration_type, COUNT(*)::int AS connected
           FROM business_integrations
          WHERE integration_type IN ('google_calendar', 'outlook_calendar')
            AND is_enabled = TRUE AND is_connected = TRUE
          GROUP BY integration_type`
      ),
      PROBE_TIMEOUT_MS,
      'calendar integrations count'
    );
    const counts = Object.fromEntries(rows.map((r) => [r.integration_type, r.connected]));
    return {
      status: 'ok',
      latencyMs: Date.now() - started,
      detail: `Calendar sync plane reachable; connected: Google ${counts.google_calendar || 0}, Outlook ${counts.outlook_calendar || 0}`,
    };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - started, detail: `Calendar integration store unreachable: ${err.message}` };
  }
}

async function probeTrackers() {
  const started = Date.now();
  try {
    const db = require('../db');
    await withTimeout(db.query('SELECT 1 FROM delivery_tracking_events LIMIT 1'), PROBE_TIMEOUT_MS, 'tracking events ping');
    return {
      status: 'ok',
      latencyMs: Date.now() - started,
      detail: 'Delivery tracking event store reachable; tracking records are evidence-only and never mutate delivery state',
    };
  } catch (err) {
    return { status: 'down', latencyMs: Date.now() - started, detail: `Tracking event store unreachable: ${err.message}` };
  }
}

// ── Registry ────────────────────────────────────────────────────────────────
// Locale keys live under adminProviderHealth.providers.<id>.* in the client
// catalogs. failureMode vocabulary: fail_closed | fail_open | degraded | queued_retry.

const PROVIDERS = Object.freeze([
  Object.freeze({
    id: 'stripe',
    name: 'Stripe',
    category: 'payments',
    owner: 'Platform payments on-call',
    alertChannel: 'incident email + Slack #ops-payments',
    dependencies: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    capabilities: Object.freeze([
      { id: 'card_payments', failureMode: 'fail_closed', labelKey: 'adminProviderHealth.providers.stripe.capabilities.card_payments.label', customerSafeKey: 'adminProviderHealth.providers.stripe.capabilities.card_payments.customerSafe' },
      { id: 'connect_payouts', failureMode: 'fail_closed', labelKey: 'adminProviderHealth.providers.stripe.capabilities.connect_payouts.label', customerSafeKey: 'adminProviderHealth.providers.stripe.capabilities.connect_payouts.customerSafe' },
      { id: 'refunds', failureMode: 'queued_retry', labelKey: 'adminProviderHealth.providers.stripe.capabilities.refunds.label', customerSafeKey: 'adminProviderHealth.providers.stripe.capabilities.refunds.customerSafe' },
      { id: 'webhooks', failureMode: 'queued_retry', labelKey: 'adminProviderHealth.providers.stripe.capabilities.webhooks.label', customerSafeKey: 'adminProviderHealth.providers.stripe.capabilities.webhooks.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8000, backoff: 'exponential', jitter: true,
      retryOn: ['timeout', '429', '5xx', 'connection_reset'],
      noteKey: 'adminProviderHealth.providers.stripe.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 5, resetTimeoutMs: 30000, halfOpenMaxCalls: 2 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.stripe.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: 90, procedureKey: 'adminProviderHealth.providers.stripe.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.stripe.customerSafeSummary',
    probe: probeStripe,
  }),
  Object.freeze({
    id: 'maps',
    name: 'Maps (AWS Location)',
    category: 'location',
    owner: 'Marketplace platform on-call',
    alertChannel: 'incident email + Slack #ops-platform',
    dependencies: ['AWS_GEO_PLACES_ENABLED', 'AWS_REGION', 'AWS_LOCATION_ACCESS_KEY_ID', 'AWS_LOCATION_SECRET_ACCESS_KEY'],
    capabilities: Object.freeze([
      { id: 'place_search', failureMode: 'degraded', labelKey: 'adminProviderHealth.providers.maps.capabilities.place_search.label', customerSafeKey: 'adminProviderHealth.providers.maps.capabilities.place_search.customerSafe' },
      { id: 'geocode', failureMode: 'degraded', labelKey: 'adminProviderHealth.providers.maps.capabilities.geocode.label', customerSafeKey: 'adminProviderHealth.providers.maps.capabilities.geocode.customerSafe' },
      { id: 'routes', failureMode: 'degraded', labelKey: 'adminProviderHealth.providers.maps.capabilities.routes.label', customerSafeKey: 'adminProviderHealth.providers.maps.capabilities.routes.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 2, baseDelayMs: 300, maxDelayMs: 2000, backoff: 'exponential', jitter: true,
      retryOn: ['timeout', '5xx', 'throttling'],
      noteKey: 'adminProviderHealth.providers.maps.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 8, resetTimeoutMs: 60000, halfOpenMaxCalls: 2 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.maps.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: 180, procedureKey: 'adminProviderHealth.providers.maps.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.maps.customerSafeSummary',
    probe: probeMaps,
  }),
  Object.freeze({
    id: 'messaging',
    name: 'Messaging (email, SMS, push)',
    category: 'notifications',
    owner: 'Marketplace platform on-call',
    alertChannel: 'incident email + Slack #ops-platform',
    dependencies: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'AWS_SMS_ADMIN_VERIFICATION_ENABLED', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
    capabilities: Object.freeze([
      { id: 'email', failureMode: 'queued_retry', labelKey: 'adminProviderHealth.providers.messaging.capabilities.email.label', customerSafeKey: 'adminProviderHealth.providers.messaging.capabilities.email.customerSafe' },
      { id: 'sms', failureMode: 'fail_closed', labelKey: 'adminProviderHealth.providers.messaging.capabilities.sms.label', customerSafeKey: 'adminProviderHealth.providers.messaging.capabilities.sms.customerSafe' },
      { id: 'push', failureMode: 'fail_open', labelKey: 'adminProviderHealth.providers.messaging.capabilities.push.label', customerSafeKey: 'adminProviderHealth.providers.messaging.capabilities.push.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 15000, backoff: 'exponential', jitter: true,
      retryOn: ['timeout', '5xx', 'connection_reset'],
      noteKey: 'adminProviderHealth.providers.messaging.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 5, resetTimeoutMs: 60000, halfOpenMaxCalls: 2 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.messaging.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: 180, procedureKey: 'adminProviderHealth.providers.messaging.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.messaging.customerSafeSummary',
    probe: probeMessaging,
  }),
  Object.freeze({
    id: 'ai',
    name: 'AI (Meta, OpenRouter, Ollama)',
    category: 'ai',
    owner: 'AI platform on-call',
    alertChannel: 'incident email + Slack #ops-ai',
    dependencies: ['META_AI_API_KEY', 'META_AI_MODEL', 'OPENROUTER_API_KEY', 'OLLAMA_URL'],
    capabilities: Object.freeze([
      { id: 'support_chat', failureMode: 'degraded', labelKey: 'adminProviderHealth.providers.ai.capabilities.support_chat.label', customerSafeKey: 'adminProviderHealth.providers.ai.capabilities.support_chat.customerSafe' },
      { id: 'guide_help', failureMode: 'fail_open', labelKey: 'adminProviderHealth.providers.ai.capabilities.guide_help.label', customerSafeKey: 'adminProviderHealth.providers.ai.capabilities.guide_help.customerSafe' },
      { id: 'learn_tagging', failureMode: 'fail_open', labelKey: 'adminProviderHealth.providers.ai.capabilities.learn_tagging.label', customerSafeKey: 'adminProviderHealth.providers.ai.capabilities.learn_tagging.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 2, baseDelayMs: 800, maxDelayMs: 5000, backoff: 'exponential', jitter: true,
      retryOn: ['timeout', '429', '5xx'],
      noteKey: 'adminProviderHealth.providers.ai.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 5, resetTimeoutMs: 45000, halfOpenMaxCalls: 1 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.ai.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: 90, procedureKey: 'adminProviderHealth.providers.ai.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.ai.customerSafeSummary',
    probe: probeAi,
  }),
  Object.freeze({
    id: 'scanning',
    name: 'Malware scanning (ClamAV)',
    category: 'security',
    owner: 'Security on-call',
    alertChannel: 'incident email + Slack #ops-security',
    dependencies: ['CLAMAV_HOST', 'CLAMAV_PORT', 'FILE_SCAN_REQUIRE_MALWARE'],
    capabilities: Object.freeze([
      { id: 'upload_scan', failureMode: 'fail_closed', labelKey: 'adminProviderHealth.providers.scanning.capabilities.upload_scan.label', customerSafeKey: 'adminProviderHealth.providers.scanning.capabilities.upload_scan.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 3000, backoff: 'fixed', jitter: false,
      retryOn: ['timeout', 'connection_reset'],
      noteKey: 'adminProviderHealth.providers.scanning.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 3, resetTimeoutMs: 30000, halfOpenMaxCalls: 1 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.scanning.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: null, procedureKey: 'adminProviderHealth.providers.scanning.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.scanning.customerSafeSummary',
    probe: probeScanning,
  }),
  Object.freeze({
    id: 'storage',
    name: 'File storage (S3-compatible)',
    category: 'storage',
    owner: 'Marketplace platform on-call',
    alertChannel: 'incident email + Slack #ops-platform',
    dependencies: ['AWS_S3_BUCKET', 'AWS_S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'LOCAL_UPLOAD_DIR'],
    capabilities: Object.freeze([
      { id: 'uploads', failureMode: 'fail_closed', labelKey: 'adminProviderHealth.providers.storage.capabilities.uploads.label', customerSafeKey: 'adminProviderHealth.providers.storage.capabilities.uploads.customerSafe' },
      { id: 'signed_urls', failureMode: 'fail_closed', labelKey: 'adminProviderHealth.providers.storage.capabilities.signed_urls.label', customerSafeKey: 'adminProviderHealth.providers.storage.capabilities.signed_urls.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8000, backoff: 'exponential', jitter: true,
      retryOn: ['timeout', '5xx', 'connection_reset'],
      noteKey: 'adminProviderHealth.providers.storage.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 5, resetTimeoutMs: 30000, halfOpenMaxCalls: 2 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.storage.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: 180, procedureKey: 'adminProviderHealth.providers.storage.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.storage.customerSafeSummary',
    probe: probeStorage,
  }),
  Object.freeze({
    id: 'calendars',
    name: 'Calendars (Google, Outlook)',
    category: 'scheduling',
    owner: 'Marketplace platform on-call',
    alertChannel: 'incident email + Slack #ops-platform',
    dependencies: ['business_integrations (google_calendar, outlook_calendar)'],
    capabilities: Object.freeze([
      { id: 'calendar_sync', failureMode: 'fail_open', labelKey: 'adminProviderHealth.providers.calendars.capabilities.calendar_sync.label', customerSafeKey: 'adminProviderHealth.providers.calendars.capabilities.calendar_sync.customerSafe' },
      { id: 'ical_export', failureMode: 'fail_open', labelKey: 'adminProviderHealth.providers.calendars.capabilities.ical_export.label', customerSafeKey: 'adminProviderHealth.providers.calendars.capabilities.ical_export.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30000, backoff: 'exponential', jitter: true,
      retryOn: ['timeout', '429', '5xx'],
      noteKey: 'adminProviderHealth.providers.calendars.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 5, resetTimeoutMs: 120000, halfOpenMaxCalls: 1 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.calendars.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: 365, procedureKey: 'adminProviderHealth.providers.calendars.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.calendars.customerSafeSummary',
    probe: probeCalendars,
  }),
  Object.freeze({
    id: 'trackers',
    name: 'Tracking (delivery and shipments)',
    category: 'logistics',
    owner: 'Logistics on-call',
    alertChannel: 'incident email + Slack #ops-logistics',
    dependencies: ['delivery_tracking_events', 'Redis (realtime bus)'],
    capabilities: Object.freeze([
      { id: 'live_driver_tracking', failureMode: 'degraded', labelKey: 'adminProviderHealth.providers.trackers.capabilities.live_driver_tracking.label', customerSafeKey: 'adminProviderHealth.providers.trackers.capabilities.live_driver_tracking.customerSafe' },
      { id: 'tracking_links', failureMode: 'fail_open', labelKey: 'adminProviderHealth.providers.trackers.capabilities.tracking_links.label', customerSafeKey: 'adminProviderHealth.providers.trackers.capabilities.tracking_links.customerSafe' },
    ]),
    retryPolicy: Object.freeze({
      maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, backoff: 'exponential', jitter: true,
      retryOn: ['timeout', 'connection_reset'],
      noteKey: 'adminProviderHealth.providers.trackers.retryNote',
    }),
    circuitBreaker: Object.freeze({ failureThreshold: 8, resetTimeoutMs: 60000, halfOpenMaxCalls: 2 }),
    budget: Object.freeze({ monthlyUsd: null, noteKey: 'adminProviderHealth.providers.trackers.budgetNote' }),
    rotationPolicy: Object.freeze({ keyRotationDays: null, procedureKey: 'adminProviderHealth.providers.trackers.rotationProcedure' }),
    customerSafeSummaryKey: 'adminProviderHealth.providers.trackers.customerSafeSummary',
    probe: probeTrackers,
  }),
]);

// ── Breakers + outcome recording ────────────────────────────────────────────

const breakers = new Map();

function getProviderDefinition(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

function getCircuitBreaker(id) {
  const def = getProviderDefinition(id);
  if (!def) throw new Error(`Unknown provider: ${id}`);
  if (!breakers.has(id)) {
    breakers.set(id, createCircuitBreaker(`provider:${id}`, def.circuitBreaker));
  }
  return breakers.get(id);
}

/**
 * Record a real call outcome so the operator view reflects observed health,
 * not just probe results. Call sites should call this on raw success/failure.
 */
async function recordProviderOutcome(id, ok) {
  try {
    const breaker = getCircuitBreaker(id);
    if (ok) await breaker.recordSuccess();
    else await breaker.recordFailure();
  } catch (err) {
    logger.warn('recordProviderOutcome failed', { id, error: err.message });
  }
}

// ── Probing + aggregation ───────────────────────────────────────────────────

const probeCache = createTtlCache({ name: 'providerHealthProbes', ttlMs: PROBE_CACHE_TTL_MS, maxEntries: 32 });

function serializeDefinition(def) {
  const { probe: _probe, ...rest } = def;
  return rest;
}

async function probeProvider(id, { force = false } = {}) {
  const def = getProviderDefinition(id);
  if (!def) throw new Error(`Unknown provider: ${id}`);
  const cacheKey = `probe:${id}`;
  if (!force) {
    const cached = probeCache.get(cacheKey);
    if (cached) return cached;
  }
  const breaker = getCircuitBreaker(id);
  let result;
  try {
    result = await breaker.execute(() => withTimeout(
      def.probe().then((r) => ({ ...r, latencyMs: Math.max(0, Number(r.latencyMs) || 0) })),
      PROBE_TIMEOUT_MS + 2000,
      `provider probe ${id}`
    ));
  } catch (err) {
    if (err.code === 'circuit_open') {
      result = { status: 'down', latencyMs: 0, detail: `Circuit breaker is ${err.circuitState}; probes fail fast until it resets.` };
    } else {
      result = { status: 'down', latencyMs: 0, detail: `Probe error: ${err.message}` };
    }
  }
  const snapshot = Object.freeze({ providerId: id, ...result, probedAt: new Date().toISOString() });
  probeCache.set(cacheKey, snapshot);
  return snapshot;
}

async function getProviderHealth(id, options = {}) {
  const def = getProviderDefinition(id);
  if (!def) throw new Error(`Unknown provider: ${id}`);
  const [probe, circuit] = await Promise.all([
    probeProvider(id, options),
    getCircuitBreaker(id).getState(),
  ]);
  return Object.freeze({
    ...serializeDefinition(def),
    status: probe.status,
    latencyMs: probe.latencyMs,
    detail: probe.detail,
    probedAt: probe.probedAt,
    circuit: {
      state: circuit.state,
      failures: circuit.failures,
      openedAt: circuit.openedAt ? new Date(circuit.openedAt).toISOString() : null,
    },
  });
}

async function getAllProviderHealth(options = {}) {
  const items = await Promise.all(PROVIDERS.map((p) => getProviderHealth(p.id, options)));
  const order = { down: 0, degraded: 1, unknown: 2, not_configured: 3, ok: 4 };
  items.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    providers: items,
  });
}

async function resetProviderCircuit(id) {
  const breaker = getCircuitBreaker(id);
  await breaker.reset();
  probeCache.delete(`probe:${id}`);
}

module.exports = {
  PROVIDERS,
  PROVIDER_STATUSES: Object.freeze(['ok', 'degraded', 'down', 'not_configured', 'unknown']),
  FAILURE_MODES: Object.freeze(['fail_closed', 'fail_open', 'degraded', 'queued_retry']),
  getProviderDefinition,
  getCircuitBreaker,
  recordProviderOutcome,
  probeProvider,
  getProviderHealth,
  getAllProviderHealth,
  resetProviderCircuit,
};
