'use strict';

process.env.DIDIT_API_KEY = 'test-didit-key';

// Item 2: identity gate on helper listing, against real migrated
// PostgreSQL (disposable credit_statement_test database only).
// Two levels: (a) toggleListing called directly with the real pool,
// proving the controller's own listing_requires_identity_verification
// gate; (b) the HTTP routes end to end, proving a verified helper can
// list and an unverified (Didit-skipped) helper cannot.

jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('HELPER_LISTING_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
process.env.JWT_SECRET = 'test-secret';
const describeDatabase = database ? describe : describe.skip;

jest.mock('../services/helperContext', () => ({ invalidateHelperContext: jest.fn() }));
// No saved-search fan-out side effects in tests.
jest.mock('../routes/savedSearches', () => ({}));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { toggleListing } = require('../controllers/helpersController');

jest.setTimeout(60000);

test('helper listing DB integration requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('helper listing identity gate against migrated PostgreSQL', () => {
  let app;
  const created = [];

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/helpers', require('../routes/helpers'));
    app.use('/api/helper-profile', require('../routes/helperProfile'));
  });

  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM helper_profiles WHERE user_id = ANY($1::uuid[])', [created]);
      // Do not DELETE FROM users: the append-only ledger rule blocks
      // cascades for rows with ledger references; synthetic users stay.
    }
    await pool.end();
  });

  async function helper({ identity = 'none' } = {}) {
    const id = crypto.randomUUID();
    created.push(id);
    const didit = identity === 'verified'
      ? { status: 'verified', at: 'NOW()' }
      : identity === 'skipped'
        ? { status: 'skipped', at: 'NULL' }
        : { status: null, at: 'NULL' };
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role,
         email_verified, is_active, terms_accepted, terms_accepted_at, terms_version,
         profile_completed, contact_completed, onboarding_completed,
         id_verified, identity_verified, didit_status, didit_verified_at, created_at)
       VALUES ($1, $2, 'synthetic-unusable', 'Synthetic', 'Helper', 'helper',
         TRUE, TRUE, TRUE, NOW(), 'v1',
         TRUE, TRUE, TRUE,
         $3, $4, $5, ${didit.at}, NOW())`,
      [id, `${id}@example.invalid`, identity === 'verified', identity === 'verified', didit.status],
    );
    await pool.query(
      'INSERT INTO helper_profiles (user_id, is_listed) VALUES ($1, FALSE)',
      [id],
    );
    const token = jwt.sign({ id, role: 'helper' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    return { id, auth: { Authorization: `Bearer ${token}` } };
  }

  async function listedFlag(id) {
    const { rows } = await pool.query('SELECT is_listed FROM helper_profiles WHERE user_id = $1', [id]);
    return rows[0] && rows[0].is_listed;
  }

  function callToggle(id, isListed) {
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();
    return toggleListing({ user: { id }, body: { is_listed: isListed } }, res, next)
      .then(() => ({ res, next }));
  }

  test('controller: general-flow helper without identity gets 403 listing_requires_identity_verification', async () => {
    const h = await helper({ identity: 'none' });
    const { next } = await callToggle(h.id, true);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode || err.status).toBe(403);
    expect(err.code).toBe('listing_requires_identity_verification');
    expect(await listedFlag(h.id)).toBe(false);
  });

  test('controller: verified helper can list and the row flips', async () => {
    const h = await helper({ identity: 'verified' });
    const { res, next } = await callToggle(h.id, true);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, is_listed: true });
    expect(await listedFlag(h.id)).toBe(true);
  });

  test('controller: unlisting is never gated for an unverified helper', async () => {
    const h = await helper({ identity: 'none' });
    const { res, next } = await callToggle(h.id, false);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, is_listed: false });
  });

  test('route: verified helper lists through PUT /api/helpers/me/listing', async () => {
    const h = await helper({ identity: 'verified' });
    const res = await request(app).put('/api/helpers/me/listing').set(h.auth).send({ is_listed: true });
    expect(res.status).toBe(200);
    expect(res.body.is_listed).toBe(true);
    expect(await listedFlag(h.id)).toBe(true);
  });

  test('route: Didit-skipped helper cannot list through PUT /api/helpers/me/listing', async () => {
    const h = await helper({ identity: 'skipped' });
    const res = await request(app).put('/api/helpers/me/listing').set(h.auth).send({ is_listed: true });
    expect(res.status).toBe(403);
    expect(await listedFlag(h.id)).toBe(false);
  });
});
