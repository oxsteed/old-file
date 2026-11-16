'use strict';

// WP-058: child-record references supplied in a request body (a linked quote,
// the diagnostic request a recommendation belongs to, an appointment, an
// assigned staff member…) must belong to the business named by the route.
// Foreign keys only prove the row exists somewhere, so without this check a
// member of business A could attach (and then read through joins) a record of
// business B by combining ids. Missing or foreign references are a plain 404.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const TABLES = Object.freeze({
  business_quotes: 'business_quotes',
  business_appointments: 'business_appointments',
  trades_diagnostic_requests: 'trades_diagnostic_requests',
  creative_intake_requests: 'creative_intake_requests',
  professional_engagement_requests: 'professional_engagement_requests',
});

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

/**
 * @param {number|string} businessId
 * @param {Array<{ table?: string, team?: boolean, id: any, field: string }>} refs
 */
async function assertBusinessRefs(businessId, refs, db = pool) {
  for (const ref of refs) {
    if (!present(ref.id)) continue;
    let rows;
    if (ref.team) {
      ({ rows } = await db.query(
        `SELECT 1 FROM businesses b
          WHERE b.id = $2 AND (b.user_id::text = $1::text OR EXISTS (
            SELECT 1 FROM business_members bm WHERE bm.business_id = b.id
               AND bm.member_id::text = $1::text AND bm.status = 'active'))`,
        [String(ref.id), businessId]));
    } else {
      const table = TABLES[ref.table];
      if (!table) throw new Error(`assertBusinessRefs: unknown table ${ref.table}`);
      ({ rows } = await db.query(
        `SELECT 1 FROM ${table} WHERE id::text = $1::text AND business_id = $2`, [String(ref.id), businessId]));
    }
    if (!rows.length) {
      throw new AppError('Linked record not found', 404, 'not_found', { [ref.field]: 'not_found' });
    }
  }
}

module.exports = { assertBusinessRefs };
