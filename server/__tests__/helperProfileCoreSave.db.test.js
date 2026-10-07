'use strict';

// PS-1 / PS-7 regression: real migrated PostgreSQL (disposable
// credit_statement_test database only). Exercises the actual
// INSERT ... ON CONFLICT upsert in PUT /api/helper-profile/core, which used
// to fail for every Profile Studio and AI Knowledge save because
// booking_buffer_minutes (NOT NULL DEFAULT 0) received NULL in VALUES when the
// client did not send it. Postgres checks NOT NULL on the proposed insert row
// before conflict resolution, so existing profiles failed too.
jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('HELPER_PROFILE_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
process.env.JWT_SECRET = 'synthetic-helper-profile-jwt-key-32-chars!!';
const describeDatabase = database ? describe : describe.skip;

jest.mock('../services/helperContext', () => ({ invalidateHelperContext: jest.fn() }));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../db');

jest.setTimeout(60000);

test('helper profile DB integration requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('PUT /api/helper-profile/core against migrated PostgreSQL', () => {
  let app;
  const created = [];

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/helper-profile', require('../routes/helperProfile'));
  });

  afterAll(async () => {
    if (created.length) {
      await pool.query('DELETE FROM helper_profiles WHERE user_id = ANY($1::uuid[])', [created]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [created]);
    }
    await pool.end();
  });

  async function helper({ withProfile = false } = {}) {
    const id = crypto.randomUUID();
    created.push(id);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, didit_status, created_at)
       VALUES ($1, $2, 'synthetic-unusable', 'Synthetic', 'Helper', 'helper', TRUE, TRUE, 'verified', NOW())`,
      [id, `${id}@example.invalid`],
    );
    if (withProfile) {
      await pool.query(
        `INSERT INTO helper_profiles (user_id, profile_headline, booking_buffer_minutes, flat_rate_available)
         VALUES ($1, 'Existing headline', 30, TRUE)`,
        [id],
      );
    }
    const token = jwt.sign({ id, role: 'helper' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    return { id, auth: { Authorization: `Bearer ${token}` } };
  }

  async function profileRow(id) {
    const { rows } = await pool.query(
      `SELECT profile_headline, bio_short, booking_buffer_minutes, flat_rate_available, ai_knowledge, is_listed
         FROM helper_profiles WHERE user_id = $1`,
      [id],
    );
    return rows[0];
  }

  test('Studio core save succeeds for a NEW profile without booking_buffer_minutes', async () => {
    const h = await helper();
    const res = await request(app).put('/api/helper-profile/core').set(h.auth)
      .send({ profile_headline: 'Fresh helper', bio_short: 'Short bio' });
    expect(res.status).toBe(200);
    const row = await profileRow(h.id);
    expect(row.profile_headline).toBe('Fresh helper');
    expect(row.booking_buffer_minutes).toBe(0);
  });

  test('Studio core save succeeds for an EXISTING profile and preserves omitted fields', async () => {
    const h = await helper({ withProfile: true });
    const res = await request(app).put('/api/helper-profile/core').set(h.auth)
      .send({ bio_short: 'Updated bio' });
    expect(res.status).toBe(200);
    const row = await profileRow(h.id);
    expect(row.bio_short).toBe('Updated bio');
    expect(row.profile_headline).toBe('Existing headline');
    expect(row.booking_buffer_minutes).toBe(30);
    expect(row.flat_rate_available).toBe(true);
  });

  test('AI Knowledge save (ai_knowledge only) succeeds on new and existing profiles', async () => {
    const fresh = await helper();
    const existing = await helper({ withProfile: true });
    for (const h of [fresh, existing]) {
      const res = await request(app).put('/api/helper-profile/core').set(h.auth)
        .send({ ai_knowledge: 'We service tankless water heaters.' });
      expect(res.status).toBe(200);
      expect((await profileRow(h.id)).ai_knowledge).toBe('We service tankless water heaters.');
    }
    expect((await profileRow(existing.id)).booking_buffer_minutes).toBe(30);
  });

  test('an explicit booking_buffer_minutes is stored', async () => {
    const h = await helper({ withProfile: true });
    const res = await request(app).put('/api/helper-profile/core').set(h.auth)
      .send({ booking_buffer_minutes: 45 });
    expect(res.status).toBe(200);
    expect((await profileRow(h.id)).booking_buffer_minutes).toBe(45);
  });

  test('PS-7: GET /me returns is_listed and reflects PATCH /listing', async () => {
    const h = await helper({ withProfile: true });
    let me = await request(app).get('/api/helper-profile/me').set(h.auth);
    expect(me.status).toBe(200);
    expect(me.body.is_listed).toBe(true);

    const patch = await request(app).patch('/api/helper-profile/listing').set(h.auth).send({ is_listed: false });
    expect(patch.status).toBe(200);
    expect(patch.body.is_listed).toBe(false);

    me = await request(app).get('/api/helper-profile/me').set(h.auth);
    expect(me.body.is_listed).toBe(false);
  });
});
