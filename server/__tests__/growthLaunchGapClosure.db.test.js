'use strict';

// Migration 99989 (growth launch gap closure) against the disposable CI
// database: N-01 server-derived personalization, D23 prospect provenance and
// outreach constraints, D16 region geo source switch + rollback.

const targetDb = process.env.STATEMENT_TEST_DATABASE_URL || '';
const usingDisposableDb = /credit_statement_test/.test(targetDb);

jest.unmock('pg');
jest.unmock('../db');

jest.mock('../services/notificationService', () => ({
  sendBulkNotification: jest.fn().mockResolvedValue([]),
  sendNotification: jest.fn().mockResolvedValue({}),
}));

const ADMIN_ID = '99989000-0000-4000-8000-000000000001';

(usingDisposableDb ? describe : describe.skip)('migration 99989 growth gap closure', () => {
  let pool;
  let client;

  beforeAll(async () => {
    process.env.DATABASE_URL = targetDb;
    process.env.LOG_LEVEL = 'error';
    pool = require('../db');
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, 'g99989@example.com', 'x', 'G', 'Admin', 'super_admin', TRUE, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_ID]
    );
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE id=$1', [ADMIN_ID]).catch(() => {});
    await pool.end();
  });

  async function segmentVersion(definition) {
    const { rows: [seg] } = await client.query(
      `INSERT INTO growth_segments(name, created_by) VALUES ('t99989', $1) RETURNING id`, [ADMIN_ID]);
    const { rows: [ver] } = await client.query(
      `INSERT INTO growth_segment_versions(segment_id, version, definition, created_by)
       VALUES ($1, 1, $2::jsonb, $3) RETURNING id, is_personalized`,
      [seg.id, JSON.stringify(definition), ADMIN_ID]);
    return ver;
  }

  async function campaign(versionId, isPersonalized) {
    const { rows: [offer] } = await client.query(
      `INSERT INTO offers(type,title,countries,currency,value_minor,channels,expires_at)
       VALUES ('promo','t',ARRAY['US'],'USD',0,ARRAY['in_app'],NOW()+interval '1 day') RETURNING id`);
    const { rows: [row] } = await client.query(
      `INSERT INTO offer_campaigns(name,offer_id,segment_version_id,channels,copy,created_by,is_personalized)
       VALUES ('t',$1,$2,ARRAY['in_app'],'{}'::jsonb,$3,$4) RETURNING id,is_personalized`,
      [offer.id, versionId, ADMIN_ID, isPersonalized]);
    return row;
  }

  test('N-01: personalization is derived from the segment, not the admin flag', async () => {
    const broad = await segmentVersion({ roles: ['customer'], area: { type: 'country', value: 'US' } });
    const personal = await segmentVersion({ intents: ['plumbing'] });
    expect(broad.is_personalized).toBe(false);
    expect(personal.is_personalized).toBe(true);
    // Admin claims "broad" on an intent segment: the trigger overrides it.
    const forced = await campaign(personal.id, false);
    expect(forced.is_personalized).toBe(true);
    // Admin may still label a broad segment as personalized (stricter).
    const stricter = await campaign(broad.id, true);
    expect(stricter.is_personalized).toBe(true);
    const plain = await campaign(broad.id, false);
    expect(plain.is_personalized).toBe(false);
    const { rows: [updated] } = await client.query(
      'UPDATE offer_campaigns SET segment_version_id=$1 WHERE id=$2 RETURNING is_personalized',
      [personal.id, plain.id]);
    expect(updated.is_personalized).toBe(true);
  });

  test('D23: outreach requires a usable record licensed for marketing outreach', async () => {
    const base = `INSERT INTO prospect_businesses(source,source_record_id,business_name,country,license_ref,provenance,permitted_uses,usable,outreach_allowed)
                  VALUES ('lic','r1','Biz','US','L1','{}'::jsonb,$1,$2,$3)`;
    await expect(client.query('SAVEPOINT a').then(() =>
      client.query(base, [['supply_maps'], true, true]))).rejects.toThrow(/check/i);
    await client.query('ROLLBACK TO SAVEPOINT a');
    await expect(client.query(base, [['supply_maps', 'marketing_outreach'], true, true])).resolves.toBeTruthy();
    await client.query('SAVEPOINT b');
    await expect(client.query(
      `INSERT INTO prospect_businesses(source,source_record_id,business_name,country,license_ref,provenance,permitted_uses)
       VALUES ('lic','r2','Biz','US','L1','{}'::jsonb,ARRAY['resale'])`)).rejects.toThrow(/check/i);
    await client.query('ROLLBACK TO SAVEPOINT b');
  });

  test('D23: per-country B2B rules are seeded closed until legal review', async () => {
    const { rows } = await client.query(
      `SELECT code,b2b_email_basis,b2b_rules_reviewed_at FROM jurisdiction_rules
        WHERE code IN ('US','CA','GB','default') ORDER BY code`);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(byCode.US.b2b_email_basis).toBe('opt_out');
    expect(byCode.CA.b2b_email_basis).toBe('implied_or_consent');
    expect(byCode.default.b2b_email_basis).toBe('prohibited');
    for (const r of rows) expect(r.b2b_rules_reviewed_at).toBeNull();
  });

  test('D16: switch refuses without centroids, switches with them, and rolls back', async () => {
    const geo = require('../analytics/regionGeoSourceSwitch');
    await client.query('DELETE FROM geo_postal_centroids');
    const refused = await geo.switchToCentroids(client, { userId: ADMIN_ID });
    expect(refused).toMatchObject({ switched: false, reason: 'centroids_not_loaded' });
    expect(await geo.currentSource(client)).toBe('direct_geocode_cache');

    await client.query(
      `INSERT INTO geo_postal_centroids(country,postal_code,place_name,lat,lng,geog,h3_r5,h3_r7,source_version)
       VALUES ('US','10001','NY',40.75,-73.99,ST_SetSRID(ST_MakePoint(-73.99,40.75),4326)::geography,
               '852a1073fffffff','872a10728ffffff','t99989')`);
    const done = await geo.switchToCentroids(client, { userId: ADMIN_ID, sourceVersion: 't99989' });
    expect(done.switched).toBe(true);
    expect(await geo.currentSource(client)).toBe('geo_postal_centroids');
    const { rows: [notice] } = await client.query(
      'SELECT title_key, params FROM admin_operational_notices WHERE id=$1', [done.noticeId]);
    expect(notice.title_key).toBe('adminOperationalNotices.regionGeoSource.switchedTitle');
    expect(notice.params.source_version).toBe('t99989');

    const back = await geo.rollback(client, { userId: ADMIN_ID });
    expect(back).toMatchObject({ rolledBack: true, to: 'direct_geocode_cache' });
    expect(await geo.currentSource(client)).toBe('direct_geocode_cache');
    const { rows: modes } = await client.query(
      `SELECT mode FROM region_geo_source_switches ORDER BY id`);
    expect(modes.map((m) => m.mode)).toEqual(['dry_run', 'switch', 'rollback']);
  });
});
