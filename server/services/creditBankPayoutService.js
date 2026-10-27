'use strict';

/**
 * OxSteed in-house bank payout rail (replaces MonCash for Haiti; usable in
 * any country where OxSteed holds a payout bank account).
 *
 * There is no bank API: OxSteed's treasury team pays from its own bank
 * account using the bank's bulk-transfer portal.
 *
 *  1. Money flows (cash-out, destination verification deposits, wind-down
 *     redemptions) create INSTRUCTIONS, idempotent by key.
 *  2. An administrator EXPORTS pending instructions for one country and
 *     currency as a CSV batch (account numbers decrypted only into the
 *     file; the file's SHA-256 is recorded).
 *  3. After the bank executes the batch, each instruction is CONFIRMED paid
 *     or returned against the bank statement by TWO DIFFERENT
 *     administrators (DB CHECK credit_bank_payout_two_person). Only the
 *     second, matching confirmation settles the business record (posts the
 *     cash_out journal, fails the destination, marks the redemption paid).
 *
 * The adapter registered in payoutPartners ('oxsteed_bank_payout') exposes
 * this rail through the partner interface. It is off unless
 * OXSTEED_BANK_PAYOUT_ENABLED=true and the source account is configured.
 */

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { insertComplianceAudit } = require('./creditCompliance/audit');

const PURPOSES = Object.freeze(['cashout', 'micro_deposit', 'verification_code', 'redemption']);

function isRailConfigured() {
  return String(process.env.OXSTEED_BANK_PAYOUT_ENABLED || '').toLowerCase() === 'true'
    && Boolean(process.env.OXSTEED_BANK_PAYOUT_SOURCE_ACCOUNT);
}

function viewInstruction(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    purpose: row.purpose,
    cashout_id: row.cashout_id ? String(row.cashout_id) : null,
    destination_id: String(row.destination_id),
    user_id: row.user_id,
    country_code: row.country_code,
    currency_code: row.currency_code,
    amount_minor: Number(row.amount_minor),
    payment_reference: row.payment_reference,
    status: row.status,
    batch_id: row.batch_id ? String(row.batch_id) : null,
    bank_reference: row.bank_reference || null,
    failure_code: row.failure_code || null,
    first_confirmed_by: row.first_confirmed_by || null,
    first_confirmed_outcome: row.first_confirmed_outcome || null,
    first_confirmed_at: row.first_confirmed_at || null,
    second_confirmed_by: row.second_confirmed_by || null,
    second_confirmed_at: row.second_confirmed_at || null,
    created_at: row.created_at,
  };
}

/** Create (or replay) an instruction inside the caller's transaction. */
async function createInstruction(client, { purpose, idempotencyKey, destination, amountMinor, paymentReference, cashoutId = null }) {
  if (!PURPOSES.includes(purpose)) throw new AppError('Unknown payout purpose', 400, 'bank_payout_purpose_invalid');
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('Payout amount must be positive', 400, 'bank_payout_amount_invalid');
  const reference = String(paymentReference || '').replace(/[^A-Za-z0-9 \-]/g, '').slice(0, 60) || 'OXSTEED';
  const { rows } = await client.query(
    `INSERT INTO credit_bank_payout_instructions
       (idempotency_key, purpose, cashout_id, destination_id, user_id, country_code, currency_code, amount_minor, payment_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [idempotencyKey, purpose, cashoutId, destination.id, destination.user_id, destination.country_code, destination.currency_code, amount, reference]
  );
  if (rows && rows[0]) return { instruction: rows[0], replayed: false };
  const { rows: existing } = await client.query('SELECT * FROM credit_bank_payout_instructions WHERE idempotency_key = $1', [idempotencyKey]);
  const row = existing && existing[0];
  if (!row) throw new AppError('Payout instruction could not be created', 500, 'bank_payout_instruction_failed');
  if (Number(row.amount_minor) !== amount || String(row.destination_id) !== String(destination.id) || row.purpose !== purpose) {
    throw new AppError('Payout instruction idempotency conflict', 409, 'bank_payout_idempotency_conflict');
  }
  return { instruction: row, replayed: true };
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formulas; quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function minorToDecimal(minor, currency) {
  const { currencyExponent } = require('../validation/money');
  const exp = currencyExponent(currency);
  const n = BigInt(minor);
  if (exp === 0) return n.toString();
  const base = 10n ** BigInt(exp);
  const whole = n / base;
  const frac = (n % base).toString().padStart(exp, '0');
  return `${whole}.${frac}`;
}

/**
 * Export every pending instruction for one country + currency as a CSV
 * batch. Returns { batch, csv, filename }.
 */
async function exportBatch({ actorUserId, countryCode, currencyCode, requestIp = null }) {
  const country = String(countryCode || '').toUpperCase();
  const currency = String(currencyCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || !/^[A-Z]{3}$/.test(currency)) throw new AppError('Country and currency are required', 400, 'validation_failed');
  const { decryptDetails } = require('./creditPayoutDestinationService');
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`credit-bank-payout-export:${country}:${currency}`]);
    const { rows } = await client.query(
      `SELECT i.*, d.encrypted_details, d.holder_name, d.bank_name, d.bank_code, d.status AS destination_status
         FROM credit_bank_payout_instructions i
         JOIN credit_payout_destinations d ON d.id = i.destination_id
        WHERE i.status = 'pending_export' AND i.country_code = $1 AND i.currency_code = $2
        ORDER BY i.id
        LIMIT 2000
        FOR UPDATE OF i`,
      [country, currency]
    );
    if (!rows.length) throw new AppError('Nothing to export', 409, 'bank_payout_nothing_pending');
    const header = ['instruction_id', 'payment_reference', 'beneficiary_name', 'bank_name', 'bank_code', 'account_number', 'amount', 'currency', 'purpose'];
    const lines = [header.map(csvCell).join(',')];
    let total = 0n;
    for (const row of rows) {
      const details = decryptDetails(row);
      total += BigInt(row.amount_minor);
      lines.push([
        row.id, row.payment_reference, details.holderName || row.holder_name, details.bankName || row.bank_name,
        details.bankCode || row.bank_code || '', details.accountNumber, minorToDecimal(row.amount_minor, currency), currency, row.purpose,
      ].map(csvCell).join(','));
    }
    const csv = `${lines.join('\r\n')}\r\n`;
    const sha = crypto.createHash('sha256').update(csv).digest('hex');
    const { rows: batchRows } = await client.query(
      `INSERT INTO credit_bank_payout_batches (country_code, currency_code, instruction_count, total_minor, file_sha256, exported_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [country, currency, rows.length, total.toString(), sha, actorUserId]
    );
    const batch = batchRows[0];
    await client.query(
      `UPDATE credit_bank_payout_instructions SET status = 'exported', batch_id = $2, updated_at = NOW()
        WHERE id = ANY($1::bigint[])`,
      [rows.map((r) => r.id), batch.id]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.bank_payout.batch_exported',
      actorUserId,
      resourceType: 'credit_bank_payout_batch',
      resourceId: String(batch.id),
      reason: `Exported ${rows.length} instruction(s) for ${country}/${currency}`,
      requestIp,
      afterState: { count: rows.length, totalMinor: total.toString(), sha256: sha },
    });
    return { batch: { id: String(batch.id), count: rows.length, total_minor: total.toString(), sha256: sha }, csv, filename: `oxsteed-payouts-${country}-${currency}-${batch.id}.csv` };
  }, 'credit_bank_payout_export');
}

/**
 * Record one administrator's confirmation of an exported instruction.
 * The first call stores the outcome; a second, DIFFERENT administrator
 * with the same outcome settles it. A disagreeing second outcome resets
 * the first confirmation so the pair must look again.
 */
async function confirmInstruction({ actorUserId, instructionId, outcome, bankReference = null, failureCode = null, requestIp = null }) {
  if (!['paid', 'returned'].includes(outcome)) throw new AppError('Outcome must be paid or returned', 400, 'validation_failed');
  if (!actorUserId) throw new AppError('An administrator is required', 403, 'bank_payout_actor_required');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM credit_bank_payout_instructions WHERE id = $1 FOR UPDATE', [instructionId]);
    const row = rows[0];
    if (!row) throw new AppError('Instruction not found', 404, 'bank_payout_not_found');
    if (row.status !== 'exported') throw new AppError('Only exported instructions can be confirmed', 409, 'bank_payout_not_exported', { status: row.status });
    const ref = bankReference ? String(bankReference).slice(0, 120) : null;
    if (!row.first_confirmed_by) {
      const { rows: updated } = await client.query(
        `UPDATE credit_bank_payout_instructions
            SET first_confirmed_by = $2, first_confirmed_at = NOW(), first_confirmed_outcome = $3,
                bank_reference = COALESCE($4, bank_reference), failure_code = $5, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [row.id, actorUserId, outcome, ref, outcome === 'returned' ? String(failureCode || 'bank_returned').slice(0, 80) : null]
      );
      await insertComplianceAudit(client, {
        actionType: 'credit.bank_payout.first_confirmation', actorUserId, customerId: row.user_id,
        resourceType: 'credit_bank_payout_instruction', resourceId: String(row.id), reason: `First confirmation: ${outcome}`, requestIp,
        afterState: { outcome, bankReference: ref },
      });
      return { instruction: viewInstruction(updated[0]), settled: false };
    }
    if (String(row.first_confirmed_by) === String(actorUserId)) {
      throw new AppError('A different administrator must give the second confirmation', 409, 'bank_payout_second_admin_required');
    }
    if (row.first_confirmed_outcome !== outcome) {
      const { rows: reset } = await client.query(
        `UPDATE credit_bank_payout_instructions
            SET first_confirmed_by = NULL, first_confirmed_at = NULL, first_confirmed_outcome = NULL, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [row.id]
      );
      await insertComplianceAudit(client, {
        actionType: 'credit.bank_payout.confirmation_conflict', actorUserId, customerId: row.user_id,
        resourceType: 'credit_bank_payout_instruction', resourceId: String(row.id),
        reason: `Second confirmation (${outcome}) disagreed with first (${row.first_confirmed_outcome}); reset`, requestIp,
      });
      return { instruction: viewInstruction(reset[0]), settled: false, conflict: true };
    }
    const { rows: done } = await client.query(
      `UPDATE credit_bank_payout_instructions
          SET status = $2, second_confirmed_by = $3, second_confirmed_at = NOW(),
              bank_reference = COALESCE($4, bank_reference), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [row.id, outcome, actorUserId, ref]
    );
    const settledRow = done[0];
    await settlePurpose(client, settledRow, outcome);
    await insertComplianceAudit(client, {
      actionType: 'credit.bank_payout.settled', actorUserId, customerId: row.user_id,
      resourceType: 'credit_bank_payout_instruction', resourceId: String(row.id),
      reason: `Second confirmation: ${outcome}`, requestIp,
      afterState: { outcome, firstConfirmedBy: row.first_confirmed_by, secondConfirmedBy: actorUserId },
    });
    return { instruction: viewInstruction(settledRow), settled: true };
  }, 'credit_bank_payout_confirm');
}

async function settlePurpose(client, row, outcome) {
  if (row.purpose === 'cashout') {
    const cashout = require('./creditCashoutService');
    await cashout.settleInTransaction(client, row.cashout_id, outcome === 'paid'
      ? { status: 'paid', reference: row.bank_reference || row.payment_reference }
      : { status: 'failed', failureCode: row.failure_code || 'bank_returned' });
    return;
  }
  if (row.purpose === 'micro_deposit' || row.purpose === 'verification_code') {
    if (outcome === 'returned') {
      await client.query(
        `UPDATE credit_payout_destinations
            SET status = 'failed', disabled_reason = 'verification_deposit_returned', updated_at = NOW()
          WHERE id = $1 AND status IN ('pending_verification', 'held_for_review')`,
        [row.destination_id]
      );
    }
    return;
  }
  if (row.purpose === 'redemption') {
    const windDown = require('./creditCompliance/windDownService');
    await windDown.settleRedemptionInstruction(client, row, outcome);
  }
}

/** Partner-interface status for a cash-out instruction by reference. */
async function getInstructionStatusByCashout(cashoutId) {
  const { rows } = await pool.query(
    `SELECT status, failure_code, bank_reference FROM credit_bank_payout_instructions
      WHERE purpose = 'cashout' AND cashout_id = $1 ORDER BY id DESC LIMIT 1`,
    [cashoutId]
  );
  const row = rows && rows[0];
  if (!row) return { status: 'submitted' };
  if (row.status === 'paid') return { status: 'paid', reference: row.bank_reference || null };
  if (row.status === 'returned' || row.status === 'canceled') return { status: 'failed', failureCode: row.failure_code || 'bank_returned' };
  return { status: 'submitted' };
}

async function listInstructions({ status = null, countryCode = null, limit = 200 } = {}) {
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (countryCode) { params.push(String(countryCode).toUpperCase()); where.push(`country_code = $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 1000));
  const { rows } = await pool.query(
    `SELECT * FROM credit_bank_payout_instructions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT $${params.length}`,
    params
  );
  return rows.map(viewInstruction);
}

module.exports = {
  PURPOSES,
  isRailConfigured,
  createInstruction,
  exportBatch,
  confirmInstruction,
  getInstructionStatusByCashout,
  listInstructions,
  viewInstruction,
  minorToDecimal,
  csvCell,
};
