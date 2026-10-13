'use strict';

// Review P1-192: the helper, business and Direct schedulers each read only
// their own table, so one person could be booked on two surfaces at once.
// Every engine now asks this module for the person's commitments on the
// OTHER surfaces (each engine keeps handling its own table itself).
//
// Sources:
//   helper    - appointments (helper_id) + personal availability_blocks
//   business  - business_appointments (staff_id)
//   direct    - quote_requests Direct visits (assigned_to + quote_request_crew)
const db = require('../db');

const SOURCES = ['helper', 'business', 'direct'];

async function loadCrossSurfaceBusy(userIds, from, to, { exclude = [], executor = db } = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const wanted = SOURCES.filter((s) => !exclude.includes(s));
  const queries = [];

  if (wanted.includes('helper')) {
    queries.push(executor.query(
      `SELECT helper_id::text AS user_id, scheduled_start_time AS starts_at, scheduled_end_time AS ends_at, 'helper' AS source
         FROM appointments
        WHERE helper_id = ANY($1::uuid[])
          AND status IN ('requested', 'confirmed', 'in_progress')
          AND scheduled_start_time < $3 AND scheduled_end_time > $2
       UNION ALL
       SELECT helper_id::text, start_time, end_time, 'helper_block'
         FROM availability_blocks
        WHERE helper_id = ANY($1::uuid[])
          AND type IN ('unavailable', 'busy')
          AND start_time < $3 AND end_time > $2`,
      [ids, fromIso, toIso]
    ));
  }
  if (wanted.includes('business')) {
    queries.push(executor.query(
      `SELECT staff_id::text AS user_id, start_time AS starts_at, end_time AS ends_at, 'business' AS source
         FROM business_appointments
        WHERE staff_id = ANY($1::uuid[])
          AND status IN ('pending', 'confirmed', 'in_progress')
          AND start_time < $3 AND end_time > $2`,
      [ids, fromIso, toIso]
    ));
  }
  if (wanted.includes('direct')) {
    queries.push(executor.query(
      `SELECT m.user_id::text AS user_id, qr.scheduled_start_at AS starts_at, qr.scheduled_end_at AS ends_at, 'direct' AS source
         FROM quote_requests qr
         CROSS JOIN LATERAL (
           SELECT qr.assigned_to AS user_id
           UNION
           SELECT c.user_id FROM quote_request_crew c WHERE c.quote_request_id = qr.id
         ) m
        WHERE COALESCE(qr.metadata->>'flow', 'direct') = 'direct'
          AND m.user_id = ANY($1::uuid[])
          AND qr.status NOT IN ('cancelled', 'closed', 'completed')
          AND qr.scheduled_start_at IS NOT NULL AND qr.scheduled_end_at IS NOT NULL
          AND qr.scheduled_start_at < $3 AND qr.scheduled_end_at > $2`,
      [ids, fromIso, toIso]
    ));
  }

  const results = await Promise.all(queries);
  return results.flatMap(({ rows }) => rows.map((r) => ({
    userId: String(r.user_id),
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    source: r.source,
  })));
}

// Per-person turnaround buffers (helper_profiles.booking_buffer_minutes).
async function loadBookingBuffers(userIds, executor = db) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const { rows } = await executor.query(
    `SELECT user_id::text AS user_id, LEAST(240, GREATEST(0, COALESCE(booking_buffer_minutes, 0)))::int AS buffer
       FROM helper_profiles WHERE user_id = ANY($1::uuid[])`,
    [ids]
  );
  return new Map(rows.map((r) => [r.user_id, r.buffer]));
}

module.exports = { loadCrossSurfaceBusy, loadBookingBuffers };
