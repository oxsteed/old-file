'use strict';

// Staffing agencies and recruiters (docs/careers/marketplace.md §12).
// An agency is an ordinary verified OxSteed business. A hiring manager at
// the agency requests a link to a client business with a permission set
// (post_openings, manage_pipeline, source_talent); only the client's
// owner can approve, narrow or revoke it, and either owner can end it.
// While active, agency hiring staff can post openings for the client
// (labelled "Posted by a staffing agency"), manage the pipeline of the
// openings they posted, and (with source_talent) search talent for the
// client. Every write is audited in both businesses' logs.

const { AppError } = require('../../../middleware/errorHandler');
const { AGENCY_PERMISSIONS } = require('../../careerCatalog');
const { notifyUser } = require('../notify');
const plans = require('./plans');
const { requireId, notFound } = require('./common');

function parsePermissions(list) {
  const perms = [...new Set((Array.isArray(list) ? list : []).map(String).filter((p) => AGENCY_PERMISSIONS.includes(p)))];
  if (!perms.length) throw new AppError('Validation failed', 400, 'validation_failed', { permissions: 'Pick at least one permission' });
  return perms;
}

async function requestLink(db, { agencyAccess, actor, body }) {
  const clientId = requireId(body.client_business_id, 'Business not found');
  if (clientId === agencyAccess.businessId) throw new AppError('Validation failed', 400, 'validation_failed', { client_business_id: 'Pick another business' });
  const perms = parsePermissions(body.permissions || ['post_openings', 'manage_pipeline']);
  const { rows: [agency] } = await db.query('SELECT is_business_verified FROM businesses WHERE id = $1', [agencyAccess.businessId]);
  if (!agency?.is_business_verified) throw new AppError('Verify your agency before linking to clients', 403, 'business_not_verified');
  const { rows: [client] } = await db.query('SELECT id, user_id, business_name FROM businesses WHERE id = $1 AND deleted_at IS NULL', [clientId]);
  if (!client) throw notFound('Business not found');
  const { rows: [{ n }] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM career_agency_links WHERE agency_business_id = $1 AND status IN ('pending','active')`,
    [agencyAccess.businessId]
  );
  await plans.assertWithin(db, agencyAccess.businessId, 'agency_clients', n);
  let link;
  try {
    ({ rows: [link] } = await db.query(
      `INSERT INTO career_agency_links (agency_business_id, client_business_id, permissions, requested_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [agencyAccess.businessId, clientId, perms, actor.id]
    ));
  } catch (err) {
    if (err.code === '23505') throw new AppError('A link with this business already exists', 409, 'agency_link_exists');
    throw err;
  }
  await notifyUser(db, {
    userId: client.user_id,
    type: 'career_agency_link_requested',
    params: { agencyName: agencyAccess.businessName },
    actionUrl: `/business/${clientId}/careers?tab=agencies`,
    deliveryKey: `career_agency_link:${link.id}`,
  });
  return link;
}

async function listLinks(db, businessId) {
  const { rows } = await db.query(
    `SELECT l.id, l.agency_business_id, ab.business_name AS agency_name, l.client_business_id, cb.business_name AS client_name,
            l.permissions, l.status, l.created_at, l.decided_at, l.revoked_at,
            CASE WHEN l.agency_business_id = $1 THEN 'agency' ELSE 'client' END AS my_side
       FROM career_agency_links l
       JOIN businesses ab ON ab.id = l.agency_business_id
       JOIN businesses cb ON cb.id = l.client_business_id
      WHERE l.agency_business_id = $1 OR l.client_business_id = $1
      ORDER BY l.created_at DESC LIMIT 200`,
    [businessId]
  );
  return rows;
}

/** Client owner approves (optionally narrowing permissions) or declines. */
async function decide(db, { access, actor, linkId, decision, permissions }) {
  if (!access.isOwner) throw new AppError('Only the business owner can approve agencies', 403, 'owner_only');
  const id = requireId(linkId, 'Link not found');
  const { rows: [link] } = await db.query(
    'SELECT * FROM career_agency_links WHERE id = $1 AND client_business_id = $2 FOR UPDATE', [id, access.businessId]
  );
  if (!link) throw notFound('Link not found');
  if (link.status !== 'pending') throw new AppError('This request was already handled', 409, 'invalid_state');
  if (!['approve', 'decline'].includes(decision)) throw new AppError('Validation failed', 400, 'validation_failed', { decision: 'Approve or decline' });
  let perms = link.permissions;
  if (decision === 'approve' && permissions) perms = parsePermissions(permissions).filter((p) => link.permissions.includes(p));
  if (decision === 'approve' && !perms.length) throw new AppError('Validation failed', 400, 'validation_failed', { permissions: 'Keep at least one permission' });
  const { rows: [row] } = await db.query(
    `UPDATE career_agency_links SET status = $2, permissions = $3, decided_by = $4, decided_at = NOW() WHERE id = $1 RETURNING *`,
    [id, decision === 'approve' ? 'active' : 'declined', perms, actor.id]
  );
  if (link.requested_by) {
    await notifyUser(db, {
      userId: link.requested_by,
      type: decision === 'approve' ? 'career_agency_link_approved' : 'career_agency_link_declined',
      params: { clientName: access.businessName },
      actionUrl: `/business/${link.agency_business_id}/careers?tab=agencies`,
      deliveryKey: `career_agency_link_decided:${id}`,
    });
  }
  return { before: link, after: row };
}

/** Either side's owner (or the agency's requesting hirer) ends the link. */
async function revoke(db, { access, actor, linkId }) {
  const id = requireId(linkId, 'Link not found');
  const { rows: [link] } = await db.query(
    `SELECT * FROM career_agency_links WHERE id = $1 AND (agency_business_id = $2 OR client_business_id = $2) FOR UPDATE`,
    [id, access.businessId]
  );
  if (!link) throw notFound('Link not found');
  if (!access.isOwner && link.requested_by !== actor.id) throw new AppError('Only an owner can end this link', 403, 'owner_only');
  if (!['pending', 'active'].includes(link.status)) throw new AppError('This link is already closed', 409, 'invalid_state');
  const { rows: [row] } = await db.query(
    `UPDATE career_agency_links SET status = 'revoked', revoked_by = $2, revoked_at = NOW() WHERE id = $1 RETURNING *`,
    [id, actor.id]
  );
  return { before: link, after: row };
}

/** Clients an agency user may act for (for the client picker). */
async function clientsFor(db, { agencyBusinessId }) {
  const { rows } = await db.query(
    `SELECT l.client_business_id AS business_id, b.business_name, l.permissions
       FROM career_agency_links l JOIN businesses b ON b.id = l.client_business_id
      WHERE l.agency_business_id = $1 AND l.status = 'active' ORDER BY b.business_name`,
    [agencyBusinessId]
  );
  return rows;
}

module.exports = { parsePermissions, requestLink, listLinks, decide, revoke, clientsFor };
