'use strict';
// D-ENG-06: provider-agnostic age verification. Pure checks run everywhere;
// the DB block runs against the disposable CI database.
const providers = require('../growth/ageVerification/providers');
const age = require('../growth/ageVerification');

afterEach(() => providers._reset());

describe('age verification configuration (safe defaults)', () => {
  test('defaults to provider "none" and self-attestation off', () => {
    expect(age.status({})).toEqual({
      provider: 'none',
      provider_available: false,
      self_attestation: false,
      attestation_version: 'age-attest-v1',
    });
  });

  test('self-attestation only turns on with exactly "on"', () => {
    for (const v of ['true', 'ON', 'On', '1', 'yes', ' on', 'on ', '']) {
      expect(age.selfAttestationEnabled({ GROWTH_AGE_SELF_ATTESTATION: v })).toBe(false);
    }
    expect(age.selfAttestationEnabled({ GROWTH_AGE_SELF_ATTESTATION: 'on' })).toBe(true);
  });

  test('an unknown provider name fails closed to "none"', () => {
    expect(providers.active({ GROWTH_AGE_VERIFICATION_PROVIDER: 'some-vendor' }).name).toBe('none');
  });

  test('register validates the adapter shape and reserves "none"', () => {
    expect(() => providers.register({ name: 'x1' })).toThrow(/missing/);
    const ok = { name: 'none', available: () => true, startVerification() {}, parseCallback() {} };
    expect(() => providers.register(ok)).toThrow(/reserved/);
    providers.register({ ...ok, name: 'fake' });
    expect(providers.active({ GROWTH_AGE_VERIFICATION_PROVIDER: 'fake' }).name).toBe('fake');
  });

  test('backfill refuses to run without a provider and never touches the DB', async () => {
    const conn = { query: jest.fn() };
    const out = await age.backfill(conn, { apply: true, env: {} });
    expect(out).toMatchObject({ ran: false, reason: 'no_age_provider_configured', provider: 'none' });
    expect(conn.query).not.toHaveBeenCalled();
  });

  test('backfill refuses a provider with no bulk lookup', async () => {
    providers.register({ name: 'fake', available: () => true, startVerification() {}, parseCallback() {} });
    const out = await age.backfill({ query: jest.fn() }, { env: { GROWTH_AGE_VERIFICATION_PROVIDER: 'fake' } });
    expect(out).toMatchObject({ ran: false, reason: 'provider_has_no_bulk_lookup' });
  });

  test('self-attest is refused while disabled, before any query', async () => {
    const conn = { query: jest.fn() };
    await expect(age.selfAttest(conn, 'u', { adult: true, version: 'age-attest-v1' }, {}))
      .rejects.toMatchObject({ statusCode: 404, code: 'age_self_attestation_disabled' });
    expect(conn.query).not.toHaveBeenCalled();
  });

  test('provider callbacks 404 when the provider is "none"', async () => {
    await expect(age.handleProviderCallback({ query: jest.fn() }, 'none', {}, {}))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('references are stored only as sha256 hashes', () => {
    expect(age.hashReference('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(age.hashReference('')).toBeNull();
  });
});

const targetDb = process.env.STATEMENT_TEST_DATABASE_URL || '';
const usingDisposableDb = /credit_statement_test/.test(targetDb);

(usingDisposableDb ? describe : describe.skip)('age verification on the real schema (migration 99991)', () => {
  let pool;
  let client;
  const env = { GROWTH_AGE_SELF_ATTESTATION: 'on', GROWTH_AGE_ATTESTATION_VERSION: 'age-attest-v1' };
  const USER = '99991000-0000-4000-8000-000000000001';
  const ADMIN = '99991000-0000-4000-8000-000000000002';

  beforeAll(async () => {
    jest.unmock('pg');
    jest.unmock('../db');
    jest.resetModules();
    process.env.DATABASE_URL = targetDb;
    process.env.LOG_LEVEL = 'error';
    process.env.GROWTH_SUBJECT_PEPPER = process.env.GROWTH_SUBJECT_PEPPER || 'synthetic-test-pepper-0123456789abcdef';
    pool = require('../db');
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1,'age99991@example.invalid','x','A','User','customer',TRUE,TRUE),
              ($2,'age99991-admin@example.invalid','x','A','Admin','admin',TRUE,TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [USER, ADMIN]
    );
  });

  beforeEach(async () => { client = await pool.connect(); await client.query('BEGIN'); });
  afterEach(async () => { await client.query('ROLLBACK'); client.release(); });

  const ageMod = () => require('../growth/ageVerification');

  test('self-attestation confirms adult status and records method, version and an event', async () => {
    const out = await ageMod().selfAttest(client, USER, { adult: true, version: 'age-attest-v1' }, env);
    expect(out.adult_confirmed).toBe(true);
    const { rows: [e] } = await client.query('SELECT * FROM growth_subject_eligibility WHERE user_id=$1', [USER]);
    expect(e).toMatchObject({ adult_confirmed: true, verification_method: 'self_attestation', attestation_version: 'age-attest-v1' });
    expect(e.verified_at).toBeTruthy();
    const { rows: ev } = await client.query('SELECT method, outcome FROM growth_age_verification_events WHERE user_id=$1', [USER]);
    expect(ev).toEqual([{ method: 'self_attestation', outcome: 'adult' }]);
  });

  test('a stale attestation version is refused', async () => {
    await expect(ageMod().selfAttest(client, USER, { adult: true, version: 'old' }, env))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('withdrawal removes adult status, erases growth data and logs a revocation', async () => {
    await ageMod().selfAttest(client, USER, { adult: true, version: 'age-attest-v1' }, env);
    await ageMod().revoke(client, USER, { actorId: USER });
    const { rows: e } = await client.query('SELECT adult_confirmed FROM growth_subject_eligibility WHERE user_id=$1', [USER]);
    expect(e.every((r) => r.adult_confirmed === false)).toBe(true);
    const { rows: ev } = await client.query("SELECT outcome FROM growth_age_verification_events WHERE user_id=$1 AND method='revocation'", [USER]);
    expect(ev).toEqual([{ outcome: 'revoked' }]);
    expect((await ageMod().subjectStatus(client, USER, env)).adult_confirmed).toBe(false);
    const { rows: q } = await client.query("SELECT reason FROM growth_erasure_queue WHERE reason='eligibility_removed' ORDER BY id DESC LIMIT 1");
    expect(q.length).toBe(1);
  });

  test('a not-adult answer never confirms and an unknown answer never downgrades', async () => {
    const out = await ageMod().selfAttest(client, USER, { adult: false, version: 'age-attest-v1' }, env);
    expect(out.adult_confirmed).toBe(false);
    await ageMod().selfAttest(client, USER, { adult: true, version: 'age-attest-v1' }, env);
    const kept = await ageMod().recordOutcome(client, { userId: USER, method: 'provider', provider: 'fake', outcome: 'unknown' });
    expect(kept).toEqual({ adult_confirmed: true, changed: false });
  });

  test('admins are never made trackable', async () => {
    await expect(ageMod().selfAttest(client, ADMIN, { adult: true, version: 'age-attest-v1' }, env))
      .rejects.toMatchObject({ statusCode: 409, code: 'excluded_subject' });
  });

  test('backfill applies provider bulk results and stores only a hashed reference', async () => {
    const mod = ageMod();
    mod.providers.register({
      name: 'fake',
      available: () => true,
      startVerification() {},
      parseCallback() {},
      lookupBatch: async (ids) => ids.filter((id) => id === USER).map((id) => ({ userId: id, outcome: 'adult', reference: 'ref-123' })),
    });
    try {
      const out = await mod.backfill(client, { apply: true, limit: 5000, env: { GROWTH_AGE_VERIFICATION_PROVIDER: 'fake' } });
      expect(out.ran).toBe(true);
      expect(out.adult).toBe(1);
      const { rows: [ev] } = await client.query(
        "SELECT method, provider, reference_hash FROM growth_age_verification_events WHERE user_id=$1 AND method='backfill'", [USER]);
      expect(ev.provider).toBe('fake');
      expect(ev.reference_hash).toBe(mod.hashReference('ref-123'));

      // After a withdrawal the backfill leaves this user alone.
      await mod.revoke(client, USER, { actorId: USER });
      const again = await mod.backfill(client, { apply: true, limit: 5000, env: { GROWTH_AGE_VERIFICATION_PROVIDER: 'fake' } });
      expect(again.adult).toBe(0);
    } finally { mod.providers._reset(); }
  });
});
