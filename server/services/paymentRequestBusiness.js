'use strict';

// Decision 9: a main-app payment request may carry the business it concerns
// (sent by the client), but only when that matches the business the server
// derives for the request:
//   - service_booking + sourceId  -> booking_requests.business_id
//   - business_service + sourceId -> business_services.business_id
//   - otherwise (or when the source names no business): a live business the
//     payee owns or is an active member of.
// A business id that cannot be verified is rejected (fail closed).
const db = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^[1-9]\d{0,9}$/;

async function derivePaymentRequestBusinessIds({ sourceType, sourceId, payeeId }, conn = db) {
  const source = sourceId == null ? '' : String(sourceId);
  if (sourceType === 'service_booking' && UUID_RE.test(source)) {
    const { rows } = await conn.query('SELECT business_id FROM booking_requests WHERE id = $1::uuid', [source]);
    if (rows[0]?.business_id != null) return [String(rows[0].business_id)];
  }
  if (sourceType === 'business_service' && INT_RE.test(source)) {
    const { rows } = await conn.query('SELECT business_id FROM business_services WHERE id = $1::integer', [source]);
    if (rows[0]?.business_id != null) return [String(rows[0].business_id)];
  }
  if (!payeeId || !UUID_RE.test(String(payeeId))) return [];
  const { rows } = await conn.query(
    `SELECT b.id FROM businesses b
      WHERE b.deleted_at IS NULL AND COALESCE(b.is_active, TRUE)
        AND (b.user_id = $1::uuid OR EXISTS (
          SELECT 1 FROM business_members bm
           WHERE bm.business_id = b.id AND bm.member_id = $1::uuid AND bm.status = 'active'))`,
    [String(payeeId)]
  );
  return rows.map(r => String(r.id));
}

/**
 * Returns { ok: true, businessId } (null when the client sent none) or
 * { ok: false, code } when the client's business id is malformed or does not
 * match the server-derived business.
 */
async function verifyPaymentRequestBusiness(raw, context, conn = db) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, businessId: null };
  if (!INT_RE.test(String(raw).trim())) return { ok: false, code: 'business_invalid' };
  const businessId = String(Number(String(raw).trim()));
  const derived = await derivePaymentRequestBusinessIds(context, conn);
  if (!derived.includes(businessId)) return { ok: false, code: 'business_mismatch' };
  return { ok: true, businessId: Number(businessId) };
}

module.exports = { derivePaymentRequestBusinessIds, verifyPaymentRequestBusiness };
