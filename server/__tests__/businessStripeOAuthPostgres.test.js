'use strict';

const { execFileSync, execFile } = require('child_process');
const { promisify } = require('util');
const { mockQuery, resetMocks } = require('./setup');
const { stripeAuthUrl, stripeCallback } = require('../controllers/businessIntegrationsController');
const integration = process.env.RUN_STRIPE_OAUTH_POSTGRES === '1' ? describe : describe.skip;
const container = 'oxsteed-stripe-oauth-verification-20260930';
const schema = `stripe_oauth_fixture_${process.pid}`;

function bind(sql, params) {
  return sql.replace(/\$(\d+)\b/g, (_, index) => {
    const value = params[Number(index) - 1];
    return value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;
  });
}
const args = ['--context', 'colima', 'exec', '-i', container,
  'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
function postgres(sql) {
  return execFileSync('docker', args, { input: `SET search_path TO ${schema};\n${sql}`, encoding: 'utf8', timeout: 15000 });
}

integration('Stripe business OAuth PostgreSQL invariants', () => {
  let upsert;
  let consume;
  let previousClientId;
  beforeAll(async () => {
    const network = execFileSync('docker', ['--context', 'colima', 'inspect', container,
      '--format', '{{.HostConfig.NetworkMode}}'], { encoding: 'utf8' }).trim();
    if (network !== 'none') throw new Error('OAuth fixtures require an isolated disposable container');
    previousClientId = process.env.STRIPE_CLIENT_ID;
    process.env.STRIPE_CLIENT_ID = 'ca_test_fixture';
    resetMocks();
    let state;
    let nonce;
    const res = {
      cookie: (_name, value) => { nonce = value; },
      json: body => { state = new URL(body.auth_url).searchParams.get('state'); },
      redirect: () => {},
    };
    const next = error => { throw error; };
    await stripeAuthUrl({ params: { businessId: '12' }, user: { id: 'fixture-owner' } }, res, next);
    upsert = bind(...mockQuery.mock.calls[0]);
    await stripeCallback({ params: {}, query: { code: 'synthetic-code', state },
      headers: { cookie: `oxsteed_stripe_oauth=${nonce}` } }, res, next);
    consume = bind(...mockQuery.mock.calls[1]);
    postgres(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
      CREATE TABLE businesses (id INT PRIMARY KEY, user_id TEXT, is_active BOOLEAN, deleted_at TIMESTAMPTZ);
      CREATE TABLE business_members (business_id INT, member_id TEXT, role TEXT, status TEXT);
      CREATE TABLE business_integrations (
        business_id INT, integration_type TEXT, integration_name TEXT,
        is_connected BOOLEAN, is_enabled BOOLEAN, created_by_id TEXT,
        config_json JSONB, updated_at TIMESTAMPTZ,
        UNIQUE (business_id, integration_type)
      );`);
  });
  afterAll(() => {
    postgres(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
    if (previousClientId === undefined) delete process.env.STRIPE_CLIENT_ID;
    else process.env.STRIPE_CLIENT_ID = previousClientId;
  });
  beforeEach(() => {
    postgres(`TRUNCATE business_integrations, business_members, businesses;
      INSERT INTO businesses VALUES (12, 'fixture-owner', TRUE, NULL);
      ${upsert};`);
  });

  test('starting again preserves an existing connection and unrelated configuration', () => {
    const output = postgres(`UPDATE business_integrations SET is_connected = TRUE,
      config_json = config_json || '{"account_id":"acct_fixture","keep":true}'::jsonb;
      ${upsert};
      SELECT is_connected || ':' || (config_json->>'account_id') || ':' || (config_json->>'keep')
        FROM business_integrations;`);
    expect(output.trim()).toBe('true:acct_fixture:true');
  });

  test('concurrent callbacks consume the pending authorization exactly once', async () => {
    const run = promisify(execFile);
    const outputs = await Promise.all([0, 1].map(() => run('docker', [...args, '-c',
      `SET search_path TO ${schema}; ${consume};`], { encoding: 'utf8', timeout: 15000 })));
    expect(outputs.map(result => result.stdout.trim()).sort()).toEqual(['', '12']);
    expect(postgres(`SELECT config_json ? 'stripe_oauth_pending' FROM business_integrations;`).trim()).toBe('f');
  });

  test('revoked ownership cannot consume authorization', () => {
    const output = postgres(`UPDATE businesses SET user_id = 'different-owner'; ${consume};`);
    expect(output.trim()).toBe('');
    expect(postgres(`SELECT config_json ? 'stripe_oauth_pending' FROM business_integrations;`).trim()).toBe('t');
  });

  test('expired pending authorization cannot be consumed', () => {
    const output = postgres(`UPDATE business_integrations SET config_json =
      jsonb_set(config_json, '{stripe_oauth_pending,expiresAt}', '1'::jsonb); ${consume};`);
    expect(output.trim()).toBe('');
  });

  test('an active granted owner remains supported', () => {
    const output = postgres(`UPDATE businesses SET user_id = 'primary-owner';
      INSERT INTO business_members VALUES (12,'fixture-owner','owner','active'); ${consume};`);
    expect(output.trim()).toBe('12');
  });
});
