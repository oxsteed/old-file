'use strict';

/**
 * Anchors Didit outcomes to the person's entity ID (identity_verifications,
 * migration 671) and records duplicate_of links on the entity graph.
 *
 * Shared by the live webhook (webhookController.diditWebhook, P1-331/P1-332)
 * and the legacy diditController handler. Best-effort by design: the users
 * row is the source of truth for didit_status, so a linking failure is
 * logged and never fails the webhook.
 *
 * Status values written here are within chk_iv_status (migration 671):
 * 'verified' | 'failed' | 'duplicate' | 'processing'.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { getOrMintEntityId, grantLink } = require('../lib/entityIds');

async function upsertDiditVerification({ userId, personPublicId, sessionId, identityHash, status }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE identity_verifications
        SET provider_session_id = $1,
            provider_identity_hash = COALESCE($2, provider_identity_hash),
            status = $3,
            user_id = $4,
            updated_at = NOW()
      WHERE provider = 'didit' AND person_public_id = $5`,
    [sessionId, identityHash, status, userId, personPublicId]
  );
  if (rowCount === 0) {
    await db.query(
      `INSERT INTO identity_verifications
         (user_id, person_public_id, provider, provider_session_id,
          provider_identity_hash, status)
       VALUES ($1, $2, 'didit', $3, $4, $5)`,
      [userId, personPublicId, sessionId, identityHash, status]
    );
  }
}

async function linkVerificationToEntity(userId, { sessionId, identityHash = null, status }, db = pool) {
  try {
    const personPublicId = await getOrMintEntityId(db, 'person', userId);
    await upsertDiditVerification({ userId, personPublicId, sessionId, identityHash, status }, db);
    return personPublicId;
  } catch (err) {
    logger.error('Didit entity linking failed (best-effort)', { userId, status, err: err.message });
    return null;
  }
}

async function linkDuplicateIdentity({ userId, canonicalUserId, sessionId, identityHash = null }, db = pool) {
  try {
    const newPublicId = await getOrMintEntityId(db, 'person', userId);
    await upsertDiditVerification({ userId, personPublicId: newPublicId, sessionId, identityHash, status: 'duplicate' }, db);
    if (canonicalUserId) {
      const canonicalPublicId = await getOrMintEntityId(db, 'person', canonicalUserId);
      await grantLink(db, { subjectId: newPublicId, objectId: canonicalPublicId, relation: 'duplicate_of' });
    }
    return newPublicId;
  } catch (err) {
    logger.error('Didit duplicate linking failed (best-effort)', { userId, err: err.message });
    return null;
  }
}

async function markHelperIdentityVerified(userId, db = pool) {
  try {
    await db.query(
      `UPDATE helper_profiles SET is_identity_verified = TRUE, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );
  } catch (err) {
    logger.error('Didit helper badge update failed (best-effort)', { userId, err: err.message });
  }
}

module.exports = { upsertDiditVerification, linkVerificationToEntity, linkDuplicateIdentity, markHelperIdentityVerified };
