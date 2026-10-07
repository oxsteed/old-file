'use strict';

const pool = require('../db');

const BUSINESS_ISSUED_SQL = `
  SELECT bi.id::bigint AS source_id,
         'business'::text AS invoice_kind,
         bi.invoice_number,
         bi.client_name,
         bi.client_email,
         bi.status,
         bi.issue_date AS issued_at,
         bi.due_date AS due_at,
         ROUND(bi.total * 100)::bigint AS amount_cents,
         bi.total,
         bi.amount_paid,
         bi.sent_at,
         bi.paid_at,
         bi.created_at,
         bi.public_token,
         b.business_name AS counterparty_name,
         'issued'::text AS perspective
    FROM business_invoices bi
    LEFT JOIN businesses b ON b.id = bi.business_id
   WHERE bi.user_id = $1`;

const BUSINESS_RECEIVED_SQL = `
  SELECT bi.id::bigint AS source_id,
         'business'::text AS invoice_kind,
         bi.invoice_number,
         bi.client_name,
         bi.client_email,
         bi.status,
         bi.issue_date AS issued_at,
         bi.due_date AS due_at,
         ROUND(bi.total * 100)::bigint AS amount_cents,
         bi.total,
         bi.amount_paid,
         bi.sent_at,
         bi.paid_at,
         bi.created_at,
         bi.public_token,
         COALESCE(b.business_name, TRIM(CONCAT(u.first_name, ' ', u.last_name))) AS counterparty_name,
         'received'::text AS perspective
    FROM business_invoices bi
    LEFT JOIN businesses b ON b.id = bi.business_id
    LEFT JOIN users u ON u.id = bi.user_id AND bi.business_id IS NULL
   WHERE LOWER(TRIM(bi.client_email)) = LOWER(TRIM($2))
     AND bi.user_id <> $1
     AND bi.status IN ('sent', 'partial', 'overdue', 'paid')`;

const TOOL_RENTAL_ISSUED_SQL = `
  SELECT tri.id::bigint AS source_id,
         'tool_rental'::text AS invoice_kind,
         tri.invoice_number,
         TRIM(CONCAT(uc.first_name, ' ', uc.last_name)) AS client_name,
         uc.email AS client_email,
         CASE tri.status
           WHEN 'payment_confirmed' THEN 'paid'
           WHEN 'viewed' THEN 'sent'
           ELSE tri.status
         END AS status,
         tri.created_at::date AS issued_at,
         NULL::date AS due_at,
         ROUND(tri.total_amount * 100)::bigint AS amount_cents,
         tri.total_amount AS total,
         CASE WHEN tri.status = 'payment_confirmed' THEN tri.total_amount ELSE 0 END AS amount_paid,
         tri.created_at AS sent_at,
         tri.payment_confirmed_at AS paid_at,
         tri.created_at,
         NULL::uuid AS public_token,
         tr.name AS counterparty_name,
         'issued'::text AS perspective
    FROM tool_rental_invoices tri
    JOIN tool_rentals tr ON tr.id = tri.tool_id
    JOIN users uc ON uc.id = tri.customer_id
   WHERE tri.owner_id = $1
     AND tri.status <> 'draft'`;

const TOOL_RENTAL_RECEIVED_SQL = `
  SELECT tri.id::bigint AS source_id,
         'tool_rental'::text AS invoice_kind,
         tri.invoice_number,
         TRIM(CONCAT(uo.first_name, ' ', uo.last_name)) AS client_name,
         uo.email AS client_email,
         CASE tri.status
           WHEN 'payment_confirmed' THEN 'paid'
           WHEN 'viewed' THEN 'sent'
           ELSE tri.status
         END AS status,
         tri.created_at::date AS issued_at,
         NULL::date AS due_at,
         ROUND(tri.total_amount * 100)::bigint AS amount_cents,
         tri.total_amount AS total,
         CASE WHEN tri.status = 'payment_confirmed' THEN tri.total_amount ELSE 0 END AS amount_paid,
         tri.created_at AS sent_at,
         tri.payment_confirmed_at AS paid_at,
         tri.created_at,
         NULL::uuid AS public_token,
         tr.name AS counterparty_name,
         'received'::text AS perspective
    FROM tool_rental_invoices tri
    JOIN tool_rentals tr ON tr.id = tri.tool_id
    JOIN users uo ON uo.id = tri.owner_id
   WHERE tri.customer_id = $1
     AND tri.status IN ('sent', 'viewed', 'payment_confirmed')`;

function decorateInvoiceRow(row) {
  const sourceId = row.source_id;
  const kind = row.invoice_kind;
  const id = kind === 'tool_rental' ? `tr-${sourceId}` : String(sourceId);
  const detail_href = kind === 'tool_rental'
    ? `/tool-rentals?rentalInvoiceId=${sourceId}`
    : (row.public_token ? `/invoice/p/${row.public_token}` : null);
  return {
    ...row,
    id,
    source_id: sourceId,
    business_name: row.counterparty_name,
    detail_href,
  };
}

function applyStatusFilter(rows, status) {
  if (!status) return rows;
  return rows.filter((row) => String(row.status) === status);
}

function sortAndPage(rows, limit, offset) {
  const sorted = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return {
    total: sorted.length,
    page: sorted.slice(offset, offset + limit).map(decorateInvoiceRow),
  };
}

async function listUserInvoices({ userId, userEmail, view = 'all', status = null, limit = 20, offset = 0 }) {
  const queries = [];
  if (view === 'issued' || view === 'all') {
    queries.push(pool.query(BUSINESS_ISSUED_SQL, [userId]));
    queries.push(pool.query(TOOL_RENTAL_ISSUED_SQL, [userId]));
  }
  if (view === 'received' || view === 'all') {
    queries.push(pool.query(BUSINESS_RECEIVED_SQL, [userId, userEmail || '']));
    queries.push(pool.query(TOOL_RENTAL_RECEIVED_SQL, [userId]));
  }

  const results = await Promise.all(queries);
  const merged = results.flatMap((r) => r.rows);
  const filtered = applyStatusFilter(merged, status);
  const { total, page } = sortAndPage(filtered, limit, offset);
  return { invoices: page, total };
}

async function getUserInvoiceById({ compositeId, userId, userEmail, role }) {
  const isAdmin = ['admin', 'super_admin'].includes(role);
  if (String(compositeId).startsWith('tr-')) {
    const invoiceId = String(compositeId).slice(3);
    const { rows } = await pool.query(
      `SELECT tri.*, tr.name AS tool_name,
              CASE
                WHEN tri.owner_id = $2 THEN 'issued'
                WHEN tri.customer_id = $2 THEN 'received'
                ELSE 'admin'
              END AS perspective
         FROM tool_rental_invoices tri
         JOIN tool_rentals tr ON tr.id = tri.tool_id
        WHERE tri.id = $1
          AND ($3 OR tri.owner_id = $2 OR tri.customer_id = $2)`,
      [invoiceId, userId, isAdmin]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return decorateInvoiceRow({
      source_id: row.id,
      invoice_kind: 'tool_rental',
      invoice_number: row.invoice_number,
      client_name: row.client_name,
      status: row.status === 'payment_confirmed' ? 'paid' : row.status,
      issued_at: row.created_at,
      due_at: null,
      amount_cents: Math.round(Number(row.total_amount || 0) * 100),
      total: row.total_amount,
      amount_paid: row.status === 'payment_confirmed' ? row.total_amount : 0,
      created_at: row.created_at,
      public_token: null,
      counterparty_name: row.tool_name,
      perspective: row.perspective,
      tool_name: row.tool_name,
    });
  }

  const { rows } = await pool.query(
    `SELECT bi.*,
            u.preferred_language,
            b.business_name,
            ROUND(bi.total * 100)::bigint AS amount_cents,
            CASE
              WHEN bi.user_id = $3 THEN 'issued'
              WHEN LOWER(TRIM(bi.client_email)) = LOWER(TRIM($4)) THEN 'received'
              ELSE 'admin'
            END AS perspective
       FROM business_invoices bi
       LEFT JOIN businesses b ON b.id = bi.business_id
       LEFT JOIN users u ON u.id = bi.user_id
      WHERE bi.id = $1
        AND (
          $2
          OR bi.user_id = $3
          OR LOWER(TRIM(bi.client_email)) = LOWER(TRIM($4))
        )`,
    [compositeId, isAdmin, userId, userEmail || '']
  );
  if (!rows[0]) return null;
  const inv = rows[0];
  return decorateInvoiceRow({
    source_id: inv.id,
    invoice_kind: 'business',
    invoice_number: inv.invoice_number,
    client_name: inv.client_name,
    client_email: inv.client_email,
    status: inv.status,
    issued_at: inv.issue_date,
    due_at: inv.due_date,
    amount_cents: inv.amount_cents,
    total: inv.total,
    amount_paid: inv.amount_paid,
    sent_at: inv.sent_at,
    paid_at: inv.paid_at,
    created_at: inv.created_at,
    public_token: inv.public_token,
    counterparty_name: inv.business_name,
    perspective: inv.perspective,
    preferred_language: inv.preferred_language,
  });
}

module.exports = {
  listUserInvoices,
  getUserInvoiceById,
  decorateInvoiceRow,
};
