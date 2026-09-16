'use strict';

const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '66666666-6666-4666-8666-666666666666';
const CUSTOMER_EMAIL = 'credit-customer-one@example.test';
const PASSWORD = 'TestPassword123!';

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
  const baseUrl = 'http://127.0.0.1:5000';
  const login = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: CUSTOMER_EMAIL,
      password: PASSWORD,
      termsAgreed: true,
      agreementName: 'Credit Customer One',
    }),
  });
  if (!login.accessToken) throw new Error('Customer login did not return an access token');

  const customerHeaders = { authorization: `Bearer ${login.accessToken}` };
  const customer = await request(baseUrl, '/api/auth/me', { headers: customerHeaders });
  if (String(customer.user?.id) !== CUSTOMER_ID) throw new Error('Authenticated customer identity did not match the fixture');

  const adminToken = jwt.sign({ id: ADMIN_ID, role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
  const adminHeaders = { authorization: `Bearer ${adminToken}` };
  const railBefore = await request(baseUrl, '/api/admin/super/oxsteed-credit/rail', { headers: adminHeaders });
  if (railBefore.rail?.enabled !== false) throw new Error('Credit rail fixture was not initially suspended');

  await request(baseUrl, '/api/admin/super/oxsteed-credit/rail', {
    method: 'POST',
    headers: { ...adminHeaders, 'idempotency-key': 'isolated-rail-enable-1' },
    body: JSON.stringify({ enabled: true, reason: 'Isolated synthetic smoke test only' }),
  });
  const load = await request(baseUrl, `/api/admin/super/oxsteed-credit/customers/${CUSTOMER_ID}/loads`, {
    method: 'POST',
    headers: { ...adminHeaders, 'idempotency-key': 'isolated-load-1' },
    body: JSON.stringify({ amountCents: 1000, currencyCode: 'USD', referenceId: 'isolated-funding-1', reason: 'Synthetic isolated fixture funding' }),
  });
  if (load.transaction?.amountCents !== 1000) throw new Error('Isolated Credit load returned an unexpected amount');

  const accounts = await request(baseUrl, '/api/oxsteed-credit/accounts', { headers: customerHeaders });
  const usdAccount = accounts.accounts?.find((account) => account.currencyCode === 'USD');
  if (usdAccount?.balanceCents !== 1000) throw new Error(`Expected USD customer balance 1000, received ${usdAccount?.balanceCents}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
  try {
    const { rows } = await pool.query(
      `SELECT a.balance_cents, a.ledger_version, COUNT(e.id)::int AS entry_count
         FROM oxsteed_credit_accounts a
         LEFT JOIN oxsteed_credit_transaction_entries e ON e.account_id = a.id
        WHERE a.customer_id = $1 AND a.currency_code = 'USD'
        GROUP BY a.id, a.balance_cents, a.ledger_version`,
      [CUSTOMER_ID]
    );
    if (Number(rows[0]?.balance_cents) !== 1000 || Number(rows[0]?.ledger_version) !== 1 || Number(rows[0]?.entry_count) !== 1) {
      throw new Error(`Isolated journal verification failed: ${JSON.stringify(rows[0] || null)}`);
    }
  } finally {
    await pool.end();
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    authenticatedCustomer: CUSTOMER_ID,
    loadedCents: 1000,
    currency: 'USD',
    journalVerified: true,
    railEnabledOnlyInIsolatedFixture: true,
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
