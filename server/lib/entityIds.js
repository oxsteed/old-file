'use strict';

/**
 * server/lib/entityIds.js
 *
 * Universal entity IDs (migration 670): one opaque, permanent, non-reusable
 * public ID per entity, shaped like OX-P-7KQ4-92MD-3.
 *
 * The check-digit algorithm here MUST match the SQL function
 * entity_id_check_char() in migration 670 exactly (Luhn mod 32 over the 8
 * Crockford base32 chars, doubling every second char from the right).
 *
 * Conventions:
 * - IDs are minted by the SQL function mint_entity_id(); this module never
 *   invents the random portion itself.
 * - entity_links is append-only: grantLink() closes the current identical row
 *   before inserting; revokeLink() only sets valid_to. Never UPDATE a closed
 *   row, never DELETE.
 * - `client` is any object with an async query(text, params) method: the pg
 *   pool or a transaction client from withTransaction.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const TYPE_CODES = {
  person: 'P',
  business: 'B',
  restaurant: 'R',
  helper_profile: 'H',
};

const CODE_TYPES = {
  P: 'person',
  B: 'business',
  R: 'restaurant',
  H: 'helper_profile',
};

const RELATIONS = new Set(['owns', 'belongs_to', 'acts_as', 'manages', 'represents']);

// OX-<type>-<4 chars>-<4 chars>-<check>
const PUBLIC_ID_RE = /^OX-([PBRH])-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z])$/;

/**
 * Luhn-mod-32 check character over exactly 8 Crockford base32 chars.
 * Keep in sync with entity_id_check_char() in migration 670.
 */
function computeCheckChar(eightChars) {
  if (typeof eightChars !== 'string' || eightChars.length !== 8) {
    throw new Error('computeCheckChar: expected 8 chars');
  }
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    // i = 0 is the rightmost char; every second char from the right doubles.
    const v = ALPHABET.indexOf(eightChars[7 - i]);
    if (v < 0) throw new Error('computeCheckChar: invalid character');
    const addend = i % 2 === 0 ? v * 2 : v;
    sum += Math.floor(addend / 32) + (addend % 32);
  }
  return ALPHABET[(32 - (sum % 32)) % 32];
}

/** True when the ID is well-formed AND the check digit verifies. */
function isValidPublicId(publicId) {
  if (typeof publicId !== 'string') return false;
  const m = PUBLIC_ID_RE.exec(publicId.trim().toUpperCase());
  if (!m) return false;
  const eight = m[2] + m[3];
  try {
    return computeCheckChar(eight) === m[4];
  } catch {
    return false;
  }
}

/** Parse a public ID into { public_id, entity_type } or return null. */
function parsePublicId(publicId) {
  if (!isValidPublicId(publicId)) return null;
  const normalized = publicId.trim().toUpperCase();
  const m = PUBLIC_ID_RE.exec(normalized);
  return { public_id: normalized, entity_type: CODE_TYPES[m[1]] };
}

function assertEntityType(entityType) {
  if (!TYPE_CODES[entityType]) {
    throw new Error(`unknown entity type: ${entityType}`);
  }
}

function assertRelation(relation) {
  if (!RELATIONS.has(relation)) {
    throw new Error(`unknown relation: ${relation}`);
  }
}

/**
 * Return the existing public ID for (entityType, entityKey), minting one via
 * the SQL function when missing. entityKey is the source PK as text.
 * Safe under concurrency: on a unique-violation race, re-reads the winner.
 */
async function getOrMintEntityId(client, entityType, entityKey) {
  assertEntityType(entityType);
  const key = String(entityKey);
  if (!key) throw new Error('getOrMintEntityId: entityKey is required');

  const { rows } = await client.query(
    'SELECT public_id FROM entity_ids WHERE entity_type = $1 AND entity_key = $2',
    [entityType, key]
  );
  if (rows[0]) return rows[0].public_id;

  const { rows: minted } = await client.query('SELECT mint_entity_id($1) AS public_id', [
    TYPE_CODES[entityType],
  ]);
  const publicId = minted[0].public_id;
  try {
    await client.query(
      'INSERT INTO entity_ids (public_id, entity_type, entity_key) VALUES ($1, $2, $3)',
      [publicId, entityType, key]
    );
  } catch (err) {
    if (err && err.code === '23505') {
      const { rows: raced } = await client.query(
        'SELECT public_id FROM entity_ids WHERE entity_type = $1 AND entity_key = $2',
        [entityType, key]
      );
      if (raced[0]) return raced[0].public_id;
    }
    throw err;
  }
  return publicId;
}

/**
 * Validate the check digit, then resolve. Returns the entity_ids row or null
 * (null covers both malformed IDs and unknown IDs; callers must not
 * distinguish them to avoid an oracle).
 */
async function resolvePublicId(client, publicId) {
  const parsed = parsePublicId(publicId);
  if (!parsed) return null;
  const { rows } = await client.query(
    'SELECT public_id, entity_type, entity_key, created_at FROM entity_ids WHERE public_id = $1',
    [parsed.public_id]
  );
  return rows[0] || null;
}

/**
 * Grant a link, closing any current identical (subject, object, relation) row
 * first. Enforces at most one current row per triple; history is preserved in
 * the closed rows.
 */
async function grantLink(client, { subjectId, objectId, relation, share = null, grantedBy = null }) {
  assertRelation(relation);
  if (!subjectId || !objectId) throw new Error('grantLink: subjectId and objectId are required');
  if (subjectId === objectId) throw new Error('grantLink: subject and object must differ');
  if (share != null && !(Number.isFinite(Number(share)) && Number(share) >= 0 && Number(share) <= 100)) {
    throw new Error('grantLink: share must be between 0 and 100');
  }

  await client.query(
    `UPDATE entity_links SET valid_to = now()
      WHERE subject_id = $1 AND object_id = $2 AND relation = $3 AND valid_to IS NULL`,
    [subjectId, objectId, relation]
  );
  const { rows } = await client.query(
    `INSERT INTO entity_links (subject_id, object_id, relation, share, granted_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, subject_id, object_id, relation, share, granted_by, valid_from, valid_to`,
    [subjectId, objectId, relation, share == null ? null : Number(share), grantedBy]
  );
  return rows[0];
}

/** Close the current (subject, object, relation) row. Returns the closed row or null. */
async function revokeLink(client, { subjectId, objectId, relation }) {
  assertRelation(relation);
  const { rows } = await client.query(
    `UPDATE entity_links SET valid_to = now()
      WHERE subject_id = $1 AND object_id = $2 AND relation = $3 AND valid_to IS NULL
      RETURNING id, subject_id, object_id, relation, valid_from, valid_to`,
    [subjectId, objectId, relation]
  );
  return rows[0] || null;
}

/** Everything the subject currently controls/owns: the tree view. */
async function getControlledEntities(client, publicId) {
  const { rows } = await client.query(
    `SELECT l.relation, l.share, l.valid_from,
            e.public_id, e.entity_type, e.entity_key
       FROM entity_links l
       JOIN entity_ids e ON e.public_id = l.object_id
      WHERE l.subject_id = $1 AND l.valid_to IS NULL
      ORDER BY e.entity_type, l.valid_from`,
    [publicId]
  );
  return rows;
}

/** Current subjects holding a relation over the object (owners, managers...). */
async function getControllers(client, publicId) {
  const { rows } = await client.query(
    `SELECT l.relation, l.share, l.valid_from,
            e.public_id, e.entity_type, e.entity_key
       FROM entity_links l
       JOIN entity_ids e ON e.public_id = l.subject_id
      WHERE l.object_id = $1 AND l.valid_to IS NULL
      ORDER BY l.valid_from`,
    [publicId]
  );
  return rows;
}

module.exports = {
  ALPHABET,
  TYPE_CODES,
  RELATIONS,
  computeCheckChar,
  isValidPublicId,
  parsePublicId,
  getOrMintEntityId,
  resolvePublicId,
  grantLink,
  revokeLink,
  getControlledEntities,
  getControllers,
};
