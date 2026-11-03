'use strict';

// Gap fill 3-4 (PR #679 audit) on PostgreSQL: sanctions match details for
// the compliance queue, and audited sensitive reads (sanctions matches and
// name search, safeguarding export, SAR filing pack, wind-down holder list)
// where a failed audit write means nothing is served.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_LICENCE_GAP_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');

jest.setTimeout(120000);

test('licence gap-fill DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('credit licence gap fill (sanctions details, audited reads)', () => {
  let pool;
  let app;
  let admin;
  let request;
  const audit = () => require('../services/creditCompliance/audit');

  async function createUser(role) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'x', 'Gap', 'Fill', $3)`,
      [id, `gapfill-${role}-${id}@example.invalid`, role]
    );
    return id;
  }
  async function auditCount(actionType, resourceId) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM oxsteed_credit_audit_events WHERE action_type = $1 AND resource_id = $2 AND actor_user_id = $3',
      [actionType, String(resourceId), admin]
    );
    return rows[0].n;
  }

  beforeAll(async () => {
    pool = require('../db');
    admin = await createUser('super_admin');
    const express = require('express');
    const { errorHandler } = require('../middleware/errorHandler');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: admin, role: 'super_admin' }; next(); });
    app.use('/', require('../routes/creditLicenceAdmin'));
    app.use(errorHandler);
    request = require('supertest');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await pool.end?.(); });

  async function seedScreening() {
    const customer = await createUser('customer');
    const source = `gapfill_${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO credit_sanctions_list_sources (id, display_name, authority, format, enabled, required)
       VALUES ($1, 'Gap fill test list', 'Test authority', 'custom', FALSE, FALSE)`, [source]
    );
    const { rows: [version] } = await pool.query(
      `INSERT INTO credit_sanctions_list_versions (source_id, sha256, entry_count, name_count, published_at, ingested_via)
       VALUES ($1, $2, 1, 2, NOW() - INTERVAL '1 day', 'custom') RETURNING id`, [source, 'a'.repeat(64)]
    );
    const { rows: [entry] } = await pool.query(
      `INSERT INTO credit_sanctions_list_entries (source_id, version_id, external_id, entry_type, primary_name, programs, countries, birth_dates)
       VALUES ($1, $2, 'GF-1', 'individual', 'Jean Baptiste Doe', '{SDN}', '{HT}', '{1970-01-01}') RETURNING id`, [source, version.id]
    );
    await pool.query(
      `INSERT INTO credit_sanctions_list_names (entry_id, source_id, name, normalized, is_primary, strength)
       VALUES ($1, $2, 'Jean Baptiste Doe', 'jean baptiste doe', TRUE, 'strong'), ($1, $2, 'J. B. Doe', 'j b doe', FALSE, 'weak')`,
      [entry.id, source]
    );
    const { rows: [screening] } = await pool.query(
      `INSERT INTO oxsteed_credit_sanctions_screenings (subject_type, subject_id, provider, result, hit_context, screened_name, top_score, list_versions)
       VALUES ('customer', $1, 'in_house_lists', 'hit', 'Possible list match', 'Jean B Doe', 0.93, $2::jsonb) RETURNING id`,
      [customer, JSON.stringify({ [source]: version.id })]
    );
    await pool.query(
      `INSERT INTO credit_sanctions_screening_matches
         (screening_id, source_id, version_id, entry_id, external_id, query_name, matched_name, score, entry_type, programs, countries, birth_dates)
       VALUES ($1, $2, $3, $4, 'GF-1', 'Jean B Doe', 'J. B. Doe', 0.81, 'individual', '{SDN}', '{HT}', '{1970-01-01}'),
              ($1, $2, $3, $4, 'GF-1', 'Jean B Doe', 'Jean Baptiste Doe', 0.93, 'individual', '{SDN}', '{HT}', '{1970-01-01}')`,
      [screening.id, source, version.id, entry.id]
    );
    return { customer, source, versionId: version.id, screeningId: screening.id };
  }

  test('gap fill 3: match details carry the list entry, source, version, score and matched field', async () => {
    const seeded = await seedScreening();
    const res = await request(app).get(`/sanctions/screenings/${seeded.screeningId}/matches`).expect(200);
    expect(res.body.screening).toMatchObject({ id: seeded.screeningId, subject_type: 'customer', screened_name: 'Jean B Doe', top_score: '0.9300' });
    expect(res.body.matches).toHaveLength(2);
    const [best, alias] = res.body.matches;
    expect(best).toMatchObject({
      source_id: seeded.source, source_name: 'Gap fill test list', source_authority: 'Test authority',
      version_id: seeded.versionId, version_sha256: 'a'.repeat(64), external_id: 'GF-1',
      matched_name: 'Jean Baptiste Doe', primary_name: 'Jean Baptiste Doe', score: '0.9300',
      programs: ['SDN'], countries: ['HT'], birth_dates: ['1970-01-01'], matched_fields: ['primary_name'],
    });
    expect(alias).toMatchObject({ matched_name: 'J. B. Doe', score: '0.8100', matched_fields: ['alias', 'weak_alias'] });
    expect(await auditCount('credit.sanctions.matches_viewed', seeded.screeningId)).toBe(1);
    const { rows: [evt] } = await pool.query(
      `SELECT customer_id FROM oxsteed_credit_audit_events WHERE action_type = 'credit.sanctions.matches_viewed' AND resource_id = $1`, [seeded.screeningId]
    );
    expect(evt.customer_id).toBe(seeded.customer);
    await request(app).get(`/sanctions/screenings/${crypto.randomUUID()}/matches`).expect(404);
  });

  test('gap fill 4: a failed audit write fails the read and returns no data', async () => {
    const seeded = await seedScreening();
    jest.spyOn(audit(), 'insertComplianceAudit').mockRejectedValue(new Error('audit store unavailable'));
    const res = await request(app).get(`/sanctions/screenings/${seeded.screeningId}/matches`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('Jean Baptiste Doe');
    const csv = await request(app).get('/safeguarding/export?from=2026-01-01&to=2026-01-31');
    expect(csv.status).toBe(500);
    expect(csv.headers['content-disposition']).toBeUndefined();
    const search = await request(app).get('/sanctions/search?q=Jean%20Baptiste%20Doe');
    expect(search.status).toBe(500);
    expect(search.body.matches).toBeUndefined();
  });

  test('gap fill 4: sanctions search, safeguarding export, SAR pack and wind-down holders are audited', async () => {
    const q = 'Jean Baptiste Doe';
    const search = await request(app).get(`/sanctions/search?q=${encodeURIComponent(q)}`).expect(200);
    expect(Array.isArray(search.body.matches)).toBe(true);
    const hash = crypto.createHash('sha256').update(q.toLowerCase()).digest('hex');
    expect(await auditCount('credit.sanctions.name_searched', hash.slice(0, 32))).toBeGreaterThanOrEqual(1);
    const { rows: [searched] } = await pool.query(
      `SELECT reason, metadata FROM oxsteed_credit_audit_events WHERE action_type = 'credit.sanctions.name_searched' AND resource_id = $1 ORDER BY id DESC LIMIT 1`,
      [hash.slice(0, 32)]
    );
    expect(searched.metadata).toMatchObject({ querySha256: hash, queryLength: q.length });
    expect(JSON.stringify(searched)).not.toContain(q);

    const csv = await request(app).get('/safeguarding/export?from=2026-01-01&to=2026-01-31').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(await auditCount('credit.safeguarding.exported', '2026-01-01..2026-01-31')).toBeGreaterThanOrEqual(1);

    const customer = await createUser('customer');
    const { rows: [kase] } = await pool.query(
      `INSERT INTO oxsteed_credit_compliance_cases (case_type, subject_type, subject_id, severity, status, sla_due_at, dedupe_key)
       VALUES ('manual', 'customer', $1, 'high', 'open', NOW() + INTERVAL '2 days', $2) RETURNING id`, [customer, `gapfill:${customer}`]
    );
    const sar = await require('../services/creditCompliance/sarService').createDraft({ actorUserId: admin, caseIds: [kase.id], narrative: 'Gap fill test narrative' });
    const pack = await request(app).get(`/sar/${sar.id}/pack`).expect(200);
    expect(pack.headers['x-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(await auditCount('credit.sar.pack_downloaded', sar.id)).toBe(1);

    const holders = await request(app).get('/wind-down/999999999/holders?status=pending').expect(200);
    expect(holders.body.holders).toEqual([]);
    expect(await auditCount('credit.wind_down.holders_viewed', '999999999')).toBe(1);
  });
});
