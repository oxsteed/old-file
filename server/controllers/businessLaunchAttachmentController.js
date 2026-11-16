'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const logger = require('../utils/logger');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const { enqueueStorageDeletion } = require('../services/storageCleanupService');

const VISIBILITIES = new Set(['shared', 'applicant_only', 'consultant_only', 'internal']);

function isAdmin(req) {
  return Boolean(req.isSuper || ['admin', 'super_admin'].includes(req.user?.role));
}

async function loadRequest(id) {
  const { rows } = await db.query(
    `SELECT id, user_id, consultant_assigned_id
       FROM consulting_requests WHERE id = $1`, [id],
  );
  return rows[0] || null;
}

function actorType(req, launchRequest) {
  if (isAdmin(req)) return 'admin';
  if (String(req.user?.id) === String(launchRequest.user_id)) return 'applicant';
  if (String(req.user?.id) === String(launchRequest.consultant_assigned_id)) return 'consultant';
  return null;
}

function visibleClause(type) {
  if (type === 'admin') return 'TRUE';
  if (type === 'applicant') return `visibility IN ('shared', 'applicant_only')`;
  if (type === 'consultant') return `visibility IN ('shared', 'consultant_only')`;
  return 'FALSE';
}

function present(row) {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    originalName: row.original_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    visibility: row.visibility,
    uploadedBy: String(row.uploaded_by),
    createdAt: row.created_at,
  };
}

async function uploadAttachment(req, res) {
  let storageKey = null;
  try {
    const launchRequest = await loadRequest(req.params.id);
    const type = launchRequest && actorType(req, launchRequest);
    if (!type) return res.status(404).json({ error: 'Request not found' });
    if (!req.file) return res.status(400).json({ error: 'file is required', code: 'attachment_required' });

    const requested = String(req.body?.visibility || 'shared').trim().toLowerCase();
    if (!VISIBILITIES.has(requested)) return res.status(400).json({ error: 'Invalid attachment visibility', code: 'invalid_visibility' });
    if (type === 'applicant' && ['consultant_only', 'internal'].includes(requested)) {
      return res.status(403).json({ error: 'Applicants cannot create adviser-only files', code: 'visibility_forbidden' });
    }
    if (type === 'consultant' && ['applicant_only', 'internal'].includes(requested)) {
      return res.status(403).json({ error: 'Consultants cannot create applicant-only files', code: 'visibility_forbidden' });
    }

    storageKey = await uploadFile(
      req.file.buffer,
      `business-launch/private/${launchRequest.id}`,
      req.file.originalname,
      req.file.mimetype,
    );
    if (!storageKey) return res.status(503).json({ error: 'File storage is not configured', code: 'storage_unavailable' });

    const digest = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const { rows } = await db.query(
      `INSERT INTO business_launch_attachments
         (request_id, uploaded_by, storage_key, original_name, content_type, size_bytes, sha256, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, request_id, uploaded_by, original_name, content_type, size_bytes, visibility, created_at`,
      [launchRequest.id, req.user.id, storageKey, String(req.file.originalname || 'file').slice(0, 255), req.file.mimetype, req.file.size, digest, requested],
    );
    storageKey = null;
    return res.status(201).json({ attachment: present(rows[0]) });
  } catch (err) {
    if (storageKey) await deleteFile(storageKey).catch(() => {});
    logger.error('Business Launch attachment upload failed', { requestId: req.params.id, code: err.code });
    return res.status(500).json({ error: 'Failed to upload attachment' });
  }
}

async function listAttachments(req, res) {
  try {
    const launchRequest = await loadRequest(req.params.id);
    const type = launchRequest && actorType(req, launchRequest);
    if (!type) return res.status(404).json({ error: 'Request not found' });
    const { rows } = await db.query(
      `SELECT id, request_id, uploaded_by, original_name, content_type, size_bytes, visibility, created_at
         FROM business_launch_attachments
        WHERE request_id = $1 AND deleted_at IS NULL AND (${visibleClause(type)})
        ORDER BY created_at DESC, id DESC`, [launchRequest.id],
    );
    res.set('Cache-Control', 'private, no-store');
    return res.json({ attachments: rows.map(present) });
  } catch (err) {
    logger.error('Business Launch attachment list failed', { requestId: req.params.id, code: err.code });
    return res.status(500).json({ error: 'Failed to load attachments' });
  }
}

async function downloadAttachment(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.request_id, a.storage_key, a.visibility, cr.user_id, cr.consultant_assigned_id
         FROM business_launch_attachments a
         JOIN consulting_requests cr ON cr.id = a.request_id
        WHERE a.id = $1 AND a.deleted_at IS NULL`, [req.params.attachmentId],
    );
    const row = rows[0];
    const type = row && actorType(req, row);
    if (!row || !type) return res.status(404).json({ error: 'Attachment not found' });
    const allowed = type === 'admin' || (type === 'applicant' && ['shared', 'applicant_only'].includes(row.visibility))
      || (type === 'consultant' && ['shared', 'consultant_only'].includes(row.visibility));
    if (!allowed) return res.status(404).json({ error: 'Attachment not found' });
    const url = await getSignedDownloadUrl(row.storage_key, 900);
    if (!url) return res.status(503).json({ error: 'File download is temporarily unavailable', code: 'storage_unavailable' });
    res.set('Cache-Control', 'private, no-store');
    return res.json({ url });
  } catch (err) {
    logger.error('Business Launch attachment download failed', { attachmentId: req.params.attachmentId, code: err.code });
    return res.status(500).json({ error: 'Failed to prepare download' });
  }
}

async function deleteAttachment(req, res) {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.storage_key, a.uploaded_by, cr.user_id, cr.consultant_assigned_id
         FROM business_launch_attachments a
         JOIN consulting_requests cr ON cr.id = a.request_id
        WHERE a.id = $1 AND a.deleted_at IS NULL`, [req.params.attachmentId],
    );
    const row = rows[0];
    const type = row && actorType(req, row);
    if (!row || !type) return res.status(404).json({ error: 'Attachment not found' });
    if (!isAdmin(req) && String(row.uploaded_by) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the uploader or an administrator can remove this attachment', code: 'attachment_delete_forbidden' });
    }
    await db.query('UPDATE business_launch_attachments SET deleted_at = NOW(), deleted_by = $2 WHERE id = $1', [row.id, req.user.id]);
    await enqueueStorageDeletion(row.storage_key, 'business_launch_attachment_deleted');
    return res.json({ deleted: true });
  } catch (err) {
    logger.error('Business Launch attachment delete failed', { attachmentId: req.params.attachmentId, code: err.code });
    return res.status(500).json({ error: 'Failed to remove attachment' });
  }
}

module.exports = { uploadAttachment, listAttachments, downloadAttachment, deleteAttachment };
