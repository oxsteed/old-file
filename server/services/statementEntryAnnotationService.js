'use strict';

// Shared annotations on statement differences (708, D-425): the 688
// annotation pattern (append-only, author recorded, scope derived from the
// annotated record) extended to statement entries.
//
// The anchor is the same (product, document, entry) as the private
// per-user notes — but these annotations are SHARED: any reader authorized
// for the document sees them, so a bookkeeper can annotate a difference
// for another reader to see. The private statement_entry_notes are
// untouched and are never read here.
//
// Scope is enforced by the caller: the investigation router proves the
// document belongs to (or is readable by) the caller via loadDocument
// before calling list/add, so this service does no ownership check of its
// own. Annotations are append-only: there is no update or delete.

const AppError = require('../utils/appError');

const PRODUCTS = new Set(['oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business']);
const fail = (code, status = 400) => { throw new AppError(code, status, code); };

function checkProduct(product) {
  if (!PRODUCTS.has(String(product))) fail('statement_invalid_product');
}

function checkEntryId(entryId) {
  const value = String(entryId || '').trim();
  if (value.length < 1 || value.length > 128) fail('statement_note_invalid_entry');
  return value;
}

function checkBody(body) {
  const value = String(body ?? '').trim();
  if (value.length < 1 || value.length > 2000) fail('statement_annotation_invalid_text');
  return value;
}

function shape(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email || null;
  return {
    id: row.id,
    product: row.product,
    documentId: row.document_id,
    entryId: row.entry_id,
    authorUserId: row.author_user_id,
    authorName: name,
    authorEmail: row.email || null,
    body: row.body,
    createdAt: row.created_at,
  };
}

function createService({ db = require('../db') } = {}) {
  async function list({ product, documentId, entryId }) {
    checkProduct(product);
    const entry = checkEntryId(entryId);
    const { rows } = await db.query(
      `SELECT a.*, u.first_name, u.last_name, u.email
         FROM statement_entry_annotations a
         LEFT JOIN users u ON u.id = a.author_user_id
        WHERE a.product = $1 AND a.document_id = $2 AND a.entry_id = $3
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 50`,
      [product, documentId, entry],
    );
    return rows.map(shape);
  }

  async function add({ product, documentId, entryId, authorUserId, body }) {
    checkProduct(product);
    const entry = checkEntryId(entryId);
    const text = checkBody(body);
    const { rows: [inserted] } = await db.query(
      `INSERT INTO statement_entry_annotations
         (product, document_id, entry_id, author_user_id, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [product, documentId, entry, authorUserId, text],
    );
    const { rows: [withAuthor] } = await db.query(
      `SELECT a.*, u.first_name, u.last_name, u.email
         FROM statement_entry_annotations a
         LEFT JOIN users u ON u.id = a.author_user_id
        WHERE a.id = $1`,
      [inserted.id],
    );
    return shape(withAuthor);
  }

  return { list, add };
}

let defaultService;
function service() { return defaultService || (defaultService = createService()); }

module.exports = { createService, ...Object.fromEntries(['list', 'add'].map((name) => [name, (...args) => service()[name](...args)])) };
