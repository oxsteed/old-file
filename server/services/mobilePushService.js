const crypto = require('crypto');
const fs = require('fs');
const http2 = require('http2');
const https = require('https');
const db = require('../db');
const logger = require('../utils/logger');

const APNS_ENV = (process.env.APNS_ENV || 'production').toLowerCase();
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || process.env.IOS_BUNDLE_ID || 'com.oxsteed.app';
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || process.env.APPLE_TEAM_ID || '';
const APNS_KEY_ID = process.env.APNS_KEY_ID || '';
const APNS_PRIVATE_KEY = loadSecret({
  raw: process.env.APNS_PRIVATE_KEY,
  base64: process.env.APNS_PRIVATE_KEY_BASE64,
  path: process.env.APNS_PRIVATE_KEY_PATH,
});

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';
const FIREBASE_SERVICE_ACCOUNT = loadFirebaseServiceAccount();

let apnsJwtCache = { token: null, expiresAt: 0 };
let fcmAccessTokenCache = { token: null, expiresAt: 0 };

function loadSecret({ raw, base64, path }) {
  if (raw) return raw.replace(/\\n/g, '\n');
  if (base64) return Buffer.from(base64, 'base64').toString('utf8');
  if (path) {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch (err) {
      logger.warn('[MobilePush] Could not read secret file', { path, error: err.message });
    }
  }
  return '';
}

function loadFirebaseServiceAccount() {
  const raw = loadSecret({
    raw: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    base64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
    path: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  });
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn('[MobilePush] Invalid Firebase service account JSON', { error: err.message });
    return null;
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(header, claims, key, algorithm) {
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  let signature = crypto
    .createSign(algorithm)
    .update(unsigned)
    .sign(key);
  if (header.alg === 'ES256') {
    signature = derEcdsaSignatureToJose(signature, 32);
  }
  return `${unsigned}.${base64Url(signature)}`;
}

function derEcdsaSignatureToJose(signature, partLength) {
  let offset = 0;
  if (signature[offset++] !== 0x30) {
    throw new Error('Invalid ECDSA signature');
  }

  let sequenceLength = signature[offset++];
  if (sequenceLength & 0x80) {
    const lengthBytes = sequenceLength & 0x7f;
    sequenceLength = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      sequenceLength = (sequenceLength << 8) + signature[offset++];
    }
  }

  if (signature[offset++] !== 0x02) {
    throw new Error('Invalid ECDSA signature');
  }
  const rLength = signature[offset++];
  const r = signature.subarray(offset, offset + rLength);
  offset += rLength;

  if (signature[offset++] !== 0x02) {
    throw new Error('Invalid ECDSA signature');
  }
  const sLength = signature[offset++];
  const s = signature.subarray(offset, offset + sLength);

  return Buffer.concat([
    normalizeEcdsaPart(r, partLength),
    normalizeEcdsaPart(s, partLength),
  ]);
}

function normalizeEcdsaPart(part, length) {
  let value = part;
  while (value.length > length && value[0] === 0) {
    value = value.subarray(1);
  }
  if (value.length > length) {
    throw new Error('Invalid ECDSA signature length');
  }
  if (value.length === length) return value;
  return Buffer.concat([Buffer.alloc(length - value.length), value]);
}

function apnsConfigured() {
  return Boolean(APNS_TEAM_ID && APNS_KEY_ID && APNS_PRIVATE_KEY && APNS_BUNDLE_ID);
}

function fcmConfigured() {
  return Boolean(
    FIREBASE_PROJECT_ID &&
    FIREBASE_SERVICE_ACCOUNT?.client_email &&
    FIREBASE_SERVICE_ACCOUNT?.private_key
  );
}

exports.isConfigured = () => apnsConfigured() || fcmConfigured();

function getApnsJwt() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (apnsJwtCache.token && apnsJwtCache.expiresAt > nowSeconds + 60) {
    return apnsJwtCache.token;
  }

  const token = signJwt(
    { alg: 'ES256', kid: APNS_KEY_ID },
    { iss: APNS_TEAM_ID, iat: nowSeconds },
    APNS_PRIVATE_KEY,
    'sha256'
  );

  apnsJwtCache = {
    token,
    expiresAt: nowSeconds + 50 * 60,
  };
  return token;
}

function normalizeData(data = {}, actionUrl = null, notifId = null) {
  return {
    ...data,
    ...(actionUrl ? { url: actionUrl } : {}),
    ...(notifId ? { notifId: String(notifId) } : {}),
  };
}

function normalizeFcmData(data = {}) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
  );
}

function requestJson(url, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
        }
        resolve({ statusCode: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function getFcmAccessToken() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (fcmAccessTokenCache.token && fcmAccessTokenCache.expiresAt > nowSeconds + 60) {
    return fcmAccessTokenCache.token;
  }

  const assertion = signJwt(
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: FIREBASE_SERVICE_ACCOUNT.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    },
    FIREBASE_SERVICE_ACCOUNT.private_key.replace(/\\n/g, '\n'),
    'RSA-SHA256'
  );

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const { statusCode, json } = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
    },
  }, params.toString());

  if (statusCode < 200 || statusCode >= 300 || !json?.access_token) {
    throw new Error(`FCM access token request failed (${statusCode})`);
  }

  fcmAccessTokenCache = {
    token: json.access_token,
    expiresAt: nowSeconds + Math.max(300, Number(json.expires_in || 3600) - 60),
  };
  return fcmAccessTokenCache.token;
}

async function sendApns(token, payload) {
  const host = APNS_ENV === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const client = http2.connect(`https://${host}`);

  return new Promise((resolve, reject) => {
    client.on('error', reject);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${getApnsJwt()}`,
      'apns-topic': APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });

    const chunks = [];
    let status = 0;
    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      client.close();
      const text = Buffer.concat(chunks).toString('utf8');
      let body = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { raw: text };
        }
      }
      resolve({ status, body });
    });
    req.on('error', (err) => {
      client.close();
      reject(err);
    });
    req.end(JSON.stringify(payload));
  });
}

async function sendFcm(token, { title, body, data }) {
  const accessToken = await getFcmAccessToken();
  const message = {
    message: {
      token,
      notification: { title, body },
      data: normalizeFcmData(data),
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 },
        },
      },
    },
  };

  return requestJson(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    },
    message
  );
}

async function disableToken(id, reason) {
  await db.query(
    `UPDATE mobile_push_tokens
     SET enabled = FALSE, disabled_at = NOW(), updated_at = NOW(), device = device || $2::jsonb
     WHERE id = $1`,
    [id, JSON.stringify({ disabledReason: reason })]
  );
}

function shouldDisableApns(status, body) {
  return status === 410 || (
    status === 400 &&
    ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(body?.reason)
  );
}

function shouldDisableFcm(statusCode, json) {
  const status = json?.error?.status;
  const message = json?.error?.message || '';
  return statusCode === 404 ||
    ['NOT_FOUND', 'INVALID_ARGUMENT'].includes(status) ||
    /registration token is not a valid/i.test(message);
}

exports.sendToUser = async (userId, { title, body, data = {}, action_url = null, notifId = null }) => {
  const { rows } = await db.query(
    `SELECT id, token, provider
     FROM mobile_push_tokens
     WHERE user_id = $1 AND enabled = TRUE`,
    [userId]
  );

  if (!rows.length) return { sent: 0, failed: 0, skipped: 0 };

  const pushData = normalizeData(data, action_url, notifId);
  const payload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1,
    },
    ...pushData,
  };

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      if (row.provider === 'apns') {
        if (!apnsConfigured()) {
          skipped += 1;
          continue;
        }
        const result = await sendApns(row.token, payload);
        if (result.status === 200) {
          sent += 1;
        } else {
          failed += 1;
          logger.warn('[MobilePush] APNs send failed', {
            userId, status: result.status, reason: result.body?.reason,
          });
          if (shouldDisableApns(result.status, result.body)) {
            await disableToken(row.id, result.body?.reason || `apns_${result.status}`);
          }
        }
        continue;
      }

      if (row.provider === 'fcm') {
        if (!fcmConfigured()) {
          skipped += 1;
          continue;
        }
        const result = await sendFcm(row.token, { title, body, data: pushData });
        if (result.statusCode >= 200 && result.statusCode < 300) {
          sent += 1;
        } else {
          failed += 1;
          logger.warn('[MobilePush] FCM send failed', {
            userId, status: result.statusCode, reason: result.json?.error?.message,
          });
          if (shouldDisableFcm(result.statusCode, result.json)) {
            await disableToken(row.id, result.json?.error?.status || `fcm_${result.statusCode}`);
          }
        }
        continue;
      }

      skipped += 1;
    } catch (err) {
      failed += 1;
      logger.warn('[MobilePush] Send failed', { userId, provider: row.provider, error: err.message });
    }
  }

  return { sent, failed, skipped };
};
