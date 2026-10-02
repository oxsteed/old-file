'use strict';

/**
 * M2 — Treasury workspace controller.
 *
 * Entity accounting: entities, chart of accounts, accounting periods,
 * double-entry journal, period close, tax export scaffolding. This is
 * bookkeeping only and is separate from the OxSteed credit rail.
 *
 * Money fails closed everywhere:
 *   - every write validates ownership (entity match), period status, and
 *     currency alignment before touching the journal;
 *   - journal posting runs inside a single DB transaction (BEGIN/COMMIT,
 *     ROLLBACK on any failure);
 *   - exports run under the E04 'exports' DB budget and fail closed when
 *     the budget is exhausted.
 */

const db = require('../db');
const logger = require('../utils/logger');
const { withDbBudget } = require('../utils/dbBudgets');

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]*$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sendError(res, err) {
  const status = err && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  if (status === 500) {
    logger.error({ err }, 'treasury controller failure');
  }
  res.status(status).json({ error: status === 500 ? 'Internal server error.' : err.message });
}

function parseId(value, name) {
  const id = Number.parseInt(value, 10);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, `${name} must be a positive integer.`);
  return id;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(400, `${name} is required.`);
  }
  return value.trim();
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Entities ──────────────────────────────────────────────────────────────

async function listEntities(req, res) {
  try {
    const { rows } = await db.query(
      'SELECT id, code, name, country_code, base_currency, is_active, created_at FROM treasury_entities ORDER BY code'
    );
    res.status(200).json({ entities: rows });
  } catch (err) {
    sendError(res, err);
  }
}

async function createEntity(req, res) {
  try {
    const code = requireNonEmptyString(req.body.code, 'code');
    const name = requireNonEmptyString(req.body.name, 'name');
    const baseCurrency = requireNonEmptyString(req.body.base_currency, 'base_currency');
    if (!CODE_RE.test(code)) throw httpError(400, 'code must be uppercase alphanumeric.');
    if (!CURRENCY_RE.test(baseCurrency)) throw httpError(400, 'base_currency must be a 3-letter uppercase currency code.');
    const countryCode = req.body.country_code ? requireNonEmptyString(req.body.country_code, 'country_code') : null;
    if (countryCode && !COUNTRY_RE.test(countryCode)) throw httpError(400, 'country_code must be a 2-letter uppercase country code.');

    const { rows } = await db.query(
      `INSERT INTO treasury_entities (code, name, country_code, base_currency)
       VALUES ($1, $2, $3, $4) RETURNING id, code, name, country_code, base_currency, is_active, created_at`,
      [code, name, countryCode, baseCurrency]
    );
    res.status(201).json({ entity: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'An entity with that code already exists.' });
    }
    sendError(res, err);
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────

async function listAccounts(req, res) {
  try {
    const entityId = parseId(req.query.entity_id, 'entity_id');
    const { rows } = await db.query(
      `SELECT id, entity_id, code, name, currency, account_type, created_at
       FROM treasury_accounts WHERE entity_id = $1 ORDER BY code`,
      [entityId]
    );
    res.status(200).json({ accounts: rows });
  } catch (err) {
    sendError(res, err);
  }
}

async function createAccount(req, res) {
  try {
    const entityId = parseId(req.body.entity_id, 'entity_id');
    const code = requireNonEmptyString(req.body.code, 'code');
    const name = requireNonEmptyString(req.body.name, 'name');
    const currency = requireNonEmptyString(req.body.currency, 'currency');
    const accountType = requireNonEmptyString(req.body.account_type, 'account_type');
    if (!CODE_RE.test(code)) throw httpError(400, 'code must be uppercase alphanumeric.');
    if (!CURRENCY_RE.test(currency)) throw httpError(400, 'currency must be a 3-letter uppercase currency code.');
    if (!ACCOUNT_TYPES.includes(accountType)) {
      throw httpError(400, `account_type must be one of: ${ACCOUNT_TYPES.join(', ')}.`);
    }

    const { rows: entityRows } = await db.query(
      'SELECT id, is_active FROM treasury_entities WHERE id = $1',
      [entityId]
    );
    if (!entityRows.length) throw httpError(404, 'Entity not found.');
    if (!entityRows[0].is_active) throw httpError(409, 'Cannot add accounts to an inactive entity.');

    const { rows } = await db.query(
      `INSERT INTO treasury_accounts (entity_id, code, name, currency, account_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, entity_id, code, name, currency, account_type, created_at`,
      [entityId, code, name, currency, accountType]
    );
    res.status(201).json({ account: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'An account with that code already exists for this entity.' });
    }
    sendError(res, err);
  }
}

// ── Journal ───────────────────────────────────────────────────────────────

async function postJournal(req, res) {
  const client = await db.connect();
  try {
    // Validate request shape before starting the transaction.
    const entityId = parseId(req.body.entity_id, 'entity_id');
    const periodId = parseId(req.body.period_id, 'period_id');
    const debitAccountId = parseId(req.body.debit_account_id, 'debit_account_id');
    const creditAccountId = parseId(req.body.credit_account_id, 'credit_account_id');
    const amountMinor = req.body.amount_minor;
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw httpError(400, 'amount_minor must be a positive integer.');
    }
    const currency = requireNonEmptyString(req.body.currency, 'currency');
    if (!CURRENCY_RE.test(currency)) throw httpError(400, 'currency must be a 3-letter uppercase currency code.');
    const description = requireNonEmptyString(req.body.description, 'description');
    const reference = req.body.reference != null ? String(req.body.reference).trim() || null : null;
    if (debitAccountId === creditAccountId) {
      throw httpError(400, 'debit_account_id and credit_account_id must differ.');
    }

    await client.query('BEGIN');

    const { rows: periodRows } = await client.query(
      'SELECT id, entity_id, status FROM treasury_periods WHERE id = $1 FOR UPDATE',
      [periodId]
    );
    if (!periodRows.length) throw httpError(404, 'Period not found.');
    const period = periodRows[0];
    if (period.entity_id !== entityId) throw httpError(400, 'Period does not belong to the given entity.');
    if (period.status !== 'open') throw httpError(409, 'Cannot post to a closed period.');

    const { rows: accountRows } = await client.query(
      'SELECT id, entity_id, currency FROM treasury_accounts WHERE id = ANY($1)',
      [[debitAccountId, creditAccountId]]
    );
    if (accountRows.length !== 2) throw httpError(400, 'One or both accounts do not exist.');
    for (const account of accountRows) {
      if (account.entity_id !== entityId) {
        throw httpError(400, 'Both accounts must belong to the posting entity.');
      }
      if (account.currency !== currency) {
        throw httpError(400, 'Entry currency must equal both accounts currency.');
      }
    }

    const { rows } = await client.query(
      `INSERT INTO treasury_journal_entries
         (entity_id, period_id, debit_account_id, credit_account_id, amount_minor, currency, description, reference, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, entity_id, period_id, debit_account_id, credit_account_id,
                 amount_minor, currency, description, reference, created_by, created_at`,
      [entityId, periodId, debitAccountId, creditAccountId, amountMinor, currency, description, reference, req.user?.id || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ entry: rows[0] });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error({ err: rollbackErr }, 'treasury journal rollback failed');
    }
    sendError(res, err);
  } finally {
    client.release();
  }
}

async function listJournal(req, res) {
  try {
    const entityId = parseId(req.query.entity_id, 'entity_id');
    const periodId = req.query.period_id != null && req.query.period_id !== ''
      ? parseId(req.query.period_id, 'period_id')
      : null;
    let limit = Number.parseInt(req.query.limit, 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 200);

    const params = [entityId];
    let where = 'je.entity_id = $1';
    if (periodId) {
      params.push(periodId);
      where += ` AND je.period_id = $${params.length}`;
    }
    params.push(limit);

    const { rows } = await db.query(
      `SELECT je.id, je.period_id, je.debit_account_id, je.credit_account_id,
              je.amount_minor, je.currency, je.description, je.reference,
              je.created_by, je.created_at,
              da.code AS debit_code, da.name AS debit_name,
              ca.code AS credit_code, ca.name AS credit_name
       FROM treasury_journal_entries je
       JOIN treasury_accounts da ON da.id = je.debit_account_id
       JOIN treasury_accounts ca ON ca.id = je.credit_account_id
       WHERE ${where}
       ORDER BY je.created_at DESC, je.id DESC
       LIMIT $${params.length}`,
      params
    );
    res.status(200).json({ entries: rows, limit });
  } catch (err) {
    sendError(res, err);
  }
}

// ── Periods ───────────────────────────────────────────────────────────────

async function listPeriods(req, res) {
  try {
    const entityId = parseId(req.query.entity_id, 'entity_id');
    const { rows } = await db.query(
      `SELECT id, entity_id, period_start, period_end, status, closed_at, closed_by, created_at
       FROM treasury_periods WHERE entity_id = $1 ORDER BY period_start DESC`,
      [entityId]
    );
    res.status(200).json({ periods: rows });
  } catch (err) {
    sendError(res, err);
  }
}

async function createPeriod(req, res) {
  try {
    const entityId = parseId(req.body.entity_id, 'entity_id');
    const periodStart = requireNonEmptyString(req.body.period_start, 'period_start');
    const periodEnd = requireNonEmptyString(req.body.period_end, 'period_end');
    if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) {
      throw httpError(400, 'period_start and period_end must be YYYY-MM-DD dates.');
    }
    if (periodEnd < periodStart) {
      throw httpError(400, 'period_end must be on or after period_start.');
    }
    const { rows } = await db.query(
      `INSERT INTO treasury_periods (entity_id, period_start, period_end)
       VALUES ($1, $2, $3)
       RETURNING id, entity_id, period_start, period_end, status, closed_at, closed_by, created_at`,
      [entityId, periodStart, periodEnd]
    );
    res.status(201).json({ period: rows[0] });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'A period with that start date already exists for this entity.' });
    }
    if (err && err.code === '23503') {
      return res.status(404).json({ error: 'Entity not found.' });
    }
    sendError(res, err);
  }
}

async function closePeriod(req, res) {
  try {
    const periodId = parseId(req.params.id, 'period id');
    const expectedEntityId = req.body?.entity_id != null && req.body.entity_id !== ''
      ? parseId(req.body.entity_id, 'entity_id')
      : (req.query.entity_id != null && req.query.entity_id !== '' ? parseId(req.query.entity_id, 'entity_id') : null);

    const { rows: periodRows } = await db.query(
      'SELECT id, entity_id, status FROM treasury_periods WHERE id = $1',
      [periodId]
    );
    if (!periodRows.length) throw httpError(404, 'Period not found.');
    const period = periodRows[0];
    if (expectedEntityId && period.entity_id !== expectedEntityId) {
      throw httpError(404, 'Period not found for the given entity.');
    }
    if (period.status !== 'open') {
      return res.status(409).json({ error: 'Period is already closed.' });
    }

    // Atomic close: the status predicate in the WHERE clause makes a
    // concurrent close attempt lose instead of double-closing.
    const { rows } = await db.query(
      `UPDATE treasury_periods
       SET status = 'closed', closed_at = NOW(), closed_by = $2
       WHERE id = $1 AND status = 'open'
       RETURNING id, entity_id, period_start, period_end, status, closed_at, closed_by`,
      [periodId, req.user?.id || null]
    );
    if (!rows.length) {
      return res.status(409).json({ error: 'Period is already closed.' });
    }
    res.status(200).json({ period: rows[0] });
  } catch (err) {
    sendError(res, err);
  }
}

async function periodSummary(req, res) {
  try {
    const periodId = parseId(req.params.id, 'period id');
    const { rows: periodRows } = await db.query(
      'SELECT id, entity_id, period_start, period_end, status FROM treasury_periods WHERE id = $1',
      [periodId]
    );
    if (!periodRows.length) throw httpError(404, 'Period not found.');
    const period = periodRows[0];

    // Balances are computed views over the journal. No adjusting entries
    // are posted by this endpoint.
    const { rows } = await db.query(
      `SELECT a.id AS account_id, a.code, a.name, a.currency, a.account_type,
              COALESCE(SUM(CASE WHEN je.debit_account_id = a.id THEN je.amount_minor ELSE 0 END), 0) AS debit_total,
              COALESCE(SUM(CASE WHEN je.credit_account_id = a.id THEN je.amount_minor ELSE 0 END), 0) AS credit_total
       FROM treasury_accounts a
       LEFT JOIN treasury_journal_entries je
         ON (je.debit_account_id = a.id OR je.credit_account_id = a.id)
        AND je.period_id = $1
       WHERE a.entity_id = $2
       GROUP BY a.id, a.code, a.name, a.currency, a.account_type
       ORDER BY a.code`,
      [periodId, period.entity_id]
    );

    const accounts = rows.map((r) => {
      const debit = Number(r.debit_total);
      const credit = Number(r.credit_total);
      return {
        account_id: r.account_id,
        code: r.code,
        name: r.name,
        currency: r.currency,
        account_type: r.account_type,
        debit_total_minor: debit,
        credit_total_minor: credit,
        balance_minor: debit - credit,
      };
    });

    const totals = {};
    for (const a of accounts) {
      totals[a.currency] = totals[a.currency] || { debits_minor: 0, credits_minor: 0 };
      totals[a.currency].debits_minor += a.debit_total_minor;
      totals[a.currency].credits_minor += a.credit_total_minor;
    }

    res.status(200).json({ period, accounts, totals });
  } catch (err) {
    sendError(res, err);
  }
}

// ── Tax export (scaffolding) ──────────────────────────────────────────────

async function taxExport(req, res) {
  try {
    const entityId = parseId(req.query.entity_id, 'entity_id');
    const periodId = parseId(req.query.period_id, 'period_id');
    const format = String(req.query.format || 'json').toLowerCase();
    if (!['json', 'csv'].includes(format)) {
      throw httpError(400, 'format must be csv or json.');
    }

    const payload = await withDbBudget('exports', async () => {
      const { rows: periodRows } = await db.query(
        'SELECT id, entity_id, period_start, period_end, status FROM treasury_periods WHERE id = $1',
        [periodId]
      );
      if (!periodRows.length) throw httpError(404, 'Period not found.');
      const period = periodRows[0];
      if (period.entity_id !== entityId) throw httpError(400, 'Period does not belong to the given entity.');

      const { rows } = await db.query(
        `SELECT je.id, je.created_at, je.description, je.reference,
                da.code AS debit_code, da.name AS debit_name,
                ca.code AS credit_code, ca.name AS credit_name,
                je.amount_minor, je.currency
         FROM treasury_journal_entries je
         JOIN treasury_accounts da ON da.id = je.debit_account_id
         JOIN treasury_accounts ca ON ca.id = je.credit_account_id
         WHERE je.entity_id = $1 AND je.period_id = $2
         ORDER BY je.created_at, je.id`,
        [entityId, periodId]
      );

      const totals = {};
      for (const row of rows) {
        totals[row.currency] = totals[row.currency] || { entries: 0, total_minor: 0 };
        totals[row.currency].entries += 1;
        totals[row.currency].total_minor += Number(row.amount_minor);
      }
      return { period, entries: rows, totals };
    });

    if (format === 'csv') {
      const header = ['id', 'created_at', 'description', 'reference', 'debit_code', 'debit_name',
        'credit_code', 'credit_name', 'amount_minor', 'currency'];
      const lines = [header.join(',')];
      for (const row of payload.entries) {
        lines.push(header.map((h) => escapeCsv(row[h])).join(','));
      }
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="treasury-tax-export-${periodId}.csv"`);
      return res.status(200).send(lines.join('\n'));
    }

    res.status(200).json(payload);
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = {
  listEntities,
  createEntity,
  listAccounts,
  createAccount,
  postJournal,
  listJournal,
  listPeriods,
  createPeriod,
  closePeriod,
  periodSummary,
  taxExport,
};
