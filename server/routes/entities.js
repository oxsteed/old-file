'use strict';

// Entity ID resolution routes (migration 670).
// Conservative by design: a public ID resolves to type + id for everyone;
// names are only attached when the entity is public or the requester is the
// owner/admin. Malformed and unknown IDs both return 404 so the endpoint is
// not an oracle for which IDs exist.

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { entityResolveLimiter } = require('../middleware/rateLimiter');
const pool = require('../db');
const logger = require('../utils/logger');
const {
  resolvePublicId,
  getOrMintEntityId,
} = require('../lib/entityIds');

function publicName(firstName, lastName) {
  const first = (firstName || '').trim();
  const initial = (lastName || '').trim().charAt(0);
  return initial ? `${first} ${initial}.` : first;
}

async function summarize(client, row, req) {
  const base = {
    public_id: row.public_id,
    entity_type: row.entity_type,
    created_at: row.created_at,
  };
  const isSelf = row.entity_type === 'person' && String(row.entity_key) === String(req.user.id);
  const isAdmin = req.isAdmin === true;

  if (row.entity_type === 'person') {
    if (isSelf || isAdmin) {
      const { rows } = await client.query(
        'SELECT first_name, last_name FROM users WHERE id = $1',
        [row.entity_key]
      );
      if (rows[0]) base.display_name = publicName(rows[0].first_name, rows[0].last_name);
    }
    // Identity verification is a boolean trust signal only; no PII beyond
    // what this endpoint already discloses.
    const { rows: ivRows } = await client.query(
      `SELECT updated_at FROM identity_verifications
        WHERE provider = 'didit' AND status = 'verified'
          AND (person_public_id = $1 OR user_id = $2::uuid)
        ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 1`,
      [row.public_id, row.entity_key]
    );
    base.identity_verified = ivRows.length > 0;
    base.identity_verified_at = ivRows[0]?.updated_at || null;
    return base;
  }

  if (row.entity_type === 'business') {
    const { rows } = await client.query(
      'SELECT business_name, COALESCE(is_listed, FALSE) AS is_listed FROM businesses WHERE id = $1',
      [Number(row.entity_key)]
    );
    if (rows[0]?.is_listed && rows[0].business_name) base.display_name = rows[0].business_name;
    return base;
  }

  if (row.entity_type === 'restaurant') {
    const { rows } = await client.query(
      'SELECT display_name, status FROM food_restaurants WHERE id = $1',
      [Number(row.entity_key)]
    );
    if (rows[0]?.status === 'active' && rows[0].display_name) base.display_name = rows[0].display_name;
    return base;
  }

  // helper_profile and any future types: type + id only. The person behind a
  // helper profile stays private.
  return base;
}

// The requester's own person ID. Mints on demand so rows created before
// migration 670 (or via a path that skipped minting) self-heal here.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const publicId = await getOrMintEntityId(pool, 'person', req.user.id);
    const row = await resolvePublicId(pool, publicId);
    if (!row) return res.status(404).json({ error: 'Entity not found' });
    res.json(await summarize(pool, row, req));
  } catch (err) {
    logger.error('Entity /me failed', { userId: req.user?.id, error: err.message });
    next(err);
  }
});

router.get('/:publicId', authenticate, entityResolveLimiter, async (req, res, next) => {
  try {
    const row = await resolvePublicId(pool, req.params.publicId);
    if (!row) return res.status(404).json({ error: 'Entity not found' });
    res.json(await summarize(pool, row, req));
  } catch (err) {
    logger.error('Entity resolve failed', { error: err.message });
    next(err);
  }
});

module.exports = router;
