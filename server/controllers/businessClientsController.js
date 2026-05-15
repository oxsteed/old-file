// server/controllers/businessClientsController.js
//
// Per-business client (CRM) endpoints used by the Business Hub > Clients tab.

const pool   = require('../db');
const logger = require('../utils/logger');
const { sendError, sendSuccess } = require('../utils/apiError');
const {
  canAccessBusinessTeam,
  canManageBusinessFinance,
} = require('../utils/businessOwnership');

const VALID_STATUSES = new Set(['lead', 'active', 'past', 'archived', 'blocked']);
const VALID_CONTACTS = new Set(['email', 'phone', 'sms']);

const MAX_NAME = 160;
const MAX_NOTES = 4000;
const MAX_EMAIL = 255;
const MAX_PHONE = 60;

function sanitizeTags(input) {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(
    input
      .map((t) => String(t || '').trim().slice(0, 40))
      .filter(Boolean)
  )).slice(0, 12);
}

function validatePayload(body, { partial = false } = {}) {
  const fields = {};
  if (!partial || 'display_name' in body) {
    const dn = (body.display_name || '').trim();
    if (!dn) fields.display_name = 'Name is required';
    else if (dn.length > MAX_NAME) fields.display_name = `Name must be ${MAX_NAME} characters or fewer`;
  }
  if ('email' in body && body.email && String(body.email).length > MAX_EMAIL) {
    fields.email = `Email must be ${MAX_EMAIL} characters or fewer`;
  }
  if ('phone' in body && body.phone && String(body.phone).length > MAX_PHONE) {
    fields.phone = `Phone must be ${MAX_PHONE} characters or fewer`;
  }
  if ('status' in body && body.status && !VALID_STATUSES.has(body.status)) {
    fields.status = 'Invalid status';
  }
  if ('preferred_contact' in body && body.preferred_contact && !VALID_CONTACTS.has(body.preferred_contact)) {
    fields.preferred_contact = 'Invalid preferred contact';
  }
  if ('internal_notes' in body && body.internal_notes && String(body.internal_notes).length > MAX_NOTES) {
    fields.internal_notes = `Notes must be ${MAX_NOTES} characters or fewer`;
  }
  return fields;
}

/* ---------------------------------------------------------------------------
 * GET /api/businesses/:id/clients
 * Query: status, search, sort=name|recent|lifetime, limit, offset
 * ------------------------------------------------------------------------- */
exports.listBusinessClients = async (req, res) => {
  try {
    const { id: bizId } = req.params;
    const access = await canAccessBusinessTeam(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const status = req.query.status;
    const search = (req.query.search || '').trim();
    const sort = req.query.sort || 'recent';

    const params = [bizId];
    const whereParts = [`bc.business_id = $1`, `bc.deleted_at IS NULL`];
    if (status && VALID_STATUSES.has(status)) {
      params.push(status);
      whereParts.push(`bc.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      whereParts.push(`(LOWER(bc.display_name) LIKE $${params.length}
                       OR LOWER(COALESCE(bc.email,'')) LIKE $${params.length}
                       OR COALESCE(bc.phone,'') LIKE $${params.length})`);
    }
    const orderBy =
      sort === 'name'     ? `bc.display_name ASC` :
      sort === 'lifetime' ? `bc.lifetime_value_cents DESC NULLS LAST, bc.created_at DESC` :
                            `bc.last_job_at DESC NULLS LAST, bc.created_at DESC`;

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT bc.id, bc.business_id, bc.customer_id, bc.display_name,
              bc.email, bc.phone, bc.address_line, bc.city, bc.state,
              bc.postal_code, bc.country, bc.status, bc.tags,
              bc.internal_notes, bc.preferred_contact,
              bc.lifetime_value_cents, bc.total_jobs, bc.last_job_at,
              bc.first_seen_at, bc.created_at, bc.updated_at,
              u.first_name AS linked_first_name,
              u.last_name  AS linked_last_name,
              u.profile_photo_url AS linked_photo_url
         FROM business_clients bc
         LEFT JOIN users u ON u.id = bc.customer_id
        WHERE ${whereParts.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::INT AS total FROM business_clients bc WHERE ${whereParts.join(' AND ')}`,
      params.slice(0, params.length - 2)
    );

    sendSuccess(res, {
      clients: rows,
      total: countRows[0]?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    logger.error('listBusinessClients failed', { error: err.message });
    sendError(res, 500, 'Failed to load clients', 'clients_load_failed');
  }
};

/* ---------------------------------------------------------------------------
 * POST /api/businesses/:id/clients
 * ------------------------------------------------------------------------- */
exports.createBusinessClient = async (req, res) => {
  try {
    const { id: bizId } = req.params;
    const access = await canManageBusinessFinance(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const fields = validatePayload(req.body || {});
    if (Object.keys(fields).length) {
      return sendError(res, 400, 'Validation failed', 'validation_failed', { fields });
    }

    const {
      display_name, email, phone, address_line, city, state, postal_code, country,
      status = 'active', preferred_contact, internal_notes, customer_id, tags,
    } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO business_clients (
         business_id, customer_id, display_name, email, phone,
         address_line, city, state, postal_code, country,
         status, preferred_contact, internal_notes, tags, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        bizId, customer_id || null, String(display_name).trim(),
        email || null, phone || null, address_line || null,
        city || null, state || null, postal_code || null, country || null,
        status, preferred_contact || null, internal_notes || null,
        sanitizeTags(tags), req.user.id,
      ]
    );
    sendSuccess(res, { client: rows[0] }, 201);
  } catch (err) {
    if (err.code === '23505') {
      return sendError(res, 409, 'This customer is already in your client list', 'duplicate_customer');
    }
    logger.error('createBusinessClient failed', { error: err.message });
    sendError(res, 500, 'Failed to add client', 'client_create_failed');
  }
};

/* ---------------------------------------------------------------------------
 * PUT /api/businesses/:id/clients/:clientId
 * ------------------------------------------------------------------------- */
exports.updateBusinessClient = async (req, res) => {
  try {
    const { id: bizId, clientId } = req.params;
    const access = await canManageBusinessFinance(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const fields = validatePayload(req.body || {}, { partial: true });
    if (Object.keys(fields).length) {
      return sendError(res, 400, 'Validation failed', 'validation_failed', { fields });
    }

    const updates = [];
    const params = [];
    const pushSet = (col, value) => { params.push(value); updates.push(`${col} = $${params.length}`); };

    const body = req.body || {};
    if ('display_name' in body)   pushSet('display_name', String(body.display_name).trim());
    if ('email' in body)          pushSet('email', body.email || null);
    if ('phone' in body)          pushSet('phone', body.phone || null);
    if ('address_line' in body)   pushSet('address_line', body.address_line || null);
    if ('city' in body)           pushSet('city', body.city || null);
    if ('state' in body)          pushSet('state', body.state || null);
    if ('postal_code' in body)    pushSet('postal_code', body.postal_code || null);
    if ('country' in body)        pushSet('country', body.country || null);
    if ('status' in body && VALID_STATUSES.has(body.status)) pushSet('status', body.status);
    if ('preferred_contact' in body) pushSet('preferred_contact', body.preferred_contact || null);
    if ('internal_notes' in body) pushSet('internal_notes', body.internal_notes || null);
    if ('tags' in body)           pushSet('tags', sanitizeTags(body.tags));
    if ('customer_id' in body)    pushSet('customer_id', body.customer_id || null);

    if (updates.length === 0) {
      const { rows: existing } = await pool.query(
        `SELECT * FROM business_clients WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [clientId, bizId]
      );
      if (!existing[0]) return sendError(res, 404, 'Client not found', 'not_found');
      return sendSuccess(res, { client: existing[0] });
    }

    params.push(clientId, bizId);
    const { rows } = await pool.query(
      `UPDATE business_clients SET ${updates.join(', ')}
         WHERE id = $${params.length - 1} AND business_id = $${params.length} AND deleted_at IS NULL
         RETURNING *`,
      params
    );
    if (!rows[0]) return sendError(res, 404, 'Client not found', 'not_found');
    sendSuccess(res, { client: rows[0] });
  } catch (err) {
    logger.error('updateBusinessClient failed', { error: err.message });
    sendError(res, 500, 'Failed to update client', 'client_update_failed');
  }
};

/* ---------------------------------------------------------------------------
 * DELETE /api/businesses/:id/clients/:clientId  (soft delete)
 * ------------------------------------------------------------------------- */
exports.deleteBusinessClient = async (req, res) => {
  try {
    const { id: bizId, clientId } = req.params;
    const access = await canManageBusinessFinance(req.user.id, bizId);
    if (!access) return sendError(res, 403, 'Access denied', 'forbidden');

    const { rowCount } = await pool.query(
      `UPDATE business_clients SET deleted_at = NOW()
         WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [clientId, bizId]
    );
    if (!rowCount) return sendError(res, 404, 'Client not found', 'not_found');
    sendSuccess(res, { ok: true });
  } catch (err) {
    logger.error('deleteBusinessClient failed', { error: err.message });
    sendError(res, 500, 'Failed to delete client', 'client_delete_failed');
  }
};
