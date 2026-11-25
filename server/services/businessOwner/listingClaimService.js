'use strict';
// Groups 5-6 item 201: claim an imported directory listing for a business
// the claimant owns. Industry pattern (Google Business Profile, Yelp): the
// claim is evidence-backed and reviewed; approval only links the listing to
// the business (prospect_businesses.matched_business_id). It never grants
// ownership capabilities, money access, or edits the business itself.
const pool = require('../../db');
const { withTransaction } = require('../../utils/transaction');
const { fail, invalid, text, uuid, int, notify } = require('./common');

const PUBLIC_LISTING = 'p.id, p.business_name, p.region, p.postal_code, p.country, p.category_code';

async function searchListings(query) {
  const q = text(query, 100, { min: 2 });
  const { rows } = await pool.query(`SELECT ${PUBLIC_LISTING} FROM prospect_businesses p
    WHERE p.usable IS NOT FALSE AND p.matched_business_id IS NULL AND 'marketing_outreach' = ANY(p.permitted_uses) AND p.business_name ILIKE $1
    ORDER BY p.business_name LIMIT 20`, [`%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`]);
  return { listings: rows };
}

function emailDomain(value) { const m = /@([^@\s]+)$/.exec(String(value || '').toLowerCase()); return m ? m[1] : null; }
function digits(value) { return String(value || '').replace(/\D/g, '').slice(-10); }

async function submit(claimantId, body) {
  const requestId = uuid(body?.requestId, 'requestId');
  const prospectId = int(body?.listing_id, { min: 1, field: 'listing_id' });
  const businessId = int(body?.business_id, { min: 1, field: 'business_id' });
  if (!['owner', 'officer', 'authorized_manager'].includes(body?.relationship)) invalid('relationship');
  const evidence = text(body?.evidence, 2000, { min: 20 });
  return withTransaction(pool, async db => {
    const { rows: [prior] } = await db.query('SELECT * FROM business_listing_claims WHERE claimant_id=$1 AND request_id=$2', [claimantId, requestId]);
    if (prior) {
      if (String(prior.prospect_id) !== String(prospectId) || prior.business_id !== businessId) fail(409, 'idempotency_conflict');
      return prior;
    }
    const { rows: [biz] } = await db.query('SELECT id, user_id, phone, website FROM businesses WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [businessId]);
    // Only the business owner can claim on its behalf; 404 hides others.
    if (!biz || String(biz.user_id) !== String(claimantId)) fail(404, 'not_found');
    const { rows: [listing] } = await db.query('SELECT * FROM prospect_businesses WHERE id=$1 FOR UPDATE', [prospectId]);
    // Licence gate (D-201): only listings licensed for owner outreach can be claimed.
    if (!listing || listing.usable === false || !(listing.permitted_uses || []).includes('marketing_outreach')) fail(404, 'not_found');
    if (listing.matched_business_id) fail(409, 'listing_already_claimed');
    const { rows: [user] } = await db.query('SELECT email, phone FROM users WHERE id=$1', [claimantId]);
    const listingDomain = emailDomain(listing.contact_email) || (listing.website ? String(listing.website).replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, '').toLowerCase() : null);
    const contactMatch = Boolean((listingDomain && emailDomain(user?.email) === listingDomain)
      || (digits(listing.contact_phone) && [digits(user?.phone), digits(biz.phone)].includes(digits(listing.contact_phone))));
    const { rows: [open] } = await db.query("SELECT id FROM business_listing_claims WHERE prospect_id=$1 AND business_id=$2 AND status='pending'", [prospectId, businessId]);
    if (open) fail(409, 'claim_already_pending');
    const { rows: [row] } = await db.query(`INSERT INTO business_listing_claims(prospect_id,business_id,claimant_id,request_id,relationship,evidence,contact_match)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [prospectId, businessId, claimantId, requestId, body.relationship, evidence, contactMatch]);
    return row;
  }, 'business_listing_claim_submit');
}

async function listMine(claimantId) {
  const { rows } = await pool.query(`SELECT c.id, c.business_id, c.relationship, c.status, c.decision_reason, c.created_at, c.decided_at,
      p.business_name AS listing_name, p.region, p.postal_code FROM business_listing_claims c JOIN prospect_businesses p ON p.id=c.prospect_id
    WHERE c.claimant_id=$1 ORDER BY c.created_at DESC LIMIT 50`, [claimantId]);
  return { claims: rows };
}

async function withdraw(claimantId, claimId) {
  uuid(claimId, 'claim');
  const { rows: [row] } = await pool.query(`UPDATE business_listing_claims SET status='withdrawn', updated_at=NOW()
    WHERE id=$1 AND claimant_id=$2 AND status='pending' RETURNING id, status`, [claimId, claimantId]);
  if (!row) fail(409, 'claim_not_pending');
  return row;
}

async function queue({ status = 'pending' } = {}) {
  if (!['pending', 'approved', 'rejected', 'withdrawn'].includes(status)) invalid('status');
  const { rows } = await pool.query(`SELECT c.*, p.business_name AS listing_name, p.region, p.postal_code, p.license_ref, p.source,
      b.business_name, u.email AS claimant_email, u.first_name, u.last_name
    FROM business_listing_claims c JOIN prospect_businesses p ON p.id=c.prospect_id JOIN businesses b ON b.id=c.business_id
    JOIN users u ON u.id=c.claimant_id WHERE c.status=$1 ORDER BY c.created_at LIMIT 100`, [status]);
  return { claims: rows };
}

async function decide(adminId, claimId, body) {
  uuid(claimId, 'claim');
  if (!['approve', 'reject'].includes(body?.decision)) invalid('decision');
  const reason = text(body?.reason, 500, { required: body.decision === 'reject' });
  const out = await withTransaction(pool, async db => {
    const { rows: [c] } = await db.query('SELECT * FROM business_listing_claims WHERE id=$1 FOR UPDATE', [claimId]);
    if (!c) fail(404, 'not_found');
    if (c.status !== 'pending') fail(409, 'claim_not_pending');
    if (String(c.claimant_id) === String(adminId)) fail(403, 'self_review_forbidden');
    if (body.decision === 'approve') {
      const { rows: [listing] } = await db.query('SELECT matched_business_id FROM prospect_businesses WHERE id=$1 FOR UPDATE', [c.prospect_id]);
      if (listing.matched_business_id) fail(409, 'listing_already_claimed');
      await db.query('UPDATE prospect_businesses SET matched_business_id=$2, updated_at=NOW() WHERE id=$1', [c.prospect_id, c.business_id]);
      await db.query(`UPDATE business_listing_claims SET status='rejected', decided_at=NOW(), decision_reason='listing_claimed_by_another', updated_at=NOW()
        WHERE prospect_id=$1 AND status='pending' AND id<>$2`, [c.prospect_id, c.id]);
    }
    const { rows: [row] } = await db.query(`UPDATE business_listing_claims SET status=$2, decided_by=$3, decided_at=NOW(), decision_reason=$4, updated_at=NOW()
      WHERE id=$1 RETURNING *`, [claimId, body.decision === 'approve' ? 'approved' : 'rejected', adminId, reason]);
    return row;
  }, 'business_listing_claim_decide');
  await notify(out.claimant_id, out.status === 'approved' ? 'business_listing_claim_approved' : 'business_listing_claim_rejected',
    { claim_id: out.id, business_id: out.business_id }, `listing-claim:${out.id}:${out.status}`, `/business/${out.business_id}/workspace/owner-console`);
  return out;
}

module.exports = { searchListings, submit, listMine, withdraw, queue, decide };
