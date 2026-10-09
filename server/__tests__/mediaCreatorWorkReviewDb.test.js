'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Pool } = jest.requireActual('pg');
const { openWorkReview, activeWorkReview, assertNoWorkReview } = require('../services/mediaCreatorWorkReviewService');

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (process.env.STATEMENT_REQUIRE_DB_TESTS === 'true' && !url) throw new Error('Disposable Media database required');
const describeDb = url ? describe : describe.skip;

describeDb('Media creator work-review migration and history in PostgreSQL', () => {
  const schema = `media_work_review_test_${randomUUID().replaceAll('-', '')}`;
  const payer = randomUUID();
  const creator = randomUUID();
  const administrator = randomUUID();
  const actor = randomUUID();
  const gig = randomUUID();
  const application = randomUUID();
  let setup;
  let db;
  let migration;

  beforeAll(async () => {
    if (!/\/credit_statement_test(?:\?|$)/.test(url)) throw new Error('Use only credit_statement_test');
    setup = new Pool({ connectionString: url });
    await setup.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 5 });
    // Referenced prerequisite keys are minimal; this suite verifies the real
    // marketplace DDL/service against PostgreSQL, not Credit ledger accounting.
    await db.query(`CREATE TABLE users (id UUID PRIMARY KEY);
      CREATE TABLE media_actors (id UUID PRIMARY KEY);
      CREATE TABLE media_posts (id UUID PRIMARY KEY);
      CREATE TABLE oxsteed_credit_reservations (id UUID PRIMARY KEY);
      CREATE TABLE oxsteed_credit_transactions (id UUID PRIMARY KEY)`);
    const dir = path.resolve(__dirname, '../migrations');
    for (const number of [740, 745, 746, 747, 748]) {
      const file = fs.readdirSync(dir).find(name => name.startsWith(`${number}_`));
      await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    }
    await db.query('INSERT INTO users(id) VALUES ($1),($2),($3)', [payer, creator, administrator]);
    await db.query('INSERT INTO media_actors(id) VALUES ($1)', [actor]);
    await db.query(`INSERT INTO media_creator_gigs(id,owner_user_id,owner_actor_id,title,brief,budget_cents,status,award_amount_cents)
      VALUES ($1,$2,$3,'Synthetic gig','Synthetic brief',500,'awarded',400)`, [gig, payer, actor]);
    await db.query(`INSERT INTO media_creator_applications(id,gig_id,applicant_user_id,applicant_actor_id,pitch,proposed_cents,status)
      VALUES ($1,$2,$3,$4,'Synthetic pitch',400,'awarded')`, [application, gig, creator, actor]);
    const file = fs.readdirSync(dir).find(name => name.startsWith('749_'));
    migration = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.query(migration);
  });
  afterAll(async () => {
    if (db) await db.end();
    if (setup) {
      await setup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await setup.end();
    }
  });

  const input = referenceId => ({ kind: 'gig', referenceId, requesterUserId: payer,
    payerUserId: payer, creatorUserId: creator, reason: 'Synthetic delivered-work contest' });

  test('749 upgrades awarded work, preserves data on repeat, and retains linked acceptance/history', async () => {
    const before = (await db.query('SELECT * FROM media_creator_gigs WHERE id=$1', [gig])).rows[0];
    expect(before).toMatchObject({ status: 'awarded', budget_cents: 500, award_amount_cents: 400, awarded_application_id: null });
    expect((await db.query('SELECT accepted_at FROM media_creator_applications WHERE id=$1', [application])).rows[0].accepted_at).toBeNull();
    await db.query('UPDATE media_creator_applications SET accepted_at=NOW() WHERE id=$1', [application]);
    await db.query('UPDATE media_creator_gigs SET awarded_application_id=$2 WHERE id=$1', [gig, application]);
    const review = await openWorkReview(db, input(gig));
    await db.query(`UPDATE media_creator_work_reviews SET status='resumed',decision_reason='Synthetic admin revision',resolved_by=$2,resolved_at=NOW()
      WHERE id=$1`, [review.id, administrator]);
    const snapshot = (await db.query('SELECT * FROM media_creator_work_reviews WHERE id=$1', [review.id])).rows[0];
    const acceptedAt = (await db.query('SELECT accepted_at FROM media_creator_applications WHERE id=$1', [application])).rows[0].accepted_at;
    await db.query(migration);
    expect((await db.query('SELECT * FROM media_creator_work_reviews WHERE id=$1', [review.id])).rows[0]).toEqual(snapshot);
    expect((await db.query('SELECT accepted_at FROM media_creator_applications WHERE id=$1', [application])).rows[0].accepted_at).toEqual(acceptedAt);
    expect((await db.query('SELECT budget_cents,award_amount_cents,status,awarded_application_id FROM media_creator_gigs WHERE id=$1', [gig])).rows[0])
      .toEqual({ budget_cents: 500, award_amount_cents: 400, status: 'awarded', awarded_application_id: application });
  });

  test('real constraints reject invalid kind, short reason, missing identities, and broken award pointer', async () => {
    const values = [randomUUID(), payer, payer, creator];
    const insert = (kind, reason, requester = payer) => db.query(`INSERT INTO media_creator_work_reviews
      (kind,reference_id,requester_user_id,payer_user_id,creator_user_id,reason) VALUES ($1,$2,$3,$4,$5,$6)`,
    [kind, values[0], requester, payer, creator, reason]);
    await expect(insert('unknown', 'Synthetic reason')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('gig', 'x')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('gig', 'Synthetic reason', randomUUID())).rejects.toMatchObject({ code: '23503' });
    await expect(db.query('UPDATE media_creator_gigs SET awarded_application_id=$2 WHERE id=$1', [gig, randomUUID()]))
      .rejects.toMatchObject({ code: '23503' });
  });

  test('same-work concurrent requests resolve to one open review under the actual work lock', async () => {
    const create = async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM media_creator_gigs WHERE id=$1 FOR UPDATE', [gig]);
        const review = await openWorkReview(client, input(gig));
        await client.query('COMMIT');
        return review;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    const reviews = await Promise.all([create(), create()]);
    expect(reviews[0].id).toBe(reviews[1].id);
    expect(reviews[0]).toMatchObject({ requester_user_id: payer, payer_user_id: payer, creator_user_id: creator, status: 'open' });
    expect((await db.query(`SELECT COUNT(*)::int AS count FROM media_creator_work_reviews WHERE kind='gig' AND reference_id=$1 AND status='open'`, [gig])).rows[0].count).toBe(1);
    await expect(assertNoWorkReview(db, 'gig', gig)).rejects.toMatchObject({ code: 'media_creator_work_review_pending' });
    await expect(db.query(`INSERT INTO media_creator_work_reviews(kind,reference_id,requester_user_id,payer_user_id,creator_user_id,reason)
      VALUES ('gig',$1,$2,$2,$3,'Duplicate synthetic contest')`, [gig, payer, creator])).rejects.toMatchObject({ code: '23505' });
  });

  test('resolving a review permits another case while keeping all party and decision history', async () => {
    const historyRef = randomUUID();
    const previous = await openWorkReview(db, input(historyRef));
    await db.query(`UPDATE media_creator_work_reviews SET status='released',decision_reason='Synthetic reviewed release',resolved_by=$2,resolved_at=NOW()
      WHERE id=$1`, [previous.id, administrator]);
    expect(await activeWorkReview(db, 'gig', historyRef)).toBeNull();
    await expect(assertNoWorkReview(db, 'gig', historyRef)).resolves.toBeUndefined();
    const reopened = await openWorkReview(db, { ...input(historyRef), requesterUserId: creator, reason: 'Synthetic subsequent creator contest' });
    expect(reopened.id).not.toBe(previous.id);
    expect(reopened.requester_user_id).toBe(creator);
    const historical = (await db.query('SELECT * FROM media_creator_work_reviews WHERE id=$1', [previous.id])).rows[0];
    expect(historical).toMatchObject({ status: 'released', resolved_by: administrator,
      decision_reason: 'Synthetic reviewed release', requester_user_id: payer, payer_user_id: payer, creator_user_id: creator });
    await db.query(migration);
    expect((await db.query('SELECT * FROM media_creator_work_reviews WHERE id=$1', [previous.id])).rows[0]).toEqual(historical);
    expect((await db.query('SELECT COUNT(*)::int AS count FROM media_creator_work_reviews WHERE reference_id=$1', [historyRef])).rows[0].count).toBe(2);
  });
});
