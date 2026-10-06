'use strict';

// Read-only projections of immutable observations made by the EXISTING financial
// writers (migration 694). recorded_at is the posting/knowledge date. Mutable
// issue_date/completed_at/paid_at remain effective-date disclosures, never clocks
// for silently restating a previous month. A baseline only establishes a position
// at its actual observation time; no pre-baseline position can be inferred.
const { AppError } = require('../middleware/errorHandler');
const { exactMoney, MAX_ROWS } = require('./creditStatementService');
const { decimal } = require('./creditStatementPdf');

function unavailable(message) {
  throw new AppError(message, 409, 'statement_source_history_unavailable');
}
function integrity(message) {
  throw new AppError(message, 409, 'statement_integrity_failed');
}
function currencyPrecision(currency) {
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf('currency').includes(currency)) {
    throw new AppError('Unsupported statement currency', 409, 'statement_source_currency_unsupported');
  }
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
}
function majorToMinor(value, currency, label) {
  const digits = currencyPrecision(currency);
  const text = String(value ?? '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) integrity(`Invalid source amount: ${label}`);
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  if (/[1-9]/.test(fraction.slice(digits))) integrity(`Inconsistent currency precision: ${label}`);
  const minor = BigInt(whole) * 10n ** BigInt(digits)
    + BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
  return exactMoney(text.startsWith('-') ? -minor : minor);
}
function formatMinor(value, currency) {
  currencyPrecision(currency);
  return decimal(exactMoney(value), currency);
}
function date(value) {
  const result = new Date(value);
  if (!value || !Number.isFinite(result.getTime())) integrity('Invalid source observation date');
  return result;
}
function bounds(period, now) {
  const start = date(`${period.from}T00:00:00.000Z`);
  // The period end is exclusive. Do not cap today's boundary to a JavaScript
  // Date: node-postgres truncates PostgreSQL microseconds to milliseconds, so
  // an event written moments before a new transaction can compare later than
  // that rounded timestamp and disappear from the same-day statement. The
  // database transaction snapshot below is the authoritative as-of cutoff.
  date(now); // Validate the supplied snapshot time even though it is not the period boundary.
  const end = new Date(Date.parse(period.to) + 86400000);
  return { start, end };
}

async function readSourceHistory(client, kind, scopeId, currency, maxRows = MAX_ROWS) {
  currencyPrecision(currency);
  // Find sources by ANY version, then read their entire chain. Filtering each
  // version by current scope/currency could hide a transfer or reassignment.
  try {
    const { rows } = await client.query(
      `SELECT h.id, h.source_kind, h.source_id, h.scope_id, h.currency_code,
              h.operation, h.recorded_at, h.source
         FROM settlement_source_history h
        WHERE h.source_kind = $1 AND h.source_id IN (
          SELECT source_id FROM settlement_source_history
         WHERE source_kind = $1 AND scope_id = $2 AND currency_code = $3)
          AND h.recorded_at <= transaction_timestamp()
         ORDER BY h.id LIMIT $4`, [kind, String(scopeId), currency, maxRows + 1]);
    if (rows.length > maxRows) throw new AppError('Complete source history requires a narrower export period', 409, 'statement_export_too_large');
    return rows;
  } catch (error) {
    if (error.code === '42P01') unavailable('Financial source history is not installed');
    throw error;
  }
}

function chains(rows, scopeId, currency, start) {
  const grouped = new Map();
  let lastId = 0n;
  for (const row of rows) {
    if (!/^\d+$/.test(String(row.id)) || BigInt(row.id) <= lastId) integrity('Unordered source history');
    lastId = BigInt(row.id);
    const unassigned = row.scope_id === null && (row.source_kind === 'helper_job'
      ? !row.source.completed_at : row.source.status === 'draft');
    if ((!unassigned && String(row.scope_id) !== String(scopeId))
      || row.currency_code !== currency) unavailable('Financial source scope or currency changed');
    const time = date(row.recorded_at);
    const chain = grouped.get(String(row.source_id)) || [];
    if (!chain.length) {
      if (!['insert', 'baseline'].includes(row.operation)) unavailable('Incomplete financial source history');
      if (row.operation === 'baseline' && time > start) unavailable('Period precedes the financial source observation baseline');
    } else if (time < date(chain[chain.length - 1].recorded_at)
      || ['insert', 'baseline'].includes(row.operation)
      || chain[chain.length - 1].operation === 'delete') integrity('Broken financial source history');
    chain.push(row);
    grouped.set(String(row.source_id), chain);
  }
  return grouped;
}
function reference(row) {
  return { sourceHistoryId: String(row.id), sourceId: String(row.source_id),
    sourceKind: row.source_kind, recordedAt: date(row.recorded_at).toISOString() };
}
function stateAt(chain, boundary) {
  return chain.filter(row => date(row.recorded_at) < boundary).at(-1);
}

function invoiceState(row, currency) {
  if (!row) return { gross: 0n, paid: 0n, outstanding: 0n };
  const s = row.source;
  if (!['draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled'].includes(s.status)) integrity('Unknown invoice state');
  const total = BigInt(majorToMinor(s.total, currency, 'invoice total'));
  const amountPaid = BigInt(majorToMinor(s.amount_paid, currency, 'invoice amount_paid'));
  if (total < 0n || amountPaid < 0n || amountPaid > total || s.status === 'paid' && amountPaid !== total) integrity('Invalid invoice position');
  const recognized = !['draft', 'cancelled'].includes(s.status);
  if (row.operation === 'delete' && recognized && total !== amountPaid) unavailable('Outstanding invoice was deleted without a correction');
  const gross = recognized ? total : 0n;
  const paid = recognized ? amountPaid : 0n;
  return { gross, paid, outstanding: gross - paid, total, amountPaid, recognized };
}

function projectBusiness(rows, { businessId, currency, period, now }) {
  const { start, end } = bounds(period, now);
  const grouped = chains(rows.filter(r => r.operation === 'baseline' || date(r.recorded_at) < end), businessId, currency, start);
  let opening = 0n; let closing = 0n; let invoiced = 0n; let collected = 0n; let cancelled = 0n;
  const invoices = []; const movements = [];
  for (const chain of grouped.values()) {
    opening += invoiceState(stateAt(chain, start), currency).outstanding;
    const closingRow = stateAt(chain, end);
    const close = invoiceState(closingRow, currency);
    closing += close.outstanding;
    let prior;
    for (const row of chain) {
      const before = invoiceState(prior, currency); const after = invoiceState(row, currency);
      if (row.operation !== 'baseline' && date(row.recorded_at) >= start && date(row.recorded_at) < end) {
        let issued = after.gross - before.gross; let paid = after.paid - before.paid; let removed = 0n;
        if (row.source.status === 'cancelled' && before.recognized) {
          if (after.total !== before.total || after.amountPaid !== before.amountPaid) unavailable('Cancellation also changed invoice amounts');
          issued = 0n; paid = 0n; removed = before.outstanding;
        }
        if (prior && row.source.status === 'draft' && before.recognized) unavailable('Posted invoice returned to draft without correction');
        invoiced += issued; collected += paid; cancelled += removed;
        if (issued || paid || removed) movements.push({ ...reference(row),
          effectiveDate: row.source.paid_at || row.source.issue_date,
          invoicedCents: exactMoney(issued), collectedOrAdjustedCents: exactMoney(paid),
          cancelledCents: exactMoney(removed), outstandingAfterCents: exactMoney(after.outstanding) });
      }
      prior = row;
    }
    if (closingRow) {
      const s = closingRow.source;
      invoices.push({ id: String(closingRow.source_id), invoiceNumber: String(s.invoice_number || ''), clientName: String(s.client_name || ''),
        status: s.status, issueDate: s.issue_date, dueDate: s.due_date || null,
        totalCents: exactMoney(close.total), paidCents: exactMoney(close.amountPaid), outstandingCents: exactMoney(close.outstanding),
        paidAt: s.paid_at || null, sourceHistoryId: String(closingRow.id) });
    }
  }
  if (opening + invoiced - collected - cancelled !== closing) integrity('Invoice source history does not reconcile');
  return { openingOutstandingCents: exactMoney(opening), invoicedCents: exactMoney(invoiced),
    collectedOrAdjustedCents: exactMoney(collected), cancelledCents: exactMoney(cancelled), closingOutstandingCents: exactMoney(closing),
    collectedOrAdjustedNote: 'Actual changes in recorded cumulative payments, posted at the immutable source observation time; negative changes are refunds/corrections.',
    invoices, invoiceCount: invoices.length, movements,
    sourceHistoryVersion: 1, postingDateContract: 'recorded_at; source issue_date/paid_at are effective dates, not historical posting evidence' };
}

function helperState(row) {
  if (!row) return { earned: 0n, settled: 0n, payable: 0n, bucket: 'accrued' };
  const s = row.source;
  if (!['not_ready', 'earned', 'pending', 'processing', 'paid', 'failed', 'reversed', 'cancelled'].includes(s.payout_status)) integrity('Unknown helper payout state');
  if (s.completed_at && (s.helper_payout_cents === null || s.helper_payout_cents === undefined)) unavailable('Completed helper earning lacks an authoritative net amount');
  if (!s.completed_at) {
    if (['paid', 'reversed'].includes(s.payout_status)) unavailable('Helper payout lacks an earning date/amount');
    return { earned: 0n, settled: 0n, payable: 0n, bucket: 'accrued' };
  }
  const earned = BigInt(exactMoney(s.helper_payout_cents));
  if (earned < 0n || date(s.completed_at) > date(row.recorded_at)) integrity('Invalid helper earning evidence');
  if ((s.payout_status === 'cancelled' || s.status === 'cancelled') && earned) unavailable('Cancelled helper earning lacks an authoritative net-amount correction');
  if (s.payout_status === 'paid' && (!s.paid_at || date(s.paid_at) > date(row.recorded_at))) unavailable('Helper settlement lacks dated evidence');
  if (row.operation === 'delete' && earned) unavailable('Helper earning was deleted without a correction');
  const settled = s.payout_status === 'paid' ? earned : 0n;
  return { earned, settled, payable: earned - settled,
    bucket: s.payout_status === 'paid' ? 'settled' : ['pending', 'processing'].includes(s.payout_status) ? 'inTransit' : 'accrued' };
}
function projectHelper(rows, { helperId, currency, period, now }) {
  // The existing jobs writer/backfill contract is cents (x100), including its
  // legacy decimal fallback. Do not relabel that source as JPY/BHD minor units.
  if (currencyPrecision(currency) !== 2) throw new AppError('Helper cents source does not support this currency precision', 409, 'statement_source_currency_unsupported');
  const { start, end } = bounds(period, now);
  const grouped = chains(rows.filter(r => r.operation === 'baseline' || date(r.recorded_at) < end), helperId, currency, start);
  let opening = 0n; let closing = 0n; let posted = 0n; let settled = 0n; let removed = 0n; let fees = 0n;
  const earnings = []; const settlements = []; const removals = []; const movements = [];
  const buckets = { accruedCents: 0n, inTransitCents: 0n, settledAllTimeCents: 0n, notOwedCents: 0n, totalEarnedCents: 0n };
  for (const chain of grouped.values()) {
    opening += helperState(stateAt(chain, start)).payable;
    const closingRow = stateAt(chain, end); const close = helperState(closingRow);
    closing += close.payable;
    buckets[close.bucket === 'settled' ? 'settledAllTimeCents' : `${close.bucket}Cents`] += close.bucket === 'settled' ? close.settled : close.payable;
    buckets.totalEarnedCents += close.earned;
    let prior;
    for (const row of chain) {
      const before = helperState(prior); const after = helperState(row);
      if (row.source.payout_status === 'reversed' && (!prior || !chain.some(r => BigInt(r.id) < BigInt(row.id) && r.source.payout_status === 'paid'))) unavailable('Helper reversal lacks original settlement evidence');
      if (prior && before.settled && after.earned !== before.earned) unavailable('Settled helper amount changed without allocated refund evidence');
      if (row.operation !== 'baseline' && date(row.recorded_at) >= start && date(row.recorded_at) < end) {
        const delta = after.earned - before.earned; const payout = after.settled - before.settled;
        const postedDelta = delta > 0n ? delta : 0n; const removedDelta = delta < 0n ? -delta : 0n;
        posted += postedDelta; removed += removedDelta; settled += payout;
        const s = row.source;
        const base = { ...reference(row), jobId: String(row.source_id), title: String(s.title || '').slice(0, 140),
          payoutStatus: s.payout_status, bucket: after.bucket, effectiveDate: s.completed_at,
          completedAt: date(row.recorded_at).toISOString(),
          platformFeeCents: s.platform_fee_cents === null ? null : exactMoney(s.platform_fee_cents),
          customerTotalCents: s.customer_total_cents === null ? null : exactMoney(s.customer_total_cents) };
        if (postedDelta) { earnings.push({ ...base, helperPayoutCents: exactMoney(postedDelta), kind: prior ? 'adjustment' : 'posted' });
          fees += BigInt(base.platformFeeCents || 0) - BigInt(prior?.source.platform_fee_cents || 0); }
        if (removedDelta) removals.push({ ...base, helperPayoutCents: exactMoney(removedDelta), removedAt: base.recordedAt });
        if (payout) settlements.push({ ...base, helperPayoutCents: exactMoney(payout), paidAt: base.recordedAt, effectiveDate: s.paid_at,
          kind: payout < 0n ? 'settlement_reversal' : 'settlement' });
        if (delta || payout) movements.push({ ...reference(row), postedEarningsCents: exactMoney(postedDelta),
          settledPayoutsCents: exactMoney(payout), statusRemovalsCents: exactMoney(removedDelta), payableAfterCents: exactMoney(after.payable) });
      }
      prior = row;
    }
  }
  if (opening + posted - settled - removed !== closing) integrity('Helper source history does not reconcile');
  return { openingPayableCents: exactMoney(opening), postedEarningsCents: exactMoney(posted), settledPayoutsCents: exactMoney(settled),
    statusRemovalsCents: exactMoney(removed), closingPayableCents: exactMoney(closing), platformFeesOnPostedCents: exactMoney(fees),
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, exactMoney(v)])),
    earnings, settled: settlements, removed: removals, movements,
    earningsCount: earnings.length, settledCount: settlements.length, removedCount: removals.length,
    sourceHistoryVersion: 1,
    snapshotNote: 'Positions and buckets are frozen at the period cutoff from immutable source observations. Failed payout transport leaves earnings owed; a recorded payout reversal restores payable.',
    equationNote: 'openingPayableCents + postedEarningsCents - settledPayoutsCents - statusRemovalsCents = closingPayableCents. Movements use recorded_at; reductions require an actual net earning amount correction.',
    postingDateContract: 'recorded_at; completed_at/paid_at remain effective-date disclosures' };
}

module.exports = { readSourceHistory, projectBusiness, projectHelper, majorToMinor, currencyPrecision, formatMinor, bounds, unavailable };
