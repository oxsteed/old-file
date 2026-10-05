'use strict';

// Phase 2B: consistent statement snapshots.
// A snapshot freezes the exact rows, minor-unit totals and running balances of
// one statement issuance, keyed off the deterministic issuance key shared with
// the issuance job pipeline. Snapshots are money-neutral: they record ledger
// evidence produced by creditStatementService.getStatement (which itself runs a
// repeatable-read snapshot) and never move funds, never combine currencies or
// accounts, and use integer minor-unit arithmetic only.

const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const statements = require('./creditStatementService');

const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 2000;
const PRODUCTS = new Set(['oxsteed', 'restaurant']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function parseIssuanceKey(issuanceKey) {
  const text = String(issuanceKey || '');
  const parts = text.split(':');
  if (parts.length !== 8 || parts[0] !== 'stmt' || parts[1] !== 'v1') {
    throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  }
  const [, , product, accountId, currency, periodFrom, periodTo, customerId] = parts;
  if (!PRODUCTS.has(product)) throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  if (!/^[1-9]\d*$/.test(accountId)) throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  if (!CURRENCY_PATTERN.test(currency)) throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  if (!DATE_PATTERN.test(periodFrom) || !DATE_PATTERN.test(periodTo) || periodFrom > periodTo) {
    throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  }
  if (!UUID_PATTERN.test(customerId)) throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  return { product, accountId: Number(accountId), currency, periodFrom, periodTo, customerId };
}

function assertKeyMatches(issuanceKey, { product, accountId, currency, periodFrom, periodTo, customerId }) {
  const key = parseIssuanceKey(issuanceKey);
  const matches = key.product === product
    && key.accountId === Number(accountId)
    && key.currency === currency
    && key.periodFrom === periodFrom
    && key.periodTo === periodTo
    && key.customerId.toLowerCase() === String(customerId).toLowerCase();
  if (!matches) throw new AppError('Issuance key does not match the requested statement scope', 400, 'statement_snapshot_scope_mismatch');
  return key;
}

// Stable composite keyset cursor over the statement's canonical row order.
// The statement rows already arrive in canonical order (entry timestamp, null
// sequences last, entry id tiebreak); the cursor binds a chunk boundary to the
// underlying entry's (created_at, id) as surfaced by the statement document.
function rowCursor(row) {
  return `${row.date}|${row.id}`;
}

function canonicalRowDescriptor(row) {
  return {
    id: String(row.id),
    date: row.date,
    debitCents: row.debitCents,
    creditCents: row.creditCents,
    balanceAfterCents: row.balanceAfterCents,
  };
}

function hashRows(descriptors) {
  return crypto.createHash('sha256').update(JSON.stringify(descriptors)).digest('hex');
}

function toBigIntMinor(value, label) {
  try {
    const text = String(value);
    if (!/^-?\d+$/.test(text)) throw new Error('non-integer');
    return BigInt(text);
  } catch {
    throw new AppError(`Statement snapshot ${label} is not an integer minor-unit amount`, 409, 'statement_snapshot_integrity_failed');
  }
}

// Recompute totals from the frozen document with BigInt and assert the money
// invariant opening + credits - debits = closing, plus that the document's
// stated totals equal the sum of its own transactions.
function assertDocumentTotals(document) {
  const opening = toBigIntMinor(document.openingBalanceCents, 'opening balance');
  const closing = toBigIntMinor(document.closingBalanceCents, 'closing balance');
  const credits = toBigIntMinor(document.totalCreditsCents, 'total credits');
  const debits = toBigIntMinor(document.totalDebitsCents, 'total debits');
  const rows = Array.isArray(document.transactions) ? document.transactions : [];
  let sumCredits = 0n;
  let sumDebits = 0n;
  for (const row of rows) {
    sumCredits += toBigIntMinor(row.creditCents, 'row credit');
    sumDebits += toBigIntMinor(row.debitCents, 'row debit');
  }
  if (sumCredits !== credits || sumDebits !== debits) {
    throw new AppError('Statement snapshot totals do not match the statement rows', 409, 'statement_snapshot_integrity_failed');
  }
  if (opening + credits - debits !== closing) {
    throw new AppError('Statement snapshot does not reconcile: opening + credits - debits != closing', 409, 'statement_snapshot_integrity_failed');
  }
  return { opening, closing, credits, debits, rowCount: rows.length };
}

// Scope check: the issuance key's account id must resolve to the same account
// the statement was built for, so a snapshot can never mix currencies,
// customers or products. For oxsteed the key carries the wallet account id; for
// restaurant it carries the restaurant id and we resolve the customer wallet.
async function assertScopeMatches(client, key) {
  if (key.product === 'oxsteed') {
    const { rows: [account] } = await client.query(
      `SELECT id FROM oxsteed_credit_accounts
       WHERE id = $1 AND customer_id = $2 AND account_type = 'customer_wallet' AND currency_code = $3`,
      [key.accountId, key.customerId, key.currency]);
    if (!account) throw new AppError('Statement account does not match the issuance key', 404, 'statement_snapshot_scope_mismatch');
    return;
  }
  const { rows: [account] } = await client.query(
    `SELECT id FROM food_customer_wallet_accounts
     WHERE customer_id = $1 AND restaurant_id = $2 AND currency_code = $3`,
    [key.customerId, key.accountId, key.currency]);
  if (!account) throw new AppError('Statement account does not match the issuance key', 404, 'statement_snapshot_scope_mismatch');
}

function shapeSnapshot(manifest, chunks) {
  return {
    id: manifest.id,
    issuanceKey: manifest.issuance_key,
    product: manifest.product,
    accountId: Number(manifest.account_id),
    currency: manifest.currency_code,
    periodFrom: manifest.period_from instanceof Date ? manifest.period_from.toISOString().slice(0, 10) : manifest.period_from,
    periodTo: manifest.period_to instanceof Date ? manifest.period_to.toISOString().slice(0, 10) : manifest.period_to,
    cutoffAt: new Date(manifest.cutoff_at).toISOString(),
    schemaVersion: manifest.schema_version,
    rowCount: manifest.row_count,
    totalCreditsMinor: manifest.total_credits_minor,
    totalDebitsMinor: manifest.total_debits_minor,
    openingMinor: manifest.opening_minor,
    closingMinor: manifest.closing_minor,
    sourceHash: manifest.source_hash,
    chunkCount: manifest.chunk_count,
    createdAt: new Date(manifest.created_at).toISOString(),
    chunks: (chunks || []).map((chunk) => ({
      chunkIndex: chunk.chunk_index,
      cursorFrom: chunk.cursor_from,
      cursorTo: chunk.cursor_to,
      rowCount: chunk.row_count,
      creditsMinor: chunk.credits_minor,
      debitsMinor: chunk.debits_minor,
      chunkHash: chunk.chunk_hash,
    })),
  };
}

async function fetchSnapshot(client, id) {
  const { rows: [manifest] } = await client.query('SELECT * FROM statement_snapshots WHERE id = $1', [id]);
  if (!manifest) return null;
  const { rows: chunks } = await client.query(
    'SELECT * FROM statement_snapshot_chunks WHERE snapshot_id = $1 ORDER BY chunk_index', [id]);
  return shapeSnapshot(manifest, chunks);
}

async function freezeSnapshot({ issuanceKey, product, accountId, currency, periodFrom, periodTo, customerId, chunkSize = DEFAULT_CHUNK_SIZE }) {
  const key = assertKeyMatches(issuanceKey, { product, accountId, currency, periodFrom, periodTo, customerId });
  const size = Number(chunkSize);
  if (!Number.isSafeInteger(size) || size < 1 || size > 5000) {
    throw new AppError('Invalid snapshot chunk size', 400, 'statement_snapshot_invalid_chunk_size');
  }

  const existing = await getSnapshot(issuanceKey);
  if (existing) return existing;

  const document = await statements.getStatement(key.customerId, {
    product: key.product,
    currencyCode: key.currency,
    ...(key.product === 'restaurant' ? { restaurantId: key.accountId } : {}),
    from: key.periodFrom,
    to: key.periodTo,
  });
  const totals = assertDocumentTotals(document);

  const descriptors = (document.transactions || []).map(canonicalRowDescriptor);
  const sourceHash = hashRows(descriptors);
  const chunks = [];
  for (let offset = 0; offset < descriptors.length; offset += size) {
    const slice = descriptors.slice(offset, offset + size);
    const index = chunks.length;
    const next = descriptors[offset + size];
    chunks.push({
      chunkIndex: index,
      cursorFrom: rowCursor(slice[0]),
      cursorTo: next ? rowCursor(next) : null,
      rowCount: slice.length,
      creditsMinor: slice.reduce((sum, row) => sum + BigInt(row.creditCents), 0n),
      debitsMinor: slice.reduce((sum, row) => sum + BigInt(row.debitCents), 0n),
      chunkHash: hashRows(slice),
    });
  }
  // An empty period still freezes as one empty chunk so the manifest is complete.
  if (chunks.length === 0) {
    chunks.push({ chunkIndex: 0, cursorFrom: `${document.period.from}T00:00:00.000Z|`, cursorTo: null,
      rowCount: 0, creditsMinor: 0n, debitsMinor: 0n, chunkHash: hashRows([]) });
  }

  const snapshotId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertScopeMatches(client, key);
    const { rows: [manifest] } = await client.query(
      `INSERT INTO statement_snapshots
        (id, issuance_key, product, account_id, currency_code, period_from, period_to, cutoff_at,
         schema_version, row_count, total_credits_minor, total_debits_minor, opening_minor,
         closing_minor, source_hash, chunk_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, transaction_timestamp())
       ON CONFLICT (issuance_key) DO NOTHING
       RETURNING *`,
      [snapshotId, issuanceKey, key.product, key.accountId, key.currency, key.periodFrom, key.periodTo,
        document.generatedAt, SNAPSHOT_SCHEMA_VERSION, totals.rowCount, String(totals.credits),
        String(totals.debits), String(totals.opening), String(totals.closing), sourceHash, chunks.length]);
    if (!manifest) {
      // A concurrent freeze won the race: return the completed snapshot instead
      // of re-snapshotting. Never re-freeze an existing issuance key.
      await client.query('ROLLBACK');
      return getSnapshot(issuanceKey);
    }
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO statement_snapshot_chunks
          (snapshot_id, chunk_index, cursor_from, cursor_to, row_count, credits_minor, debits_minor, chunk_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [manifest.id, chunk.chunkIndex, chunk.cursorFrom, chunk.cursorTo, chunk.rowCount,
          String(chunk.creditsMinor), String(chunk.debitsMinor), chunk.chunkHash]);
    }
    await client.query('COMMIT');
    return shapeSnapshot(manifest, await client.query(
      'SELECT * FROM statement_snapshot_chunks WHERE snapshot_id = $1 ORDER BY chunk_index', [manifest.id]).then((result) => result.rows));
  } catch (error) {
    await client.query('ROLLBACK');
    // A unique violation here means a concurrent freeze completed first.
    if (error.code === '23505') return getSnapshot(issuanceKey);
    throw error;
  } finally {
    client.release();
  }
}

async function getSnapshot(issuanceKey) {
  const client = await pool.connect();
  try {
    const { rows: [manifest] } = await client.query('SELECT * FROM statement_snapshots WHERE issuance_key = $1', [issuanceKey]);
    if (!manifest) return null;
    const { rows: chunks } = await client.query(
      'SELECT * FROM statement_snapshot_chunks WHERE snapshot_id = $1 ORDER BY chunk_index', [manifest.id]);
    return shapeSnapshot(manifest, chunks);
  } finally {
    client.release();
  }
}

// Re-sums chunk descriptors against the manifest and asserts structural
// integrity: contiguous chunk indexes, matching counts/totals, and continuous
// cursor boundaries. Detects tampered chunk rows (the chunks table carries no
// immutability trigger by design; verification is the control).
async function verifySnapshot(snapshotId) {
  const checks = [];
  const fail = (name, expected, actual) => {
    checks.push({ name, ok: false, expected, actual });
    return false;
  };
  const pass = (name) => {
    checks.push({ name, ok: true });
    return true;
  };
  const client = await pool.connect();
  try {
    const snapshot = await fetchSnapshot(client, snapshotId);
    if (!snapshot) throw new AppError('Statement snapshot not found', 404, 'statement_snapshot_not_found');
    let ok = true;
    ok = (snapshot.chunks.length === snapshot.chunkCount
      ? pass('chunk count matches manifest')
      : fail('chunk count matches manifest', snapshot.chunkCount, snapshot.chunks.length)) && ok;
    let rows = 0n;
    let credits = 0n;
    let debits = 0n;
    for (let index = 0; index < snapshot.chunks.length; index += 1) {
      const chunk = snapshot.chunks[index];
      if (chunk.chunkIndex !== index) {
        ok = fail(`chunk ${index} index is contiguous`, index, chunk.chunkIndex) && ok;
      } else {
        pass(`chunk ${index} index is contiguous`);
      }
      rows += BigInt(chunk.rowCount);
      credits += BigInt(chunk.creditsMinor);
      debits += BigInt(chunk.debitsMinor);
      const next = snapshot.chunks[index + 1];
      const boundaryOk = next ? chunk.cursorTo === next.cursorFrom : chunk.cursorTo === null;
      ok = (boundaryOk
        ? pass(`chunk ${index} cursor boundary is continuous`)
        : fail(`chunk ${index} cursor boundary is continuous`, next ? next.cursorFrom : null, chunk.cursorTo)) && ok;
    }
    ok = (rows === BigInt(snapshot.rowCount)
      ? pass('chunk row counts sum to manifest row count')
      : fail('chunk row counts sum to manifest row count', String(snapshot.rowCount), rows.toString())) && ok;
    ok = (credits === BigInt(snapshot.totalCreditsMinor)
      ? pass('chunk credits sum to manifest total credits')
      : fail('chunk credits sum to manifest total credits', String(snapshot.totalCreditsMinor), credits.toString())) && ok;
    ok = (debits === BigInt(snapshot.totalDebitsMinor)
      ? pass('chunk debits sum to manifest total debits')
      : fail('chunk debits sum to manifest total debits', String(snapshot.totalDebitsMinor), debits.toString())) && ok;
    ok = (BigInt(snapshot.openingMinor) + credits - debits === BigInt(snapshot.closingMinor)
      ? pass('manifest reconciles: opening + credits - debits = closing')
      : fail('manifest reconciles: opening + credits - debits = closing',
        String(snapshot.closingMinor),
        (BigInt(snapshot.openingMinor) + credits - debits).toString())) && ok;
    return { ok, details: { snapshotId: snapshot.id, issuanceKey: snapshot.issuanceKey, checks } };
  } finally {
    client.release();
  }
}

module.exports = {
  freezeSnapshot,
  verifySnapshot,
  getSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_CHUNK_SIZE,
};
