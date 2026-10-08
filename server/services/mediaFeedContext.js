'use strict';

const { createHash } = require('crypto');

const VERSION = 1;
function invalid(code = 'media_location_invalid') {
  return Object.assign(new Error('Refresh the feed with a valid location and cursor'), { status: 400, code });
}
function place(value) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1f]/.test(value)) throw invalid();
  return value.trim().toLowerCase();
}

async function resolveLocation(query, viewer, db) {
  if (query.location_mode && !['all', 'profile', 'custom'].includes(query.location_mode)) throw invalid();
  const city = place(query.city);
  const state = place(query.state);
  if (Boolean(city) !== Boolean(state)) throw invalid();
  const hasLatitude = query.latitude !== undefined;
  const hasLongitude = query.longitude !== undefined;
  if (hasLatitude !== hasLongitude) throw invalid();
  let latitude = null, longitude = null;
  if (hasLatitude) {
    if (typeof query.latitude !== 'string' || typeof query.longitude !== 'string'
      || !query.latitude.trim() || !query.longitude.trim()) throw invalid();
    latitude = Number(query.latitude); longitude = Number(query.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw invalid();
    // Avoid carrying precise device coordinates in the cursor or response.
    latitude = Math.round(latitude * 1000) / 1000;
    longitude = Math.round(longitude * 1000) / 1000;
  }
  if (query.location_mode === 'all') {
    if (city || hasLatitude) throw invalid();
    return { city: '', state: '', latitude: null, longitude: null };
  }
  if (city || hasLatitude) return { city, state, latitude, longitude };
  if (query.location_mode === 'custom') throw invalid();
  if (viewer) {
    const { rows } = await db.query('SELECT city, state FROM users WHERE id = $1', [viewer]);
    const profileCity = place(rows[0]?.city), profileState = place(rows[0]?.state);
    if (profileCity && profileState) return { city: profileCity, state: profileState, latitude, longitude };
  }
  return { city: '', state: '', latitude, longitude };
}
function contextKey(tab, viewer, location) {
  return createHash('sha256').update(JSON.stringify([VERSION, tab, viewer || null, location])).digest('hex');
}
function decodeCursor(input, context) {
  if (!input) return null;
  try {
    if (typeof input !== 'string' || input.length > 1500 || !/^[\w-]+$/.test(input)) throw invalid();
    const value = JSON.parse(Buffer.from(input, 'base64url').toString('utf8'));
    if (value.v !== VERSION || value.context !== context || !['ranked', 'chronological'].includes(value.mode)
      || typeof value.id !== 'string' || !value.id || value.id.length > 100
      || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value.created_at) || !Number.isFinite(Date.parse(value.created_at))
      || !Number.isFinite(Date.parse(value.as_of)) || Date.parse(value.created_at) > Date.parse(value.as_of)
      || !Number.isInteger(value.link_count) || value.link_count < 0 || value.link_count > 5
      || !Number.isInteger(value.locality_boost) || value.locality_boost < 0 || value.locality_boost > 3) throw invalid();
    return value;
  } catch { throw invalid('media_feed_cursor_invalid'); }
}
function encodeCursor(row, context, mode, asOf) {
  return Buffer.from(JSON.stringify({ v: VERSION, context, mode, as_of: asOf,
    id: row.id, created_at: row.cursor_created_at || row.created_at,
    link_count: Number(row.link_count) || 0, locality_boost: Number(row.locality_boost) || 0,
  })).toString('base64url');
}

// Reuse entity coordinates rather than trusting post text or client labels.
// Only currently public linked entities can contribute to locality. Direct's
// global catalog has no location; it contributes a valid link, not invented geo.
function localitySql(location, params) {
  if (!location.city && location.latitude === null) return '0';
  params.push(location.latitude, location.longitude, location.city, location.state);
  const lat = `$${params.length - 3}::double precision`, lng = `$${params.length - 2}::double precision`;
  const city = `$${params.length - 1}::text`, state = `$${params.length}::text`;
  const candidates = `
    SELECT hp.service_lat AS lat,hp.service_lng AS lng,hp.service_city AS city,hp.service_state AS state
      FROM helper_profiles hp WHERE a.actor_type='helper' AND hp.user_id=a.owner_user_id
    UNION ALL SELECT b.service_lat,b.service_lng,COALESCE(NULLIF(b.service_city,''),b.address_city),
      COALESCE(NULLIF(b.service_state,''),b.address_state) FROM businesses b
      WHERE a.actor_type='business' AND b.id=a.business_id AND b.is_active AND b.deleted_at IS NULL
    UNION ALL SELECT r.latitude,r.longitude,r.address_city,r.address_state FROM food_restaurants r
      WHERE a.actor_type='restaurant' AND r.id=a.restaurant_id AND r.status='active'
    UNION ALL SELECT r.latitude,r.longitude,r.address_city,r.address_state FROM media_post_links ml
      JOIN food_restaurants r ON r.id::text=ml.target_id
      WHERE ml.post_id=p.id AND ml.link_type='restaurant' AND r.status='active'
    UNION ALL SELECT r.latitude,r.longitude,r.address_city,r.address_state FROM media_post_links ml
      JOIN food_menu_items i ON i.id::text=split_part(ml.target_id,':',2)
      JOIN food_restaurants r ON r.id=i.restaurant_id AND r.id::text=split_part(ml.target_id,':',1)
      WHERE ml.post_id=p.id AND ml.link_type='food_item' AND r.status='active'
    UNION ALL SELECT hp.service_lat,hp.service_lng,hp.service_city,hp.service_state FROM media_post_links ml
      JOIN helper_profiles hp ON (hp.id::text=ml.target_id OR hp.user_id::text=ml.target_id OR hp.profile_slug=ml.target_id)
      JOIN users u ON u.id=hp.user_id AND u.is_active AND NOT u.is_banned AND u.deleted_at IS NULL
      WHERE ml.post_id=p.id AND ml.link_type='helper'
    UNION ALL SELECT b.service_lat,b.service_lng,COALESCE(NULLIF(b.service_city,''),b.address_city),
      COALESCE(NULLIF(b.service_state,''),b.address_state) FROM media_post_links ml
      JOIN businesses b ON b.id::text=ml.target_id AND b.is_active AND b.deleted_at IS NULL
      WHERE ml.post_id=p.id AND ml.link_type='business'
    UNION ALL SELECT j.location_approx_lat,j.location_approx_lng,j.location_city,j.location_state FROM media_post_links ml
      JOIN jobs j ON j.id::text=ml.target_id AND j.status IN ('open','published')
      WHERE ml.post_id=p.id AND ml.link_type='job'
    UNION ALL SELECT NULL::numeric,NULL::numeric,tr.location_city,tr.location_state FROM media_post_links ml
      JOIN tool_rentals tr ON tr.id::text=ml.target_id AND tr.is_available
      WHERE ml.post_id=p.id AND ml.link_type='tool_rental'
    UNION ALL SELECT b.service_lat,b.service_lng,COALESCE(NULLIF(b.service_city,''),b.address_city),
      COALESCE(NULLIF(b.service_state,''),b.address_state) FROM media_post_links ml
      JOIN pooled_orders po ON po.id::text=ml.target_id AND po.status IN ('open','pledging')
      JOIN businesses b ON b.id=po.organizer_business_id AND b.is_active AND b.deleted_at IS NULL
      WHERE ml.post_id=p.id AND ml.link_type='logistics_campaign'`;
  const distance = `6371 * acos(LEAST(1.0,GREATEST(-1.0,
    sin(radians(${lat}))*sin(radians(geo.lat::double precision)) +
    cos(radians(${lat}))*cos(radians(geo.lat::double precision))*cos(radians(geo.lng::double precision-${lng})))`;
  return `COALESCE((SELECT MAX(CASE
    WHEN ${lat} IS NOT NULL AND geo.lat BETWEEN -90 AND 90 AND geo.lng BETWEEN -180 AND 180
      THEN CASE WHEN ${distance} <= 25 THEN 3 WHEN ${distance} <= 80 THEN 2 ELSE 0 END
    WHEN ${city} <> '' AND LOWER(TRIM(geo.city))=${city} AND LOWER(TRIM(geo.state))=${state} THEN 2
    ELSE 0 END) FROM (${candidates}) geo),0)`;
}

module.exports = { resolveLocation, contextKey, decodeCursor, encodeCursor, localitySql };
