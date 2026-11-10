'use strict';

// Calendar free/busy for interview scheduling (docs/careers/marketplace.md
// §6.2). Interviewers may connect Google Calendar or Microsoft 365 over
// OAuth 2.0 (authorization code + PKCE). Only free/busy is read:
//   • Google: scope calendar.freebusy, POST /calendar/v3/freeBusy;
//   • Microsoft Graph: Calendars.ReadBasic, POST /me/calendar/getSchedule.
// No event titles, attendees or bodies are requested or stored. Tokens are
// encrypted at rest (utils/encryption, AES-256-GCM) and deleted on
// disconnect or account erasure. Each provider is off until its flag and
// OAuth client are configured; ICS + in-app availability is the fallback.

const crypto = require('crypto');
const { AppError } = require('../../../middleware/errorHandler');
const { encrypt, decrypt } = require('../../../utils/encryption');
const logger = require('../../../utils/logger');
const { calendarConfig } = require('../providers/config');
const { featureOff } = require('./common');

const PROVIDERS = ['google', 'microsoft'];
const STATE_TTL_MS = 10 * 60_000;
const HTTP_TIMEOUT_MS = 10_000;

function endpoints(provider, cfg) {
  if (provider === 'google') {
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
      scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    };
  }
  const tenant = encodeURIComponent(cfg.tenant || 'common');
  return {
    authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    revoke: null,
    scope: 'offline_access User.Read Calendars.ReadBasic',
  };
}

function assertProvider(provider) {
  if (!PROVIDERS.includes(provider)) throw new AppError('Unknown calendar provider', 404, 'not_found');
  const cfg = calendarConfig(provider);
  if (!cfg.configured) throw featureOff(`calendar_${provider}`);
  return cfg;
}

function callbackBase() {
  return (process.env.CAREERS_OAUTH_CALLBACK_BASE || process.env.API_PUBLIC_URL || process.env.CLIENT_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function redirectUri(provider) {
  return `${callbackBase()}/api/careers/calendar/${provider}/callback`;
}

function safeReturnTo(value) {
  const s = String(value || '');
  return /^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/.test(s) && s.length <= 300 ? s : '/careers/employer';
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function status(db) {
  return async (userId) => {
    const { rows } = await db.query(
      'SELECT provider, connected_at, last_used_at, (last_error IS NOT NULL) AS has_error FROM career_calendar_connections WHERE user_id = $1',
      [userId]
    );
    return PROVIDERS.map((provider) => {
      const row = rows.find((r) => r.provider === provider);
      return {
        provider,
        available: calendarConfig(provider).configured,
        connected: Boolean(row),
        connected_at: row?.connected_at || null,
        needs_reconnect: Boolean(row?.has_error),
      };
    });
  };
}

async function connections(db, userId) { return status(db)(userId); }

async function startConnect(db, { userId, provider, returnTo }) {
  const cfg = assertProvider(provider);
  const ep = endpoints(provider, cfg);
  const state = b64url(crypto.randomBytes(32));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  await db.query("DELETE FROM career_calendar_oauth_states WHERE expires_at < NOW() OR user_id = $1", [userId]);
  await db.query(
    `INSERT INTO career_calendar_oauth_states (state_hash, user_id, provider, code_verifier_enc, return_to, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sha(state), userId, provider, encrypt(verifier), safeReturnTo(returnTo), new Date(Date.now() + STATE_TTL_MS)]
  );
  const url = new URL(ep.authorize);
  const params = {
    client_id: cfg.clientId,
    redirect_uri: redirectUri(provider),
    response_type: 'code',
    scope: ep.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  };
  if (provider === 'google') Object.assign(params, { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' });
  else params.response_mode = 'query';
  url.search = new URLSearchParams(params).toString();
  return { url: url.href };
}

async function postForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new AppError('The calendar provider refused the request', 502, 'calendar_provider_error');
    err.providerCode = body?.error || res.status;
    throw err;
  }
  return body;
}

/** OAuth redirect target. Returns the in-app path to send the browser to. */
async function finishConnect(db, { provider, state, code, error }) {
  if (!PROVIDERS.includes(provider)) return '/careers/employer?calendar=error';
  const { rows: [grant] } = await db.query(
    `DELETE FROM career_calendar_oauth_states WHERE state_hash = $1 AND provider = $2 RETURNING *`,
    [sha(state || ''), provider]
  );
  if (!grant) return '/careers/employer?calendar=error';
  const back = (result) => `${grant.return_to}${grant.return_to.includes('?') ? '&' : '?'}calendar=${result}`;
  if (error || !code || new Date(grant.expires_at) < new Date()) return back('cancelled');
  const cfg = calendarConfig(provider);
  if (!cfg.configured) return back('unavailable');
  const ep = endpoints(provider, cfg);
  try {
    const token = await postForm(ep.token, {
      grant_type: 'authorization_code',
      code: String(code).slice(0, 2048),
      redirect_uri: redirectUri(provider),
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: decrypt(grant.code_verifier_enc),
    });
    if (!token.refresh_token) return back('error');
    await db.query(
      `INSERT INTO career_calendar_connections (user_id, provider, refresh_token_enc, access_token_enc, access_expires_at, scope)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, provider) DO UPDATE SET refresh_token_enc = EXCLUDED.refresh_token_enc,
         access_token_enc = EXCLUDED.access_token_enc, access_expires_at = EXCLUDED.access_expires_at,
         scope = EXCLUDED.scope, connected_at = NOW(), last_error = NULL`,
      [grant.user_id, provider, encrypt(token.refresh_token), token.access_token ? encrypt(token.access_token) : null,
        token.expires_in ? new Date(Date.now() + (Number(token.expires_in) - 60) * 1000) : null, String(token.scope || ep.scope).slice(0, 500)]
    );
    return back('connected');
  } catch (err) {
    logger.warn('careers.calendar.connect_failed', { provider, code: err.providerCode || err.code || 'error' });
    return back('error');
  }
}

async function disconnect(db, { userId, provider }) {
  if (!PROVIDERS.includes(provider)) throw new AppError('Unknown calendar provider', 404, 'not_found');
  const { rows: [row] } = await db.query(
    'DELETE FROM career_calendar_connections WHERE user_id = $1 AND provider = $2 RETURNING refresh_token_enc',
    [userId, provider]
  );
  if (row && provider === 'google') {
    try {
      await fetch(`${endpoints('google').revoke}?token=${encodeURIComponent(decrypt(row.refresh_token_enc))}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch { /* the grant is already gone on our side */ }
  }
  return { disconnected: Boolean(row) };
}

async function accessToken(db, row) {
  if (row.access_token_enc && row.access_expires_at && new Date(row.access_expires_at) > new Date()) {
    return decrypt(row.access_token_enc);
  }
  const cfg = calendarConfig(row.provider);
  const ep = endpoints(row.provider, cfg);
  const token = await postForm(ep.token, {
    grant_type: 'refresh_token',
    refresh_token: decrypt(row.refresh_token_enc),
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    ...(row.provider === 'microsoft' ? { scope: ep.scope } : {}),
  });
  await db.query(
    `UPDATE career_calendar_connections SET access_token_enc = $3, access_expires_at = $4,
            refresh_token_enc = COALESCE($5, refresh_token_enc), last_error = NULL
      WHERE user_id = $1 AND provider = $2`,
    [row.user_id, row.provider, encrypt(token.access_token), new Date(Date.now() + (Number(token.expires_in || 3600) - 60) * 1000),
      token.refresh_token ? encrypt(token.refresh_token) : null]
  );
  return token.access_token;
}

async function jsonFetch(url, accessTokenValue, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${accessTokenValue}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new AppError('The calendar provider refused the request', 502, 'calendar_provider_error');
    err.providerCode = json?.error?.code || json?.error || res.status;
    throw err;
  }
  return json;
}

function msDate(value) {
  // Graph returns local wall-clock in the requested zone (UTC here) without "Z".
  const s = String(value?.dateTime || '');
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
}

/**
 * Busy intervals [{start, end}] for one user across connected calendars.
 * Failures are recorded and skipped (scheduling falls back to in-app
 * availability); nothing about event content is returned.
 */
async function busyIntervals(db, userId, from, to, { fetchImpl = null } = {}) {
  const { rows } = await db.query('SELECT * FROM career_calendar_connections WHERE user_id = $1', [userId]);
  const busy = [];
  for (const row of rows) {
    if (!calendarConfig(row.provider).configured) continue;
    try {
      const token = await accessToken(db, row);
      if (row.provider === 'google') {
        const json = await (fetchImpl || jsonFetch)('https://www.googleapis.com/calendar/v3/freeBusy', token, {
          timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: 'primary' }],
        });
        for (const b of json?.calendars?.primary?.busy || []) busy.push({ start: new Date(b.start), end: new Date(b.end) });
      } else {
        const me = await (fetchImpl || jsonFetch)('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', token);
        const address = me.mail || me.userPrincipalName;
        const json = await (fetchImpl || jsonFetch)('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', token, {
          schedules: [address],
          startTime: { dateTime: new Date(from).toISOString().slice(0, 19), timeZone: 'UTC' },
          endTime: { dateTime: new Date(to).toISOString().slice(0, 19), timeZone: 'UTC' },
          availabilityViewInterval: 15,
        });
        for (const item of json?.value?.[0]?.scheduleItems || []) {
          if (String(item.status).toLowerCase() === 'free') continue;
          busy.push({ start: msDate(item.start), end: msDate(item.end) });
        }
      }
      await db.query('UPDATE career_calendar_connections SET last_used_at = NOW(), last_error = NULL WHERE user_id = $1 AND provider = $2', [userId, row.provider]);
    } catch (err) {
      await db.query('UPDATE career_calendar_connections SET last_error = $3 WHERE user_id = $1 AND provider = $2',
        [userId, row.provider, String(err.providerCode || err.code || 'error').slice(0, 100)]);
      logger.warn('careers.calendar.freebusy_failed', { provider: row.provider, code: err.providerCode || err.code || 'error' });
    }
  }
  return busy;
}

module.exports = {
  PROVIDERS,
  redirectUri,
  safeReturnTo,
  connections,
  startConnect,
  finishConnect,
  disconnect,
  busyIntervals,
};
