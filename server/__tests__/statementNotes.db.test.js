'use strict';

// Isolated DB tests for migration 870 and the statement note service:
// CRUD, one-note-per-entry upsert, owner isolation, cross-user forbidden,
// attachment key scoping, and document ownership checks.
// Fixtures live in a NEW disposable schema, never in migrated
// customer/financial tables. The URL guard rejects production targets.

jest.unmock('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { createService } = require('../services/statementNoteService');

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/credit_statement_test') {
    throw new Error('Only an explicitly isolated statement test database is allowed');
  }
}
const describeDb = url ? describe : describe.skip;
const user = 'b279247f-65d1-4c3c-8ae7-a4cb5d951849';
const stranger = '5f0d0562-3cba-4632-8609-1d9daf43930e';
const docId = '11111111-2222-4333-8444-555555555555';
const strangerDocId = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describeDb('statement entry notes (migration 870)', () => {
  let root, db, service, schema;

  beforeAll(async () => {
    root = new Pool({ connectionString: url, max: 2 });
    schema = `statement_notes_test_${crypto.randomBytes(6).toString('hex')}`;
    await root.query(`CREATE SCHEMA ${schema}`);
    db = new Pool({ connectionString: url, max: 4, options: `-c search_path=${schema},public` });
    await db.query(`CREATE TABLE users(id uuid PRIMARY KEY);
      CREATE TABLE credit_statement_documents(id uuid PRIMARY KEY, customer_id uuid NOT NULL);
      CREATE TABLE settlement_statement_documents(id uuid PRIMARY KEY, product text NOT NULL,
        scope_helper_user_id uuid, scope_business_id bigint, scope_restaurant_id bigint);
      CREATE TABLE businesses(id bigint PRIMARY KEY, user_id uuid);
      CREATE TABLE business_members(business_id bigint, member_id uuid, status text, role text);
      CREATE TABLE food_restaurants(id bigint PRIMARY KEY, owner_user_id uuid, business_id bigint);
      INSERT INTO users VALUES ('${user}'),('${stranger}');
      INSERT INTO credit_statement_documents VALUES ('${docId}','${user}'),('${strangerDocId}','${stranger}');`);
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/870_statement_entry_notes.sql'), 'utf8'));
    service = createService({ db, storage: { getSignedDownloadUrl: async (key) => `https://signed.example/${key}` } });
  }, 30000);

  afterAll(async () => {
    await db?.end();
    if (schema) await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root?.end();
  }, 30000);

  beforeEach(async () => {
    await db.query('TRUNCATE statement_entry_notes');
  });

  test('migration creates the table with the owner-entry unique index', async () => {
    const { rows } = await db.query(`SELECT indexname FROM pg_indexes WHERE tablename='statement_entry_notes'`);
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('statement_entry_notes_owner_entry_uidx');
    expect(names).toContain('statement_entry_notes_owner_idx');
  });

  test('upsert creates then updates a single note per entry', async () => {
    const first = await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-1', note: 'first' });
    expect(first.note).toBe('first');
    expect(first.hasAttachment).toBe(false);
    const second = await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-1', note: 'second' });
    expect(second.id).toBe(first.id);
    expect(second.note).toBe('second');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM statement_entry_notes');
    expect(rows[0].n).toBe(1);
  });

  test('list filters by entry and hides other users notes', async () => {
    await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-1', note: 'mine' });
    await service.upsert(stranger, { product: 'oxsteed', documentId: strangerDocId, entryId: 'tx-9', note: 'theirs' });
    const mine = await service.list(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-1' });
    expect(mine).toHaveLength(1);
    expect(mine[0].note).toBe('mine');
    const empty = await service.list(user, { product: 'oxsteed', documentId: strangerDocId, entryId: 'tx-9' });
    expect(empty).toHaveLength(0);
    const allMine = await service.list(user, {});
    expect(allMine).toHaveLength(1);
  });

  test('remove deletes only the owners note; cross-user delete is forbidden', async () => {
    const note = await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-1', note: 'mine' });
    await expect(service.remove(stranger, note.id)).rejects.toMatchObject({ code: 'statement_note_not_found' });
    const stillThere = await service.list(user, { entryId: 'tx-1' });
    expect(stillThere).toHaveLength(1);
    await service.remove(user, note.id);
    expect(await service.list(user, { entryId: 'tx-1' })).toHaveLength(0);
  });

  test('note on another users document is rejected', async () => {
    await expect(service.upsert(user, { product: 'oxsteed', documentId: strangerDocId, entryId: 'tx-1', note: 'x' }))
      .rejects.toMatchObject({ code: 'statement_note_not_found' });
    await expect(service.upsert(user, { product: 'oxsteed', documentId: 'not-a-uuid', entryId: 'tx-1', note: 'x' }))
      .rejects.toMatchObject({ code: 'statement_note_not_found' });
  });

  test('interim statements (null document_id) skip the document check', async () => {
    const note = await service.upsert(user, { product: 'restaurant', documentId: null, entryId: 'tx-2', note: 'interim' });
    expect(note.documentId).toBeNull();
  });

  test('attachment key must live under the callers own upload prefix', async () => {
    await expect(service.upsert(user, {
      product: 'oxsteed', documentId: docId, entryId: 'tx-3', note: 'x',
      attachmentKey: 'user-uploads/someone-else/images/statement-note/r.png',
    })).rejects.toMatchObject({ code: 'statement_note_invalid_attachment' });
    await expect(service.upsert(user, {
      product: 'oxsteed', documentId: docId, entryId: 'tx-3', note: 'x',
      attachmentKey: `user-uploads/${user}/images/statement-note/r.png`,
    })).resolves.toMatchObject({ hasAttachment: true });
  });

  test('attachment removal clears the key; absence keeps it', async () => {
    const key = `user-uploads/${user}/images/statement-note/r.png`;
    const created = await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-4', note: 'x', attachmentKey: key });
    expect(created.hasAttachment).toBe(true);
    const kept = await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-4', note: 'y' });
    expect(kept.hasAttachment).toBe(true);
    const removed = await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-4', note: 'z', attachmentKey: '' });
    expect(removed.hasAttachment).toBe(false);
  });

  test('attachment redirect re-checks ownership and resolves a signed URL', async () => {
    const key = `user-uploads/${user}/images/statement-note/r.png`;
    const note = await service.upsert(user, { product: 'oxsteed', documentId: docId, entryId: 'tx-5', note: 'x', attachmentKey: key });
    await expect(service.attachmentRedirect(stranger, note.id)).rejects.toMatchObject({ code: 'statement_note_not_found' });
    const signed = await service.attachmentRedirect(user, note.id);
    expect(signed).toContain(key);
  });

  test('validation fails closed on bad product, entry, and text', async () => {
    await expect(service.upsert(user, { product: 'nope', entryId: 'tx-1', note: 'x' }))
      .rejects.toMatchObject({ code: 'statement_invalid_product' });
    await expect(service.upsert(user, { product: 'oxsteed', entryId: '', note: 'x' }))
      .rejects.toMatchObject({ code: 'statement_note_invalid_entry' });
    await expect(service.upsert(user, { product: 'oxsteed', entryId: 'tx-1', note: '   ' }))
      .rejects.toMatchObject({ code: 'statement_note_invalid_text' });
    await expect(service.upsert(user, { product: 'oxsteed', entryId: 'tx-1', note: 'x'.repeat(2001) }))
      .rejects.toMatchObject({ code: 'statement_note_invalid_text' });
  });

  test('settlement document ownership: helper scope matches the helper', async () => {
    const helperDoc = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await db.query(`INSERT INTO settlement_statement_documents VALUES ('${helperDoc}','helper_earnings','${stranger}',NULL,NULL)`);
    await expect(service.upsert(user, { product: 'helper_earnings', documentId: helperDoc, entryId: 'm-1', note: 'x' }))
      .rejects.toMatchObject({ code: 'statement_note_not_found' });
    const ownDoc = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    await db.query(`INSERT INTO settlement_statement_documents VALUES ('${ownDoc}','helper_earnings','${user}',NULL,NULL)`);
    await expect(service.upsert(user, { product: 'helper_earnings', documentId: ownDoc, entryId: 'm-1', note: 'ok' }))
      .resolves.toMatchObject({ note: 'ok' });
  });
});
