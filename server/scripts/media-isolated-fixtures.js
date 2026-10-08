'use strict';

// Extend the established synthetic Credit fixture without moving or funding
// any money. Used only inside the uniquely scoped disposable compose project.
const personas = Object.freeze({
  admin: '22222222-2222-4222-8222-222222222222',
  restaurant: '33333333-3333-4333-8333-333333333333',
  helper: '44444444-4444-4444-8444-444444444444',
  business: '55555555-5555-4555-8555-555555555555',
  customer: '66666666-6666-4666-8666-666666666666',
  blocked: '88888888-8888-4888-8888-888888888888',
});
function assertIsolated() {
  const database = new URL(process.env.DATABASE_URL || 'http://invalid');
  if (process.env.MEDIA_TEST_MODE !== 'true' || process.env.NODE_ENV !== 'test'
      || !/^oxsteed-credit-test-[a-z0-9-]+$/.test(process.env.CREDIT_TEST_PROJECT || '')
      || database.hostname !== 'postgres' || database.pathname !== '/oxsteed_db') {
    throw new Error('Media fixtures require the disposable Media compose environment');
  }
}
async function seed(pool) {
  assertIsolated();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT id FROM users WHERE id = ANY($1::uuid[])', [Object.values(personas)]);
    if (rows.length !== Object.values(personas).length) throw new Error('Run the isolated Credit seed first');
    await db.query('UPDATE users SET is_verified = TRUE WHERE id = ANY($1::uuid[])', [[personas.helper, personas.restaurant]]);
    await db.query(`INSERT INTO helper_profiles (user_id, profile_slug, service_city, service_state, service_lat, service_lng)
      VALUES ($1,'media-synthetic-helper','Springfield','OH',39.9242,-83.8088)
      ON CONFLICT (user_id) DO UPDATE SET profile_slug=EXCLUDED.profile_slug,
        service_city=EXCLUDED.service_city,service_state=EXCLUDED.service_state,
        service_lat=EXCLUDED.service_lat,service_lng=EXCLUDED.service_lng`, [personas.helper]);
    await db.query(`INSERT INTO businesses (id,user_id,business_name,business_type,is_primary,is_active,is_business_verified,address_city,address_state)
      VALUES (905,$1,'Media Synthetic Business','llc',TRUE,TRUE,TRUE,'Springfield','OH')
      ON CONFLICT (id) DO UPDATE SET is_business_verified=TRUE`, [personas.business]);
    await db.query(`UPDATE food_restaurants SET is_verified=TRUE,latitude=39.9242,longitude=-83.8088 WHERE id=901`);
    await db.query(`INSERT INTO media_actors (owner_user_id,actor_type,business_id,restaurant_id,handle,display_name,verified_kind)
      VALUES ($1,'helper',NULL,NULL,'media-synthetic-helper','Synthetic Helper','identity'),
        ($2,'restaurant',901,901,'media-synthetic-restaurant','Synthetic Restaurant','restaurant'),
        ($3,'business',905,NULL,'media-synthetic-business','Synthetic Business','business')
      ON CONFLICT (handle) DO UPDATE SET verified_kind=EXCLUDED.verified_kind`, [personas.helper, personas.restaurant, personas.business]);
    await db.query(`INSERT INTO user_blocks (blocker_id,blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [personas.blocked, personas.helper]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
module.exports = { personas, assertIsolated, seed };
