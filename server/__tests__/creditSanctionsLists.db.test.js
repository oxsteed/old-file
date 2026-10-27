'use strict';

// Licence readiness: in-house sanctions screening on a real PostgreSQL.
// Proves list ingestion (OFAC/UN/EU/UK/SEMA fixtures cut from the official
// publications), fuzzy matching, fail-closed staleness, sticky confirmed
// hits, the two-person custom list, the trigger-fed screening queue and the
// targeted rescreen after a list update.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CREDIT_SANCTIONS_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.OXSTEED_CREDIT_SANCTIONS_PROVIDER = 'in_house_lists';
}
const describeDatabase = database ? describe : describe.skip;

// The checker's TOTP step-up is covered by creditStepupTotp tests; here we
// only prove the two-person rule and the executor.
jest.mock('../services/stepupChallengeService', () => ({
  ...jest.requireActual('../services/stepupChallengeService'),
  verifyStepupChallenge: jest.fn(async () => ({ verified: true })),
}));

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

jest.setTimeout(180000);

const FIX = path.join(__dirname, 'fixtures', 'sanctions');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

test('sanctions list test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('in-house sanctions lists (licence readiness)', () => {
  let pool;
  let lists;
  let screening;
  let admin1;
  let admin2;

  async function createUser(first, last, country = 'HT') {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country)
       VALUES ($1, $2, 'synthetic-unusable', $3, $4, 'customer', $5)`,
      [id, `sanctions-${id}@example.invalid`, first, last, country]
    );
    return id;
  }

  async function resetLists() {
    await pool.query('UPDATE credit_sanctions_list_sources SET active_version_id = NULL, last_success_at = NULL, last_error = NULL');
    await pool.query('DELETE FROM credit_sanctions_list_entries');
    await pool.query('DELETE FROM credit_sanctions_list_versions');
  }

  async function ingestAll() {
    await lists.ingestFile('ofac_sdn', { primary: read('ofac_sdn.csv'), aux: read('ofac_alt.csv') });
    await lists.ingestFile('ofac_cons', { primary: read('ofac_sdn.csv').split('\n').slice(0, 1).join('\n') });
    await lists.ingestFile('un', { primary: read('un.xml') });
    await lists.ingestFile('eu', { primary: read('eu.xml') });
    await lists.ingestFile('uk', { primary: read('uk.xml') });
    await lists.ingestFile('ca_sema', { primary: read('sema.xml') });
  }

  beforeAll(async () => {
    pool = require('../db');
    lists = require('../services/creditCompliance/sanctionsListService');
    screening = require('../services/sanctionsScreeningService');
    await resetLists();
    admin1 = await createUser('Admin', 'One', 'US');
    admin2 = await createUser('Admin', 'Two', 'US');
  });

  afterAll(async () => {
    await resetLists();
    await pool.end();
  });

  test('screening fails closed while required lists are missing', async () => {
    const id = await createUser('Marie', 'Clean');
    await expect(screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: id }))
      .rejects.toMatchObject({ statusCode: 503, code: 'credit_sanctions_screening_unavailable' });
  });

  test('ingests every official format and records versions', async () => {
    await ingestAll();
    const sources = await lists.listSources(pool);
    const byId = Object.fromEntries(sources.map((s) => [s.id, s]));
    expect(byId.un.entry_count).toBe(5);
    expect(byId.ofac_sdn.entry_count).toBe(5);
    expect(byId.eu.entry_count).toBe(2);
    expect(byId.uk.entry_count).toBe(2);
    expect(byId.ca_sema.entry_count).toBe(2);
    expect(byId.un.fresh).toBe(true);
    expect(await lists.staleRequiredSources(pool)).toEqual([]);
    // Same content again: unchanged, no new version.
    const again = await lists.ingestFile('un', { primary: read('un.xml') });
    expect(again.unchanged).toBe(true);
  });

  test('refuses a truncated publication and keeps the active version', async () => {
    const before = (await lists.listSources(pool)).find((s) => s.id === 'un');
    const truncated = read('un.xml').replace(/<INDIVIDUAL>[\s\S]*<\/INDIVIDUAL>/, '');
    const result = await lists.ingestFile('un', { primary: truncated });
    expect(result.rejected).toBe(true);
    const after = (await lists.listSources(pool)).find((s) => s.id === 'un');
    expect(after.active_version_id).toBe(before.active_version_id);
  });

  test('a clean customer clears and the evidence names the list versions', async () => {
    const id = await createUser('Marie-Claire', 'Dorvilien');
    const result = await screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: id });
    expect(result.screening.provider).toBe('in_house_lists');
    expect(result.screening.result).toBe('clear');
    const { rows } = await pool.query('SELECT list_versions FROM oxsteed_credit_sanctions_screenings WHERE id = $1', [result.screening.id]);
    expect(rows[0].list_versions.map((v) => v.source).sort()).toEqual(['ca_sema', 'eu', 'ofac_cons', 'ofac_sdn', 'uk', 'un']);
  });

  test('a listed Haitian gang leader is a hit, even with reordered and accented names', async () => {
    const id = await createUser('Jîmmy', 'Chérizier');
    await expect(screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: id }))
      .rejects.toMatchObject({ statusCode: 403, code: 'credit_sanctions_match' });
    const { rows } = await pool.query(
      `SELECT m.source_id, m.external_id, m.score FROM credit_sanctions_screening_matches m
         JOIN oxsteed_credit_sanctions_screenings s ON s.id = m.screening_id
        WHERE s.subject_id = $1 ORDER BY m.score DESC`,
      [id]
    );
    expect(rows.map((r) => r.source_id)).toEqual(expect.arrayContaining(['un', 'ofac_sdn']));
    expect(Number(rows[0].score)).toBeGreaterThanOrEqual(0.88);
  });

  test('a confirmed true match stays blocking through forced rescreens', async () => {
    const id = await createUser('Fednel', 'Monchery');
    await expect(screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: id })).rejects.toMatchObject({ statusCode: 403 });
    const latest = await screening.getLatestScreening(pool, { subjectType: 'customer', subjectId: id });
    await screening.decideSanctionsScreening({ screeningId: latest.id, decision: 'confirm', actorUserId: admin1, reason: 'Matches OFAC GLOMAG designation' });
    // Even if the name changes, a forced rescreen returns the confirmed hit.
    await pool.query(`UPDATE users SET first_name = 'Totally', last_name = 'Different' WHERE id = $1`, [id]);
    const row = await screening.screenSubjectIfStale(pool, { subjectType: 'customer', subjectId: id, force: true });
    expect(row.id).toBe(latest.id);
    await expect(screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: id })).rejects.toMatchObject({ statusCode: 403 });
  });

  test('stale required list makes screening fail closed again', async () => {
    const id = await createUser('Paul', 'Fresh');
    await pool.query(`UPDATE credit_sanctions_list_sources SET last_success_at = NOW() - INTERVAL '30 days' WHERE id = 'eu'`);
    try {
      await expect(screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: id }))
        .rejects.toMatchObject({ statusCode: 503 });
    } finally {
      await pool.query(`UPDATE credit_sanctions_list_sources SET last_success_at = NOW() WHERE id = 'eu'`);
    }
  });

  test('signup enqueues a screening; the worker screens and opens a case on a hit', async () => {
    const id = await createUser('Renel', 'Destina');
    const { rows: queued } = await pool.query(
      `SELECT reason FROM credit_sanctions_screening_requests WHERE subject_id = $1 AND processed_at IS NULL`, [id]
    );
    expect(queued[0].reason).toBe('signup');
    const summary = await lists.processScreeningQueue({ limit: 500 });
    expect(summary.hits).toBeGreaterThanOrEqual(1);
    const { rows: cases } = await pool.query(
      `SELECT case_type FROM oxsteed_credit_compliance_cases WHERE subject_type = 'customer' AND subject_id = $1`, [id]
    );
    expect(cases.map((c) => c.case_type)).toContain('sanctions_hit');
  });

  test('custom list entries need two different administrators and feed screening', async () => {
    const pending = require('../services/oxsteedCreditPendingActionService');
    const requested = await pending.requestPendingAction({
      actionType: 'credit_sanctions_custom_entry_add',
      payload: { primaryName: 'Ti Makak Fictif', entryType: 'individual', legalBasis: 'Ordonnance test 2026-01', countries: ['HT'] },
      requestedBy: admin1,
      idempotencyKey: `custom-${crypto.randomUUID()}`,
    });
    const actionId = requested.pendingAction.id;
    await expect(pending.decideOversightAction({ actionId, decision: 'approve', decidedBy: admin1, reason: 'self' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'credit_self_approval_forbidden' });
    await pending.decideOversightAction({ actionId, decision: 'approve', decidedBy: admin2, reason: 'Verified the order' });
    await lists.rebuildCustomList();
    const matches = await lists.searchName(pool, 'Ti Makak Fictif');
    expect(matches[0]).toMatchObject({ sourceId: 'custom_ht' });
    await expect(pool.query(
      `INSERT INTO credit_sanctions_custom_entries (entry_type, primary_name, legal_basis, added_by, approved_by)
       VALUES ('individual', 'One Person', 'x', $1, $1)`, [admin1]
    )).rejects.toThrow(/credit_sanctions_custom_two_person/);
  });

  test('a list update rescreens only subjects close to the added names', async () => {
    const near = await createUser('Wilfrid', 'Testlistee');
    const far = await createUser('Anne', 'Unrelated');
    await screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: near });
    await screening.assertSanctionsClear(pool, { subjectType: 'customer', subjectId: far });
    await lists.rescreenAfterListChanges();
    await pool.query(`UPDATE credit_sanctions_screening_requests SET processed_at = NOW() WHERE processed_at IS NULL`);
    const updated = read('sema.xml').replace('</data-set>', `<record><Country>Haiti</Country><LastName>Testlistee</LastName><GivenName>Wilfrid</GivenName><EntityOrShip></EntityOrShip><Schedule>1</Schedule><Item>903</Item></record></data-set>`);
    const r = await lists.ingestFile('ca_sema', { primary: updated });
    expect(r.version.added_name_count).toBeGreaterThan(0);
    await lists.rescreenAfterListChanges();
    const { rows } = await pool.query(
      `SELECT subject_id FROM credit_sanctions_screening_requests WHERE reason = 'list_update' AND processed_at IS NULL AND subject_id = ANY($1)`,
      [[near, far]]
    );
    expect(rows.map((x) => x.subject_id)).toEqual([near]);
  });

  test('counterparty names are screened and a match is recorded even when the caller rolls back', async () => {
    await expect(lists.assertCounterpartyNameClear(pool, { name: 'CHERIZIER Jimmy', context: { reason: 'cashout' } }))
      .rejects.toMatchObject({ statusCode: 403, code: 'credit_sanctions_match' });
    const { rows } = await pool.query(
      `SELECT result FROM oxsteed_credit_sanctions_screenings WHERE subject_type = 'counterparty' AND screened_name = 'CHERIZIER Jimmy'`
    );
    expect(rows[0].result).toBe('hit');
    await expect(lists.assertCounterpartyNameClear(pool, { name: 'Roseline Augustin', context: {} })).resolves.toMatchObject({ clear: true });
  });
});
