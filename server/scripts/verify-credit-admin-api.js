'use strict';

const speakeasy = require('speakeasy');

const PASSWORD = process.env.CREDIT_TEST_ADMIN_PASSWORD || 'TestPassword123!';
const EMAIL = process.env.CREDIT_TEST_ADMIN_EMAIL || 'credit-approver@example.test';
const TOTP_SECRET = process.env.CREDIT_TEST_TOTP_SECRET || 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function assertIsolatedFixture() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Credit admin API verification is disabled in production.');
  }
  if (process.env.CREDIT_TEST_ADMIN_MODE !== 'true') {
    throw new Error('Set CREDIT_TEST_ADMIN_MODE=true to run the synthetic admin verifier.');
  }
  if (!/^oxsteed-credit-test-[a-z0-9-]+$/.test(process.env.CREDIT_TEST_PROJECT || '')) {
    throw new Error('CREDIT_TEST_PROJECT must identify an isolated Credit fixture.');
  }
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  assertIsolatedFixture();
  const baseUrl = process.env.CREDIT_TEST_API_URL || 'http://127.0.0.1:5000';
  const login = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.requiresTwoFactor || !login.mfaToken) {
    throw new Error('Synthetic Super Admin login did not require the expected MFA challenge.');
  }

  const token = speakeasy.totp({ secret: TOTP_SECRET, encoding: 'base32' });
  const authenticated = await request(baseUrl, '/api/auth/login/2fa', {
    method: 'POST',
    body: JSON.stringify({ mfaToken: login.mfaToken, token }),
  });
  if (authenticated.user?.role !== 'super_admin' || !authenticated.accessToken) {
    throw new Error('Synthetic MFA login did not return a Super Admin session.');
  }

  const headers = { authorization: `Bearer ${authenticated.accessToken}` };
  const endpoints = [
    ['overview', '/api/admin/super/oxsteed-credit/overview'],
    ['accounts', '/api/admin/super/oxsteed-credit/accounts'],
    ['partners', '/api/admin/super/oxsteed-credit/partners'],
    ['agreements', '/api/admin/super/oxsteed-credit/agreements'],
    ['settlements', '/api/admin/super/oxsteed-credit/settlements'],
    ['transactions', '/api/admin/super/oxsteed-credit/transactions'],
    ['disputes', '/api/admin/super/oxsteed-credit/disputes'],
    ['auditEvents', '/api/admin/super/oxsteed-credit/audit-events'],
    ['reconciliation', '/api/admin/super/oxsteed-credit/reconciliation'],
    ['rail', '/api/admin/super/oxsteed-credit/rail'],
    ['partnerLedger', '/api/admin/super/oxsteed-credit/partners/901/ledger'],
  ];
  const responses = {};
  for (const [name, path] of endpoints) {
    responses[name] = await request(baseUrl, path, { headers });
  }

  if (responses.rail.rail?.enabled !== false) {
    throw new Error('Admin verification changed or observed an enabled Credit rail.');
  }
  if (!responses.overview || !responses.accounts || !responses.partners) {
    throw new Error('Core Super Admin Credit read surfaces returned incomplete payloads.');
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    role: authenticated.user.role,
    mfa: true,
    railEnabled: responses.rail.rail?.enabled === true,
    verifiedSurfaces: endpoints.map(([name]) => name),
    accountCount: responses.accounts.accounts?.length ?? null,
    partnerCount: responses.partners.partners?.length ?? null,
    agreementCount: responses.agreements.agreements?.length ?? null,
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
