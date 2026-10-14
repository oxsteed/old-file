'use strict';

// Private per-user notes and receipt attachments on statement entries.
// Owner-only: every query filters on user_id, so a caller can never read,
// change, or delete another user's notes. The referenced statement document
// itself is ownership-checked when a document_id is supplied (fail closed).
// attachment_url stores the private storage object key from POST /upload;
// the service resolves it to a short-lived signed URL at read time so an
// expired signed URL is never persisted.

const AppError = require('../utils/appError');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS = new Set(['oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business']);
const SETTLEMENT_PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);
const missing = () => { throw new AppError('Statement note not found', 404, 'statement_note_not_found'); };
const fail = (code, status = 400) => { throw new AppError(code, status, code); };

function checkProduct(product) {
  if (!PRODUCTS.has(String(product))) fail('statement_invalid_product');
}

function checkEntryId(entryId) {
  const value = String(entryId || '').trim();
  if (value.length < 1 || value.length > 128) fail('statement_note_invalid_entry');
  return value;
}

function checkNoteText(note) {
  const value = String(note ?? '').trim();
  if (value.length < 1 || value.length > 2000) fail('statement_note_invalid_text');
  return value;
}

// Fail closed: the attachment key must live under the caller's own private
// upload prefix, otherwise a caller could pin someone else's object.
// attachmentKey semantics: undefined/null keeps the existing attachment,
// '' removes it, a string replaces it.
function checkAttachmentKey(userId, key) {
  if (key === undefined || key === null) return undefined;
  if (key === '') return null;
  const value = String(key);
  if (!value.startsWith(`user-uploads/${userId}/`) || value.includes('..')) fail('statement_note_invalid_attachment', 403);
  return value;
}

function shape(row) {
  return {
    id: row.id,
    product: row.product,
    documentId: row.document_id,
    entryId: row.entry_id,
    note: row.note,
    hasAttachment: row.attachment_url !== null,
    attachmentUrl: row.attachment_url ? `/api/statements/exports/notes/${row.id}/attachment` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createService({ db = require('../db'), storage = require('../utils/storage') } = {}) {
  // Ownership of the referenced statement document. Interim statements have
  // no archived document (document_id NULL) and skip this check; the note
  // itself stays private to the caller either way.
  async function assertDocumentOwned(userId, product, documentId) {
    if (documentId === null || documentId === undefined || documentId === '') return;
    if (!UUID.test(String(documentId))) missing();
    if (!SETTLEMENT_PRODUCTS.has(product)) {
      const { rows: [doc] } = await db.query(
        'SELECT customer_id FROM credit_statement_documents WHERE id=$1', [documentId]);
      if (!doc || String(doc.customer_id) !== String(userId)) missing();
      return;
    }
    const { rows: [doc] } = await db.query(
      `SELECT product, scope_helper_user_id, scope_business_id, scope_restaurant_id
         FROM settlement_statement_documents WHERE id=$1`, [documentId]);
    if (!doc || doc.product !== product) missing();
    if (product === 'helper_earnings') {
      if (String(doc.scope_helper_user_id) !== String(userId)) missing();
      return;
    }
    if (product === 'business') {
      const { rows: [ok] } = await db.query(
        `SELECT 1 FROM businesses b WHERE b.id=$1 AND (b.user_id=$2 OR EXISTS
           (SELECT 1 FROM business_members m WHERE m.business_id=b.id AND m.member_id=$2
            AND m.status='active' AND m.role='manager'))`,
        [doc.scope_business_id, userId]);
      if (!ok) missing();
      return;
    }
    const { rows: [ok] } = await db.query(
      `SELECT 1 FROM food_restaurants r JOIN businesses b ON b.id=r.business_id
        WHERE r.id=$1 AND (r.owner_user_id=$2 OR b.user_id=$2 OR EXISTS
          (SELECT 1 FROM business_members m WHERE m.business_id=b.id AND m.member_id=$2
           AND m.status='active' AND m.role='manager'))`,
      [doc.scope_restaurant_id, userId]);
    if (!ok) missing();
  }

  async function list(userId, { product, documentId, entryId } = {}) {
    if (!UUID.test(String(userId))) missing();
    const conditions = ['user_id=$1'];
    const params = [userId];
    if (product !== undefined) { checkProduct(product); conditions.push(`product=$${params.length + 1}`); params.push(product); }
    if (documentId !== undefined) {
      if (documentId === null || documentId === '') conditions.push('document_id IS NULL');
      else { if (!UUID.test(String(documentId))) missing(); conditions.push(`document_id=$${params.length + 1}`); params.push(String(documentId)); }
    }
    if (entryId !== undefined) { conditions.push(`entry_id=$${params.length + 1}`); params.push(checkEntryId(entryId)); }
    const { rows } = await db.query(
      `SELECT * FROM statement_entry_notes WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT 200`,
      params);
    return rows.map(shape);
  }

  // One private note per entry: POST creates or replaces the caller's note.
  async function upsert(userId, { product, documentId = null, entryId, note, attachmentKey } = {}) {
    if (!UUID.test(String(userId))) missing();
    checkProduct(product);
    const entry = checkEntryId(entryId);
    const text = checkNoteText(note);
    const attachment = checkAttachmentKey(userId, attachmentKey);
    const document = documentId === null || documentId === '' ? null : String(documentId);
    await assertDocumentOwned(userId, product, document);
    // One private note per entry. An explicit select-then-write keeps the
    // NULL document_id uniqueness rule (expression index) out of the
    // upsert path; concurrent duplicates are rejected by the unique index.
    const { rows: [existing] } = await db.query(
      `SELECT id, attachment_url FROM statement_entry_notes
        WHERE user_id=$1 AND product=$2 AND entry_id=$3
          AND COALESCE(document_id, '') = COALESCE($4, '')`,
      [userId, product, entry, document]);
    let row;
    if (existing) {
      const kept = attachment === undefined ? existing.attachment_url : attachment;
      ({ rows: [row] } = await db.query(
        `UPDATE statement_entry_notes SET note=$1, attachment_url=$2, updated_at=now()
          WHERE id=$3 AND user_id=$4 RETURNING *`,
        [text, kept, existing.id, userId]));
    } else {
      try {
        ({ rows: [row] } = await db.query(
          `INSERT INTO statement_entry_notes (user_id, product, document_id, entry_id, note, attachment_url)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [userId, product, document, entry, text, attachment]));
      } catch (error) {
        if (error.code === '23505') fail('statement_note_conflict', 409);
        throw error;
      }
    }
    return shape(row);
  }

  async function remove(userId, id) {
    if (!UUID.test(String(userId)) || !UUID.test(String(id))) missing();
    const { rows: [row] } = await db.query(
      'DELETE FROM statement_entry_notes WHERE id=$1 AND user_id=$2 RETURNING id', [id, userId]);
    if (!row) missing();
    return { id: row.id, deleted: true };
  }

  // Re-checks ownership, then resolves the private storage key to a
  // short-lived signed URL. The raw key never leaves the server.
  async function attachmentRedirect(userId, id) {
    if (!UUID.test(String(userId)) || !UUID.test(String(id))) missing();
    const { rows: [row] } = await db.query(
      'SELECT attachment_url FROM statement_entry_notes WHERE id=$1 AND user_id=$2', [id, userId]);
    if (!row || !row.attachment_url) missing();
    if (typeof storage.getSignedDownloadUrl !== 'function') {
      throw new AppError('File storage is not configured', 503, 'storage_unavailable');
    }
    return storage.getSignedDownloadUrl(row.attachment_url, 900);
  }

  return { list, upsert, remove, attachmentRedirect, assertDocumentOwned };
}

module.exports = { createService };
module.exports.defaultService = createService();
