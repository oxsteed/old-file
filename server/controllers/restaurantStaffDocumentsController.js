// OxSteed Restaurants — Staff compliance document vault + SOP
// acknowledgements (S-14).
//
// The vault stores per-employee files (certificates, ID documents,
// handbook copies) with type, expiry and verification status. File bytes
// live in the existing storage (utils/storage); reads mint a short-lived
// signed download URL at request time — there are no public paths.
//
// HARD CONSTRAINT: OxSteed never stores SSNs or tax-form data. I-9/W-4
// stay with the business's payroll provider; this vault is for
// certificates, IDs and policy documents only.
//
// Access: managers (owner/manager) see and verify every document of the
// restaurant; a staff member sees and uploads only their own.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissionsService = require('../services/permissionsService');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');

const DOC_TYPES = [
  'certificate_food_handler', 'certificate_allergen', 'certificate_manager',
  'certificate_other', 'id_document', 'policy_handbook', 'sop_document', 'other',
];
const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'];

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return resolveRestaurantAccess(userId, restaurantId);
}

async function assertManage(restaurant, userId) {
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, ['restaurant.manage']);
  if (!allowed) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

function parseDateField(value, code, label) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(`${label} is not a valid date`, 400, code);
  return d.toISOString().slice(0, 10);
}

async function presentDocument(row) {
  const { storage_key, ...rest } = row;
  let downloadUrl = null;
  try {
    downloadUrl = await getSignedDownloadUrl(storage_key, 600);
  } catch (_) {
    downloadUrl = null;
  }
  return { ...rest, download_url: downloadUrl };
}

// ── Documents ────────────────────────────────────────────────────────────────
exports.listDocuments = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = await permissionsService.hasRestaurantPermission(restaurant, req.user.id, ['restaurant.manage']);
    // Staff only ever see their own documents.
    const targetUserId = isManager ? (req.query.userId || null) : req.user.id;
    const expiringDays = parsePositiveInt(req.query.expiringDays);
    const { rows } = await pool.query(
      `SELECT d.*, u.first_name, u.last_name
         FROM restaurant_staff_documents d
         JOIN users u ON u.id = d.user_id
        WHERE d.restaurant_id = $1
          ${targetUserId ? 'AND d.user_id = $2' : ''}
          ${expiringDays ? `AND d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE + ($${targetUserId ? 3 : 2}::int * INTERVAL '1 day')` : ''}
        ORDER BY d.expires_on NULLS LAST, d.created_at DESC`,
      [
        restaurantId,
        ...(targetUserId ? [targetUserId] : []),
        ...(expiringDays ? [expiringDays] : []),
      ]
    );
    res.json({ documents: await Promise.all(rows.map(presentDocument)) });
  } catch (err) {
    next(err);
  }
};

exports.uploadDocument = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = await permissionsService.hasRestaurantPermission(restaurant, req.user.id, ['restaurant.manage']);
    if (!req.file || !req.file.buffer) throw new AppError('A document file is required', 400, 'file_required');
    const { docType, title, userId, issuedOn, expiresOn } = req.body || {};
    if (!DOC_TYPES.includes(docType)) throw new AppError('Invalid document type', 400, 'invalid_doc_type');
    if (!title || !String(title).trim()) throw new AppError('Title is required', 400, 'title_required');
    // Staff upload for themselves; only managers upload for someone else.
    const targetUserId = userId && String(userId) !== String(req.user.id) ? String(userId) : req.user.id;
    if (targetUserId !== req.user.id && !isManager) {
      throw new AppError('You can only upload your own documents', 403, 'forbidden');
    }
    const { rows: [member] } = await pool.query(
      `SELECT 1 FROM business_members
        WHERE business_id = $1 AND member_id = $2 AND status = 'active'`,
      [restaurant.business_id, targetUserId]
    );
    const isOwner = String(restaurant.owner_user_id || '') === String(targetUserId);
    if (!member && !isOwner) throw new AppError('Staff member not found', 404, 'staff_not_found');

    const storageKey = await uploadFile(
      req.file.buffer,
      `restaurants/${restaurantId}/staff-documents/${targetUserId}`,
      req.file.originalname || 'document',
      req.file.mimetype
    );
    if (!storageKey) throw new AppError('Upload failed', 502, 'upload_failed');
    try {
      const { rows: [document] } = await pool.query(
        `INSERT INTO restaurant_staff_documents
           (restaurant_id, user_id, doc_type, title, storage_key, original_filename,
            content_type, size_bytes, issued_on, expires_on, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          restaurantId, targetUserId, docType, String(title).trim(), storageKey,
          req.file.originalname || null, req.file.mimetype || null,
          req.file.size || null,
          parseDateField(issuedOn, 'invalid_issued_on', 'Issued date'),
          parseDateField(expiresOn, 'invalid_expires_on', 'Expiry date'),
          req.user.id,
        ]
      );
      res.status(201).json({ document: await presentDocument(document) });
    } catch (err) {
      // Do not orphan the uploaded bytes when the row write fails.
      await deleteFile(storageKey).catch(() => {});
      throw err;
    }
  } catch (err) {
    next(err);
  }
};

exports.verifyDocument = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const documentId = parsePositiveInt(req.params.documentId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { verificationStatus, expiresOn, issuedOn } = req.body || {};
    if (verificationStatus !== undefined && !VERIFICATION_STATUSES.includes(verificationStatus)) {
      throw new AppError('Invalid verification status', 400, 'invalid_verification_status');
    }
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM restaurant_staff_documents WHERE id = $1 AND restaurant_id = $2`,
      [documentId, restaurantId]
    );
    if (!existing) throw new AppError('Document not found', 404, 'document_not_found');
    const nextExpires = expiresOn === undefined
      ? existing.expires_on
      : parseDateField(expiresOn, 'invalid_expires_on', 'Expiry date');
    const expiryChanged = String(nextExpires || '') !== String(existing.expires_on || '').slice(0, 10);
    const { rows: [document] } = await pool.query(
      `UPDATE restaurant_staff_documents
          SET verification_status = COALESCE($3, verification_status),
              verified_by = CASE WHEN $3 IS NULL THEN verified_by ELSE $4 END,
              verified_at = CASE WHEN $3 IS NULL THEN verified_at ELSE NOW() END,
              expires_on = $5,
              issued_on = $6,
              expiry_alert_sent_at = CASE WHEN $7 THEN NULL ELSE expiry_alert_sent_at END,
              updated_at = NOW()
        WHERE id = $1 AND restaurant_id = $2
        RETURNING *`,
      [
        documentId, restaurantId,
        verificationStatus === undefined ? null : verificationStatus,
        req.user.id,
        nextExpires,
        issuedOn === undefined ? existing.issued_on : parseDateField(issuedOn, 'invalid_issued_on', 'Issued date'),
        expiryChanged,
      ]
    );
    res.json({ document: await presentDocument(document) });
  } catch (err) {
    next(err);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const documentId = parsePositiveInt(req.params.documentId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const { rows: [document] } = await pool.query(
      `DELETE FROM restaurant_staff_documents WHERE id = $1 AND restaurant_id = $2 RETURNING storage_key`,
      [documentId, restaurantId]
    );
    if (!document) throw new AppError('Document not found', 404, 'document_not_found');
    await deleteFile(document.storage_key).catch(() => {});
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
};

// ── SOP acknowledgements ─────────────────────────────────────────────────────
// Read-and-sign: the acknowledgement pins the SOP version that was read,
// so republishing a SOP (version bump in restaurantOpsController) makes
// earlier acknowledgements visibly stale instead of silently current.
exports.acknowledgeSop = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const sopId = parsePositiveInt(req.params.sopId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [sop] } = await pool.query(
      `SELECT id, version FROM restaurant_sops WHERE id = $1 AND restaurant_id = $2 AND is_published = TRUE`,
      [sopId, restaurantId]
    );
    if (!sop) throw new AppError('SOP not found', 404, 'sop_not_found');
    const { rows: [acknowledgement] } = await pool.query(
      `INSERT INTO restaurant_sop_acknowledgements (restaurant_id, sop_id, user_id, sop_version)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sop_id, user_id, sop_version) DO NOTHING
       RETURNING *`,
      [restaurantId, sopId, req.user.id, sop.version]
    );
    if (!acknowledgement) {
      const { rows: [existing] } = await pool.query(
        `SELECT * FROM restaurant_sop_acknowledgements
          WHERE sop_id = $1 AND user_id = $2 AND sop_version = $3`,
        [sopId, req.user.id, sop.version]
      );
      return res.json({ acknowledgement: existing, alreadyAcknowledged: true });
    }
    res.status(201).json({ acknowledgement });
  } catch (err) {
    next(err);
  }
};

exports.listSopAcknowledgements = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const isManager = await permissionsService.hasRestaurantPermission(restaurant, req.user.id, ['restaurant.manage']);
    const sopId = parsePositiveInt(req.query.sopId);
    // Managers see the restaurant's sign-off state; staff see their own.
    const { rows } = await pool.query(
      `SELECT ack.*, s.title AS sop_title, s.version AS sop_current_version,
              u.first_name, u.last_name,
              (ack.sop_version = s.version) AS is_current
         FROM restaurant_sop_acknowledgements ack
         JOIN restaurant_sops s ON s.id = ack.sop_id
         JOIN users u ON u.id = ack.user_id
        WHERE ack.restaurant_id = $1
          ${isManager ? '' : 'AND ack.user_id = $2'}
          ${sopId ? `AND ack.sop_id = $${isManager ? 2 : 3}` : ''}
        ORDER BY ack.acknowledged_at DESC`,
      [
        restaurantId,
        ...(!isManager ? [req.user.id] : []),
        ...(sopId ? [sopId] : []),
      ]
    );
    res.json({ acknowledgements: rows });
  } catch (err) {
    next(err);
  }
};

exports.docTypes = DOC_TYPES;
