'use strict';

/**
 * WP-046: business setup and existing ownership.
 *
 * Private preparation (create a draft, edit setup) stays open to every
 * active account. *Activation* — publishing a business or restaurant — is
 * the reviewed step: under ACCESS_BUSINESS_ENFORCEMENT=enforce the owner
 * needs an effective, *granted* `business.own` (service business) or
 * `restaurant.own` (restaurant) — either for themself or for this exact
 * business. The first publication can bind an approved proposal to a matching
 * owned draft. A draft alone does not confer approval.
 * `shadow` logs what enforce would refuse; `off` (default) is legacy.
 */

const flags = require('./flags');
const logger = require('../../utils/logger');
const { loadFacts, bumpProjection } = require('./accessService');
const { grantIsEffective, accountActive } = require('./resolver');

function capabilityForKind(kind) {
  return kind === 'restaurant' ? 'restaurant.own' : 'business.own';
}

function factsAllowPublishing(facts, businessId, kind, now) {
  if (!accountActive(facts.user, now)) return false;
  // Mirrors modeGate: a restaurant may be published under either approval.
  const wanted = new Set(kind === 'restaurant' ? ['restaurant.own', 'business.own'] : ['business.own']);
  return (facts.grants || []).some((g) => wanted.has(g.capability)
    && grantIsEffective(g, now)
    && ((g.subject_type || 'self') === 'self'
      || (g.subject_type === 'business' && String(g.subject_id) === String(businessId))));
}

// The publication controller has already locked the canonical draft. Lock
// the proposal grant so competing drafts cannot consume the same approval.
async function findPublishProposal(client, userId, business, capability, enforce) {
  const nameField = business.business_kind === 'restaurant' ? 'restaurantName' : 'businessName';
  const { rows: [grant] } = await client.query(
    `SELECT g.id
       FROM access_grants g
       JOIN access_requests r ON r.id = g.source_request_id
      WHERE g.user_id = $1 AND g.capability = $2
        AND g.subject_type = 'business_proposal'
        AND g.provenance = 'request' AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > clock_timestamp())
        AND r.applicant_id = g.user_id AND r.capability = g.capability
        AND r.subject_type = g.subject_type AND r.subject_key = g.subject_key
        AND r.status = 'approved'
        AND lower(btrim(r.answers->>($3::text))) = lower(btrim($4))
        AND lower(btrim(r.answers#>>'{serviceArea,country}')) = lower(btrim($5))
        AND (NULLIF(btrim(r.answers#>>'{serviceArea,region}'), '') IS NULL
             OR lower(btrim(r.answers#>>'{serviceArea,region}')) = lower(btrim($6)))
        AND (NULLIF(btrim(r.answers#>>'{serviceArea,city}'), '') IS NULL
             OR lower(btrim(r.answers#>>'{serviceArea,city}')) = lower(btrim($7)))
        AND (NULLIF(btrim(r.answers#>>'{serviceArea,postalCode}'), '') IS NULL
             OR lower(btrim(r.answers#>>'{serviceArea,postalCode}')) = lower(btrim($8)))
        AND NOT EXISTS (
          SELECT 1 FROM access_grants existing
           WHERE existing.user_id = g.user_id AND existing.capability = g.capability
             AND existing.subject_type = 'business' AND existing.subject_id = $9
        )
      ORDER BY g.id
      LIMIT 1 ${enforce ? 'FOR UPDATE OF g' : ''}`,
    [userId, capability, nameField, business.business_name, business.address_country,
      business.address_state, business.address_city, business.address_zip, String(business.id)],
  );
  return grant || null;
}

/** @returns {Promise<{allowed:boolean, code?:string, capability?:string}>} */
async function checkPublish(db, { userId, businessId, kind, proposalDraft }) {
  const mode = flags.businessEnforcement();
  if (mode === 'off') return { allowed: true };
  const facts = await loadFacts(userId, db);
  const now = Date.now();
  if (factsAllowPublishing(facts, businessId, kind, now)) return { allowed: true };
  const capability = capabilityForKind(kind);
  if (proposalDraft && !proposalDraft.published_at && accountActive(facts.user, now)) {
    const enforce = mode === 'enforce';
    const proposal = await findPublishProposal(db, userId, proposalDraft, capability, enforce);
    if (proposal) {
      if (enforce) {
        await db.query(
          `UPDATE access_grants
              SET subject_type = 'business', subject_id = $2, subject_key = 'business:' || ($2::varchar),
                  version = version + 1, updated_at = NOW()
            WHERE id = $1`,
          [proposal.id, String(businessId)],
        );
        await bumpProjection(db, userId);
      }
      return { allowed: true };
    }
  }
  if (mode === 'shadow') {
    logger.info('access.shadow_mismatch', { gate: 'business_publish', capability });
    return { allowed: true };
  }
  return { allowed: false, code: 'access_required', capability };
}

module.exports = { checkPublish, capabilityForKind };
