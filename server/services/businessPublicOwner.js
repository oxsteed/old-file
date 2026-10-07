'use strict';

// Resolve the accountable owner of a PUBLICLY visible business without ever
// returning the owner's user id to the caller.
//
// GV-5 removed owner_id from the public business payload. Features that need
// the owner (Pay link, live/online status, reputation, report, messenger
// booking) now call business-scoped endpoints that resolve the owner
// server-side through this module. The predicate mirrors
// businessController.respondBusinessProfile's public gate, so a business that
// is unlisted/inactive/admin-hidden/setup-incomplete/deleted (or whose owner
// is inactive/unverified/deleted) leaks no signal.

const pool = require('../db');

function parseBusinessId(value) {
  const raw = String(value ?? '').trim();
  return /^\d{1,18}$/.test(raw) ? raw : null;
}

async function resolvePublicBusinessOwner(businessId, db = pool) {
  const id = parseBusinessId(businessId);
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT b.id AS business_id, b.user_id AS owner_id
       FROM businesses b
       JOIN users u ON u.id = b.user_id
      WHERE b.id = $1
        AND b.deleted_at IS NULL
        AND b.is_active = TRUE
        AND b.is_listed = TRUE
        AND COALESCE(b.is_hidden_by_admin, FALSE) = FALSE
        AND b.setup_status = 'active'
        AND b.business_kind = 'service'
        AND u.deleted_at IS NULL
        AND u.is_active = TRUE
        AND u.email_verified = TRUE`,
    [id]
  );
  if (!rows[0]) return null;
  return { businessId: rows[0].business_id, ownerId: rows[0].owner_id };
}

module.exports = { resolvePublicBusinessOwner, parseBusinessId };
