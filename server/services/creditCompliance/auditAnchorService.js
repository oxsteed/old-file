'use strict';

/**
 * External anchoring of OxSteed Credit's tamper-evident chains (review §1,
 * §9). A DB superuser could rewrite the hash-chained tables consistently;
 * publishing the chain heads outside the database every day makes that
 * detectable.
 *
 * Each day anchorAuditChains records, in credit_audit_anchors (immutable
 * by trigger) and outside the database:
 *   - the Credit audit chain head (oxsteed_credit_audit_events: last id,
 *     its event_hash, row count),
 *   - the admin audit chain head (admin_audit_log: last hashed id, hash),
 *   - the ledger head: last entry id and a SHA-256 digest over every
 *     account's latest (account, sequence, entry_hash) at that entry,
 *   - balance totals per currency and account type,
 *   - the previous anchor's SHA-256 (anchors form their own chain).
 *
 * Outside copies (either or both; no paid vendor):
 *   - email through Resend to OXSTEED_AUDIT_ANCHOR_EMAILS (comma list,
 *     ideally a mailbox outside OxSteed's control, e.g. the auditor);
 *   - an object in R2 (OXSTEED_AUDIT_ANCHOR_R2_BUCKET / _ENDPOINT /
 *     _ACCESS_KEY_ID / _SECRET_ACCESS_KEY), written with If-None-Match so an
 *     existing object is never overwritten. Configure an R2 bucket lock
 *     rule on the bucket for retention.
 *
 * verifyAnchors recomputes every recent anchor from the live tables; any
 * difference is a critical incident and an 'audit_anchor_mismatch' case.
 * Runs regardless of the Credit rail kill switch.
 */

const crypto = require('crypto');
const pool = require('../../db');
const logger = require('../../utils/logger');

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

async function creditAuditHead(db, headId = null) {
  const { rows } = headId === null
    ? await db.query(`SELECT id, event_hash FROM oxsteed_credit_audit_events ORDER BY id DESC LIMIT 1`)
    : await db.query(`SELECT id, event_hash FROM oxsteed_credit_audit_events WHERE id = $1`, [headId]);
  const head = rows[0] || null;
  if (!head) return { headId: null, headHash: null, count: 0 };
  const { rows: [c] } = await db.query(`SELECT COUNT(*)::bigint AS n FROM oxsteed_credit_audit_events WHERE id <= $1`, [head.id]);
  return { headId: String(head.id), headHash: head.event_hash || null, count: String(c.n) };
}

async function adminAuditHead(db, headId = null) {
  const { rows } = headId === null
    ? await db.query(`SELECT id, entry_hash FROM admin_audit_log WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1`)
    : await db.query(`SELECT id, entry_hash FROM admin_audit_log WHERE id = $1`, [headId]);
  const head = rows[0] || null;
  return head ? { headId: String(head.id), headHash: head.entry_hash } : { headId: null, headHash: null };
}

async function ledgerHead(db, headEntryId = null) {
  let head = headEntryId;
  if (head === null) {
    const { rows } = await db.query(`SELECT id FROM oxsteed_credit_transaction_entries ORDER BY id DESC LIMIT 1`);
    head = rows[0] ? String(rows[0].id) : null;
  }
  if (!head) return { headEntryId: null, headEntryHash: null, accountsDigest: sha256(''), accounts: 0 };
  const { rows: [entry] } = await db.query(`SELECT entry_hash FROM oxsteed_credit_transaction_entries WHERE id = $1`, [head]);
  const { rows: [digest] } = await db.query(
    `SELECT COUNT(*)::int AS accounts,
            COALESCE(string_agg(account_id::text || ':' || sequence::text || ':' || COALESCE(entry_hash, ''), ',' ORDER BY account_id), '') AS material
       FROM (SELECT DISTINCT ON (account_id) account_id, sequence, entry_hash
               FROM oxsteed_credit_transaction_entries WHERE id <= $1
              ORDER BY account_id, sequence DESC) latest`,
    [head]
  );
  return { headEntryId: String(head), headEntryHash: entry ? entry.entry_hash : null, accountsDigest: sha256(digest.material), accounts: digest.accounts };
}

async function balanceTotals(db) {
  const { rows } = await db.query(
    `SELECT currency_code, account_type, COUNT(*)::int AS accounts, COALESCE(SUM(balance_cents), 0)::text AS balance
       FROM oxsteed_credit_accounts GROUP BY currency_code, account_type ORDER BY currency_code, account_type`
  );
  return rows.map((r) => ({ currency: String(r.currency_code).trim(), accountType: r.account_type, accounts: r.accounts, balanceMinor: r.balance }));
}

async function buildPayload(db, anchorDate, previousSha) {
  return {
    schema: 'oxsteed-credit-audit-anchor/1',
    anchorDate,
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    creditAudit: await creditAuditHead(db),
    adminAudit: await adminAuditHead(db),
    ledger: await ledgerHead(db),
    balances: await balanceTotals(db),
    previousAnchorSha256: previousSha || null,
  };
}

function emailRecipients() {
  return String(process.env.OXSTEED_AUDIT_ANCHOR_EMAILS || '')
    .split(',').map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)).slice(0, 10);
}

function r2Config() {
  const bucket = String(process.env.OXSTEED_AUDIT_ANCHOR_R2_BUCKET || '').trim();
  const endpoint = String(process.env.OXSTEED_AUDIT_ANCHOR_R2_ENDPOINT || '').trim();
  const accessKeyId = process.env.OXSTEED_AUDIT_ANCHOR_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.OXSTEED_AUDIT_ANCHOR_R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  return { bucket, endpoint: url.origin, accessKeyId, secretAccessKey };
}

async function sendEmailCopy(row) {
  const to = emailRecipients();
  if (!to.length) return { status: 'skipped' };
  const { sendEmail } = require('../../utils/email');
  const text = [
    `OxSteed Credit audit anchor for ${row.anchor_date_text}.`,
    `SHA-256 of the payload: ${row.payload_sha256}`,
    'Keep this email. It lets an auditor detect any later rewrite of the audit trail or ledger.',
    '',
    row.payload_text,
  ].join('\n');
  const html = `<pre style="white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`;
  const ids = [];
  const failures = [];
  // utils/email sends to one recipient per call.
  for (const recipient of to) {
    const result = await sendEmail({
      to: recipient,
      subject: `OxSteed Credit audit anchor ${row.anchor_date_text} ${row.payload_sha256.slice(0, 16)}`,
      text,
      html,
      attachments: [{ filename: `oxsteed-credit-anchor-${row.anchor_date_text}.json`, content: Buffer.from(row.payload_text, 'utf8').toString('base64') }],
      idempotencyKey: `credit-audit-anchor:${row.anchor_date_text}:${row.payload_sha256.slice(0, 32)}:${sha256(recipient).slice(0, 12)}`,
    });
    if (result && result.success) ids.push(result.id || null);
    else failures.push(result?.error || 'send_failed');
  }
  return failures.length ? { status: 'failed', error: failures.join('; ').slice(0, 500), id: ids[0] || null } : { status: 'sent', id: ids[0] || null };
}

async function putR2Copy(row) {
  const config = r2Config();
  if (!config) return { status: 'skipped' };
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto', endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 2,
  });
  const key = `credit-audit-anchors/${row.anchor_date_text.replace(/-/g, '/')}-${row.payload_sha256.slice(0, 16)}.json`;
  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucket, Key: key, Body: row.payload_text, ContentType: 'application/json',
      IfNoneMatch: '*', Metadata: { sha256: row.payload_sha256 },
    }), { abortSignal: AbortSignal.timeout(30000) });
    return { status: 'stored', key };
  } catch (error) {
    // 412: the same object already exists (a retry after a partial run).
    if (error?.$metadata?.httpStatusCode === 412) return { status: 'stored', key };
    return { status: 'failed', error: error.message };
  } finally {
    client.destroy();
  }
}

async function publish(row) {
  const payloadText = JSON.stringify(row.payload, null, 2);
  const ctx = { ...row, payload_text: payloadText, anchor_date_text: String(row.anchor_date_text) };
  const errors = {};
  let email = { status: row.email_status };
  let r2 = { status: row.r2_status };
  if (row.email_status !== 'sent') {
    email = await sendEmailCopy(ctx).catch((error) => ({ status: 'failed', error: error.message }));
    if (email.error) errors.email = email.error;
  }
  if (row.r2_status !== 'stored') {
    r2 = await putR2Copy(ctx).catch((error) => ({ status: 'failed', error: error.message }));
    if (r2.error) errors.r2 = r2.error;
  }
  const { rows } = await pool.query(
    `UPDATE credit_audit_anchors
        SET email_status = $2, email_provider_id = COALESCE($3, email_provider_id), r2_status = $4, r2_key = COALESCE($5, r2_key),
            errors = $6::jsonb
      WHERE id = $1 RETURNING *`,
    [row.id, email.status, email.id || null, r2.status, r2.key || null, Object.keys(errors).length ? JSON.stringify(errors) : null]
  );
  return rows[0];
}

/** Create (or finish publishing) today's anchor. */
async function anchorAuditChains({ now = new Date() } = {}) {
  const anchorDate = now.toISOString().slice(0, 10);
  let { rows } = await pool.query(`SELECT *, anchor_date::text AS anchor_date_text FROM credit_audit_anchors WHERE anchor_date = $1`, [anchorDate]);
  let row = rows[0];
  if (!row) {
    const { rows: prev } = await pool.query(`SELECT payload_sha256 FROM credit_audit_anchors ORDER BY anchor_date DESC LIMIT 1`);
    const payload = await buildPayload(pool, anchorDate, prev[0]?.payload_sha256 || null);
    const payloadSha = sha256(stableStringify(payload));
    ({ rows } = await pool.query(
      `INSERT INTO credit_audit_anchors (anchor_date, payload, payload_sha256, previous_anchor_sha256)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (anchor_date) DO NOTHING
       RETURNING *, anchor_date::text AS anchor_date_text`,
      [anchorDate, JSON.stringify(payload), payloadSha, prev[0]?.payload_sha256 || null]
    ));
    row = rows[0];
    if (!row) {
      ({ rows } = await pool.query(`SELECT *, anchor_date::text AS anchor_date_text FROM credit_audit_anchors WHERE anchor_date = $1`, [anchorDate]));
      row = rows[0];
    }
  }
  if (row.email_status !== 'sent' || row.r2_status !== 'stored') {
    const published = await publish(row);
    row = { ...row, ...published };
  }
  if (row.email_status !== 'sent' && row.r2_status !== 'stored') {
    await require('../incidentStore').recordIncident({
      type: 'credit_audit_anchor_not_external', severity: row.email_status === 'failed' || row.r2_status === 'failed' ? 'high' : 'medium',
      message: `Credit audit anchor ${anchorDate} has no external copy (email ${row.email_status}, R2 ${row.r2_status})`,
      dedupeKey: `credit-audit-anchor-external:${anchorDate}`,
      details: { errors: row.errors || null },
    });
  }
  const verification = await verifyAnchors({ limit: 7 });
  return { anchorDate, sha256: row.payload_sha256, email: row.email_status, r2: row.r2_status, verification };
}

/** Recompute recent anchors from the live tables. */
async function verifyAnchors({ limit = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, anchor_date::text AS anchor_date, payload, payload_sha256, previous_anchor_sha256
       FROM credit_audit_anchors ORDER BY anchor_date DESC LIMIT $1`,
    [Math.min(Number(limit) || 30, 400)]
  );
  const results = [];
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[i];
    const p = a.payload;
    const problems = [];
    if (sha256(stableStringify(p)) !== a.payload_sha256) problems.push('payload_hash');
    const older = rows[i + 1];
    if (older && a.previous_anchor_sha256 !== older.payload_sha256) problems.push('anchor_chain');
    if (p.creditAudit?.headId) {
      const live = await creditAuditHead(pool, p.creditAudit.headId);
      if (live.headHash !== p.creditAudit.headHash) problems.push('credit_audit_head');
      if (String(live.count) !== String(p.creditAudit.count)) problems.push('credit_audit_count');
    }
    if (p.adminAudit?.headId) {
      const live = await adminAuditHead(pool, p.adminAudit.headId);
      if (live.headHash !== p.adminAudit.headHash) problems.push('admin_audit_head');
    }
    if (p.ledger?.headEntryId) {
      const live = await ledgerHead(pool, p.ledger.headEntryId);
      if (live.headEntryHash !== p.ledger.headEntryHash) problems.push('ledger_head');
      if (live.accountsDigest !== p.ledger.accountsDigest) problems.push('ledger_accounts_digest');
    }
    const verification = { ok: problems.length === 0, problems, verifiedAt: new Date().toISOString() };
    await pool.query(
      `UPDATE credit_audit_anchors SET last_verified_at = NOW(), last_verification = $2::jsonb WHERE id = $1`,
      [a.id, JSON.stringify(verification)]
    );
    if (problems.length) {
      logger.error('credit_audit_anchor.mismatch', { anchorDate: a.anchor_date, problems });
      await require('../incidentStore').recordIncident({
        type: 'credit_audit_anchor_mismatch', severity: 'critical',
        message: `Audit anchor ${a.anchor_date} no longer matches the database (${problems.join(', ')})`,
        dedupeKey: `credit-audit-anchor-mismatch:${a.anchor_date}:${problems.join(',')}`,
        details: { anchorId: String(a.id), problems },
      });
      const { withTransaction } = require('../../utils/transaction');
      await withTransaction(pool, async (client) => {
        await require('../complianceCaseService').openComplianceCase(client, {
          caseType: 'audit_anchor_mismatch', subjectType: 'platform', subjectId: 'credit-audit', severity: 'critical',
          evidence: { anchorDate: a.anchor_date, problems }, dedupeKey: `credit-audit-anchor-mismatch:${a.anchor_date}`,
        });
      }, 'credit_audit_anchor_case');
    }
    results.push({ anchorDate: a.anchor_date, ...verification });
  }
  return results;
}

async function listAnchors({ limit = 60 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, anchor_date::text AS anchor_date, payload_sha256, previous_anchor_sha256, email_status, r2_status, r2_key, errors,
            last_verified_at, last_verification, created_at
       FROM credit_audit_anchors ORDER BY anchor_date DESC LIMIT $1`,
    [Math.min(Number(limit) || 60, 400)]
  );
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

async function getAnchor(anchorDate) {
  const { rows } = await pool.query(`SELECT anchor_date::text AS anchor_date, payload, payload_sha256 FROM credit_audit_anchors WHERE anchor_date = $1`, [anchorDate]);
  return rows[0] || null;
}

module.exports = {
  sha256,
  stableStringify,
  buildPayload,
  creditAuditHead,
  adminAuditHead,
  ledgerHead,
  anchorAuditChains,
  verifyAnchors,
  listAnchors,
  getAnchor,
  emailRecipients,
  r2Config,
};
