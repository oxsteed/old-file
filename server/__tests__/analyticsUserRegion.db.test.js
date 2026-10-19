'use strict';

// Confirmed-country flag (migration 908) and geo_radius matching for
// user-anchored analytics rows (users have no coordinates; a confirmed-US
// user's ZIP centroid from direct_geocode_cache is used).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = `user_region_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const { applyRegionScope, userCountryBreakdown } = require('../analytics/regionScope');

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '908_users_country_confirmation.sql'), 'utf8')
  // Functions are created in the test schema, not public.
  .replace(/CREATE OR REPLACE FUNCTION /g, `CREATE OR REPLACE FUNCTION ${schema}.`)
  .replace(/EXECUTE FUNCTION users_country_confirmation/g, `EXECUTE FUNCTION ${schema}.users_country_confirmation`)
  .replace(/ users_us_address_evidence\(/g, ` ${schema}.users_us_address_evidence(`);

(url ? describe : describe.skip)('user country confirmation and user-anchored regions', () => {
  const ids = {};
  const add = async (key, fields) => {
    ids[key] = crypto.randomUUID();
    const cols = ['id', ...Object.keys(fields)];
    const vals = [ids[key], ...Object.values(fields)];
    await db.query(`INSERT INTO users(${cols.join(',')}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
  };
  const row = async (key) => (await db.query('SELECT country_confirmed, country_confirmation_source FROM users WHERE id=$1', [ids[key]])).rows[0];
  const scopedUsers = async (regions) => {
    const built = applyRegionScope({ text: 'SELECT user_id FROM consulting_sessions ORDER BY user_id', params: [] }, { global: false, regions });
    const { rows } = await db.query(built.text, built.params);
    return new Set(rows.map((r) => r.user_id));
  };

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users(id UUID PRIMARY KEY, phone TEXT, zip_code TEXT, city TEXT, state TEXT,
      country VARCHAR(2) NOT NULL DEFAULT 'US')`);
    await db.query(`CREATE TABLE ${schema}.direct_geocode_cache(query TEXT PRIMARY KEY, label TEXT, zip_code TEXT, lat NUMERIC, lng NUMERIC,
      provider TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.consulting_sessions(id SERIAL PRIMARY KEY, user_id UUID)`);
    await add('legacyUs', { zip_code: '60601', state: 'IL' });            // default US, no phone: unconfirmed
    await db.query(migration);                                              // backfill + trigger
    await add('haiti', { country: 'HT', state: 'Ouest' });
    await add('defaulted', { zip_code: '60601', city: 'Chicago', state: 'IL' });
    await add('usEvidence', { phone: '+1 (312) 555-0101', zip_code: '60601', city: 'Chicago', state: 'IL' });
    await add('usFar', { phone: '+13055550101', zip_code: '33101', city: 'Miami', state: 'FL' });
    await db.query(`INSERT INTO direct_geocode_cache(query, zip_code, lat, lng) VALUES('60601', '60601', 41.886, -87.618), ('33101', '33101', 25.779, -80.198)`);
    for (const k of Object.keys(ids)) await db.query('INSERT INTO consulting_sessions(user_id) VALUES($1)', [ids[k]]);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  test('the trigger and backfill only confirm a country with evidence', async () => {
    expect(await row('legacyUs')).toEqual({ country_confirmed: false, country_confirmation_source: null });
    expect(await row('defaulted')).toEqual({ country_confirmed: false, country_confirmation_source: null });
    expect(await row('haiti')).toEqual({ country_confirmed: true, country_confirmation_source: 'non_default' });
    expect(await row('usEvidence')).toEqual({ country_confirmed: true, country_confirmation_source: 'us_address_evidence' });
    await db.query(`UPDATE users SET phone = '+13125550199' WHERE id=$1`, [ids.legacyUs]);
    expect(await row('legacyUs')).toEqual({ country_confirmed: true, country_confirmation_source: 'us_address_evidence' });
    await db.query(`UPDATE users SET country = 'CA' WHERE id=$1`, [ids.defaulted]);
    expect(await row('defaulted')).toEqual({ country_confirmed: true, country_confirmation_source: 'changed' });
    await db.query(`UPDATE users SET country = 'US' WHERE id=$1`, [ids.defaulted]);
  });

  test('decision 4: unconfirmed users count under their stored country', async () => {
    await add('stillDefault', { zip_code: '60601', state: 'IL' });
    await db.query('INSERT INTO consulting_sessions(user_id) VALUES($1)', [ids.stillDefault]);
    const us = await scopedUsers([{ type: 'country_only', countries: ['US'] }]);
    expect(us.has(ids.usEvidence)).toBe(true);
    expect(us.has(ids.stillDefault)).toBe(true);
    expect(us.has(ids.haiti)).toBe(false);
    const ht = await scopedUsers([{ type: 'country_only', countries: ['HT'] }]);
    expect([...ht]).toEqual([ids.haiti]);
    // ZIP ranges still match on the address on file, confirmed or not.
    const zips = await scopedUsers([{ type: 'zip_range', ranges: [{ start: 60600, end: 60699 }] }]);
    expect(zips.has(ids.stillDefault)).toBe(true);
  });

  test('decision 4: confirmed and unconfirmed users are counted separately', async () => {
    const scope = { global: false, regions: [{ type: 'country_only', countries: ['US'] }] };
    const breakdown = await userCountryBreakdown(db, scope, ['SELECT user_id FROM consulting_sessions']);
    const { rows } = await db.query(`SELECT COUNT(*) FILTER (WHERE country_confirmed)::INT AS c,
      COUNT(*) FILTER (WHERE NOT country_confirmed)::INT AS u FROM users WHERE country = 'US'`);
    expect(breakdown).toEqual({ basis: 'stored_country', defaultCountry: 'US', confirmed: rows[0].c, unconfirmed: rows[0].u, tables: ['consulting_sessions'] });
    expect(breakdown.unconfirmed).toBeGreaterThan(0);
    expect(await userCountryBreakdown(db, { global: true }, ['SELECT 1 FROM consulting_sessions'])).toBeNull();
    expect(await userCountryBreakdown(db, scope, ['SELECT id FROM food_restaurants'])).toBeNull();
  });

  test('geo_radius matches US users (stored country) by ZIP centroid; no coordinates, no match', async () => {
    const chicago = await scopedUsers([{ type: 'geo_radius', lat: 41.88, lng: -87.63, radius_miles: 25 }]);
    expect(chicago.has(ids.usEvidence)).toBe(true);
    expect(chicago.has(ids.usFar)).toBe(false);
    expect(chicago.has(ids.stillDefault)).toBe(true);
    expect(chicago.has(ids.haiti)).toBe(false);
  });
});
