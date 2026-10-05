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
const settlementStatements = require('./settlementStatementService');

const SNAPSHOT_SCHEMA_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 2000;
const PRODUCTS = new Set(['oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business']);
// Products whose account scope is a UUID (helper user id) rather than a BIGINT.
const UUID_SCOPED_PRODUCTS = new Set(['helper_earnings']);
// Products whose statements archive into settlement_statement_documents
// (migration 688) and are computed by settlementStatementService.
const SETTLEMENT_PRODUCTS = new Set(['restaurant_settlement', 'helper_earnings', 'business']);
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
  if (UUID_SCOPED_PRODUCTS.has(product)) {
    if (!UUID_PATTERN.test(accountId)) throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  } else if (!/^[1-9]\d*$/.test(accountId)) {
    throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  }
  if (!CURRENCY_PATTERN.test(currency)) throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  if (!DATE_PATTERN.test(periodFrom) || !DATE_PATTERN.test(periodTo) || periodFrom > periodTo) {
    throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  }
  if (!UUID_PATTERN.test(customerId)) throw new AppError('Invalid statement issuance key', 400, 'statement_snapshot_invalid_key');
  return {
    product,
    accountId: UUID_SCOPED_PRODUCTS.has(product) ? accountId.toLowerCase() : Number(accountId),
    currency, periodFrom, periodTo, customerId,
  };
}

function accountIdMatches(keyAccountId, requestedAccountId) {
  if (typeof keyAccountId === 'string') {
    return keyAccountId.toLowerCase() === String(requestedAccountId).toLowerCase();
  }
  return keyAccountId === Number(requestedAccountId);
}

function assertKeyMatches(issuanceKey, { product, accountId, currency, periodFrom, periodTo, customerId }) {
  const key = parseIssuanceKey(issuanceKey);
  const matches = key.product === product
    && accountIdMatches(key.accountId, accountId)
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

// Minor units are stringified in descriptors: JSON.stringify cannot serialize
// BigInt, and the hash must be stable across representations.
function canonicalRowDescriptor(row) {
  return {
    id: String(row.id),
    date: row.date,
    debitCents: String(row.debitCents),
    creditCents: String(row.creditCents),
    balanceAfterCents: row.balanceAfterCents === null || row.balanceAfterCents === undefined
      ? null : String(row.balanceAfterCents),
    ...(row.label ? { label: String(row.label) } : {}),
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

// Per-product frozen evidence: the row list plus the money equation the
// snapshot asserts. Credit products and restaurant_settlement share the
// journal shape (opening + credits - debits = closing over transactions with
// running balances). helper_earnings and business are deterministic snapshots
// over activity records (the settlement inventory documents why no
// append-only ledger exists for them): their evidence rows are the
// statement's own period rows, and the manifest asserts the product's own
// equation from the adapter. Statements never move money; freezing only
// records what the statement computed.
function journalEvidence(document) {
  const openingMinor = toBigIntMinor(document.openingBalanceCents, 'opening balance');
  const creditsMinor = toBigIntMinor(document.totalCreditsCents, 'total credits');
  const debitsMinor = toBigIntMinor(document.totalDebitsCents, 'total debits');
  const closingMinor = toBigIntMinor(document.closingBalanceCents, 'closing balance');
  const rows = (Array.isArray(document.transactions) ? document.transactions : []).map((row) => ({
    id: String(row.id),
    date: row.date,
    debitCents: toBigIntMinor(row.debitCents, 'row debit'),
    creditCents: toBigIntMinor(row.creditCents, 'row credit'),
    balanceAfterCents: row.balanceAfterCents === null || row.balanceAfterCents === undefined
      ? null : toBigIntMinor(row.balanceAfterCents, 'row balance'),
  }));
  return { openingMinor, creditsMinor, debitsMinor, closingMinor, rows };
}

function helperEarningsEvidence(document) {
  const openingMinor = toBigIntMinor(document.openingPayableCents, 'opening payable');
  const postedMinor = toBigIntMinor(document.postedEarningsCents, 'posted earnings');
  const settledMinor = toBigIntMinor(document.settledPayoutsCents, 'settled payouts');
  const removedMinor = toBigIntMinor(document.statusRemovalsCents, 'status removals');
  const closingMinor = toBigIntMinor(document.closingPayableCents, 'closing payable');
  if(Array.isArray(document.movements)) {
    const rows=document.movements.map(entry=>{
      const posted=toBigIntMinor(entry.postedEarningsCents,'posted movement');
      const settled=toBigIntMinor(entry.settledPayoutsCents,'settled movement');
      const removed=toBigIntMinor(entry.statusRemovalsCents,'removed movement');
      return {id:`history:${entry.sourceHistoryId}`,date:entry.recordedAt,
        creditCents:posted+(settled<0n?-settled:0n),debitCents:removed+(settled>0n?settled:0n),balanceAfterCents:null};
    });
    return {openingMinor,closingMinor,rows,
      creditsMinor:rows.reduce((sum,row)=>sum+row.creditCents,0n),debitsMinor:rows.reduce((sum,row)=>sum+row.debitCents,0n)};
  }
  const rows = [];
  for (const entry of Array.isArray(document.earnings) ? document.earnings : []) {
    const payout = toBigIntMinor(entry.helperPayoutCents, 'earned payout');
    // A removed earning was posted in the period and then left the payable
    // position: it contributes to both sides so the row sums reproduce the
    // adapter's postedEarningsCents and statusRemovalsCents exactly.
    rows.push({
      id: `earned:${entry.jobId}`,
      date: entry.completedAt,
      debitCents: entry.kind === 'removed' ? payout : 0n,
      creditCents: payout,
      balanceAfterCents: null,
      ...(entry.kind === 'removed' ? { label: 'removed' } : {}),
    });
  }
  for (const entry of Array.isArray(document.settled) ? document.settled : []) {
    rows.push({
      id: `settled:${entry.jobId}`,
      date: entry.paidAt,
      debitCents: toBigIntMinor(entry.helperPayoutCents, 'settled payout'),
      creditCents: 0n,
      balanceAfterCents: null,
    });
  }
  return {
    openingMinor,
    creditsMinor: postedMinor,
    debitsMinor: settledMinor + removedMinor,
    closingMinor,
    rows,
  };
}

function businessEvidence(document) {
  const receivables = document && typeof document.receivables === 'object' ? document.receivables : {};
  const period = document && typeof document.period === 'object' ? document.period : {};
  const openingMinor = toBigIntMinor(receivables.openingOutstandingCents, 'opening outstanding');
  const invoicedMinor = toBigIntMinor(receivables.invoicedCents, 'invoiced');
  const collectedOrAdjustedMinor = toBigIntMinor(receivables.collectedOrAdjustedCents, 'collected or adjusted');
  const cancelledMinor = toBigIntMinor(receivables.cancelledCents, 'cancelled');
  const closingMinor = toBigIntMinor(receivables.closingOutstandingCents, 'closing outstanding');
  if(Array.isArray(receivables.movements)) {
    const rows=receivables.movements.map(entry=>{
      const issued=toBigIntMinor(entry.invoicedCents,'invoice movement');
      const collected=toBigIntMinor(entry.collectedOrAdjustedCents,'payment movement');
      const cancelled=toBigIntMinor(entry.cancelledCents,'cancelled movement');
      return {id:`history:${entry.sourceHistoryId}`,date:entry.recordedAt,
        creditCents:(issued>0n?issued:0n)+(collected<0n?-collected:0n),
        debitCents:(issued<0n?-issued:0n)+(collected>0n?collected:0n)+cancelled,balanceAfterCents:null};
    });
    return {openingMinor,closingMinor,rows,
      creditsMinor:rows.reduce((sum,row)=>sum+row.creditCents,0n),debitsMinor:rows.reduce((sum,row)=>sum+row.debitCents,0n)};
  }
  const rows = [];
  for (const inv of Array.isArray(receivables.invoices) ? receivables.invoices : []) {
    const issuedInPeriod = inv.issueDate && inv.issueDate >= period.from && inv.issueDate <= period.to;
    if (!issuedInPeriod || inv.status === 'draft') continue;
    const total = toBigIntMinor(inv.totalCents, 'invoice total');
    if (inv.status === 'cancelled') {
      rows.push({
        id: `cancelled:${inv.id}`, date: inv.issueDate,
        debitCents: total, creditCents: 0n, balanceAfterCents: null,
      });
    } else {
      rows.push({
        id: `invoiced:${inv.id}`, date: inv.issueDate,
        debitCents: 0n, creditCents: total, balanceAfterCents: null,
      });
    }
  }
  // The collected-or-adjusted plug is derived (invoice payments carry no
  // per-payment timestamp; the statement discloses this). Freezing it as a
  // labeled row keeps the manifest equation exact and the derivation auditable.
  rows.push({
    id: 'collected-or-adjusted',
    date: period.to,
    debitCents: collectedOrAdjustedMinor,
    creditCents: 0n,
    balanceAfterCents: null,
    label: 'derived-plug',
  });
  return {
    openingMinor,
    creditsMinor: invoicedMinor,
    debitsMinor: collectedOrAdjustedMinor + cancelledMinor,
    closingMinor,
    rows,
  };
}

function evidenceForDocument(document) {
  const product = document && document.product;
  if (product === 'helper_earnings') return helperEarningsEvidence(document);
  if (product === 'business') return businessEvidence(document);
  return journalEvidence(document);
}

// Recompute totals from the frozen evidence with BigInt and assert the money
// invariant opening + credits - debits = closing, plus that the evidence
// totals equal the sum of its own rows.
function assertEvidenceTotals(evidence) {
  let sumCredits = 0n;
  let sumDebits = 0n;
  for (const row of evidence.rows) {
    sumCredits += BigInt(row.creditCents);
    sumDebits += BigInt(row.debitCents);
  }
  if (sumCredits !== evidence.creditsMinor || sumDebits !== evidence.debitsMinor) {
    throw new AppError('Statement snapshot totals do not match the statement rows', 409, 'statement_snapshot_integrity_failed');
  }
  if (evidence.openingMinor + sumCredits - sumDebits !== evidence.closingMinor) {
    throw new AppError('Statement snapshot does not reconcile: opening + credits - debits != closing', 409, 'statement_snapshot_integrity_failed');
  }
  return {
    opening: evidence.openingMinor,
    closing: evidence.closingMinor,
    credits: evidence.creditsMinor,
    debits: evidence.debitsMinor,
    rowCount: evidence.rows.length,
  };
}

// Back-compat alias: the journal evidence is what the original
// assertDocumentTotals asserted.
function assertDocumentTotals(document) {
  return assertEvidenceTotals(journalEvidence(document));
}

// Scope check: the issuance key's account id must resolve to the same account
// the statement was built for, so a snapshot can never mix currencies,
// customers or products. For oxsteed the key carries the wallet account id; for
// restaurant it carries the restaurant id and we resolve the customer wallet;
// for settlement products the key carries the product's own scope id
// (restaurant id, helper user id, business id).
async function assertScopeMatches(client, key) {
  if (key.product === 'oxsteed') {
    const { rows: [account] } = await client.query(
      `SELECT id FROM oxsteed_credit_accounts
       WHERE id = $1 AND customer_id = $2 AND account_type = 'customer_wallet' AND currency_code = $3`,
      [key.accountId, key.customerId, key.currency]);
    if (!account) throw new AppError('Statement account does not match the issuance key', 404, 'statement_snapshot_scope_mismatch');
    return;
  }
  if (key.product === 'restaurant') {
    const { rows: [account] } = await client.query(
      `SELECT id FROM food_customer_wallet_accounts
       WHERE customer_id = $1 AND restaurant_id = $2 AND currency_code = $3`,
      [key.customerId, key.accountId, key.currency]);
    if (!account) throw new AppError('Statement account does not match the issuance key', 404, 'statement_snapshot_scope_mismatch');
    return;
  }
  if (key.product === 'restaurant_settlement') {
    const { rows: [account] } = await client.query(
      `SELECT id FROM oxsteed_credit_accounts
       WHERE account_type = 'restaurant_sub_bank' AND restaurant_id = $1 AND currency_code = $2`,
      [key.accountId, key.currency]);
    if (!account) throw new AppError('Statement account does not match the issuance key', 404, 'statement_snapshot_scope_mismatch');
    return;
  }
  if (key.product === 'helper_earnings') {
    const { rows: [user] } = await client.query('SELECT id FROM users WHERE id = $1', [key.accountId]);
    if (!user) throw new AppError('Statement account does not match the issuance key', 404, 'statement_snapshot_scope_mismatch');
    return;
  }
  const { rows: [business] } = await client.query('SELECT id FROM businesses WHERE id = $1', [key.accountId]);
  if (!business) throw new AppError('Statement account does not match the issuance key', 404, 'statement_snapshot_scope_mismatch');
}

async function loadStatementDocument(key) {
  if (SETTLEMENT_PRODUCTS.has(key.product)) {
    const options = {
      product: key.product,
      currencyCode: key.currency,
      from: key.periodFrom,
      to: key.periodTo,
    };
    if (key.product === 'restaurant_settlement') options.restaurantId = key.accountId;
    else if (key.product === 'business') options.businessId = key.accountId;
    else options.helperId = key.accountId;
    // The issuance customerId is the statement recipient (owner/helper);
    // the settlement builders record it as generatedBy, same convention as
    // the credit builders.
    return settlementStatements.getStatement(key.customerId, options);
  }
  return statements.getStatement(key.customerId, {
    product: key.product,
    currencyCode: key.currency,
    ...(key.product === 'restaurant' ? { restaurantId: key.accountId } : {}),
    from: key.periodFrom,
    to: key.periodTo,
  });
}

function shapeSnapshot(manifest, chunks) {
  return {
    id: manifest.id,
    issuanceKey: manifest.issuance_key,
    product: manifest.product,
    accountId: manifest.account_uuid ? String(manifest.account_uuid) : Number(manifest.account_id),
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

  const document = await loadStatementDocument(key);
  const evidence = evidenceForDocument(document);
  const totals = assertEvidenceTotals(evidence);

  const descriptors = evidence.rows.map(canonicalRowDescriptor);
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
        (id, issuance_key, product, account_id, account_uuid, currency_code, period_from, period_to, cutoff_at,
         schema_version, row_count, total_credits_minor, total_debits_minor, opening_minor,
         closing_minor, source_hash, chunk_count, created_at,frozen_document)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, transaction_timestamp(),$18)
       ON CONFLICT (issuance_key) DO NOTHING
       RETURNING *`,
      [snapshotId, issuanceKey, key.product,
        UUID_SCOPED_PRODUCTS.has(key.product) ? null : key.accountId,
        UUID_SCOPED_PRODUCTS.has(key.product) ? key.accountId : null,
        key.currency, key.periodFrom, key.periodTo,
        document.generatedAt, SNAPSHOT_SCHEMA_VERSION, totals.rowCount, String(totals.credits),
        String(totals.debits), String(totals.opening), String(totals.closing), sourceHash, chunks.length,JSON.stringify(document)]);
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

async function getFrozenDocument(snapshotId) {
  if(!UUID_PATTERN.test(String(snapshotId||'')))throw new AppError('Statement snapshot not found',404,'statement_snapshot_not_found');
  const {rows:[manifest]}=await pool.query('SELECT * FROM statement_snapshots WHERE id=$1',[snapshotId]);
  if(!manifest)throw new AppError('Statement snapshot not found',404,'statement_snapshot_not_found');
  const document=manifest.frozen_document;
  // A legacy hash-only manifest cannot prove byte/document identity. Never
  // relink it to a fresh build: the issuer must expose an explicit repair gate.
  if(!document)throw new AppError('Legacy snapshot has no frozen source document',409,'statement_snapshot_document_unavailable');
  const totals=assertEvidenceTotals(evidenceForDocument(document));
  const sourceHash=hashRows(evidenceForDocument(document).rows.map(canonicalRowDescriptor));
  const documentHash=SETTLEMENT_PRODUCTS.has(document.product)?settlementStatements.hashDocument(document):statements.hashDocument(document);
  const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value);
  if(document.product!==manifest.product||document.currencyCode!==manifest.currency_code
    ||document.period?.from!==day(manifest.period_from)||document.period?.to!==day(manifest.period_to)
    ||new Date(document.generatedAt).toISOString()!==new Date(manifest.cutoff_at).toISOString()
    ||document.contentHash!==documentHash||sourceHash!==manifest.source_hash
    ||BigInt(totals.rowCount)!==BigInt(manifest.row_count)||totals.opening!==BigInt(manifest.opening_minor)
    ||totals.closing!==BigInt(manifest.closing_minor)||totals.credits!==BigInt(manifest.total_credits_minor)
    ||totals.debits!==BigInt(manifest.total_debits_minor)) {
    throw new AppError('Frozen statement source document verification failed',409,'statement_snapshot_integrity_failed');
  }
  return document;
}

// Durable export sources are separate from v1 issued documents. One bounded
// transaction copies source facts in SQL; subsequent keyset pages read only the
// immutable materialization, including after cancellation/retry or new postings.
function defaultExportMaterializer(client, job, options) {
  if (['restaurant_settlement', 'helper_earnings', 'business'].includes(job.product)) {
    return settlementStatements.materializeExportSource(client, job, options);
  }
  return statements.materializeExportSource(client, job, options);
}

async function freezeExportSource(db, job, { materialize = defaultExportMaterializer } = {}) {
  if (job.frozen_header) return job.frozen_header;
  const client = await db.connect();
  try {
    const deadline=Date.now()+120000;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL statement_timeout='120000ms'");
    await client.query("SET LOCAL lock_timeout='3000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='150000ms'");
    await client.query("SET LOCAL work_mem='8MB'");
    const { rows: [locked] } = await client.query(
      `SELECT * FROM statement_export_jobs WHERE id=$1 AND lease_owner=$2 AND fence=$3
       AND lease_until>now() AND NOT cancel_requested FOR UPDATE`, [job.id,job.lease_owner,job.fence]);
    if (!locked) throw new AppError('Export lease lost', 409, 'statement_export_lease_lost');
    if (locked.frozen_header) { await client.query('COMMIT'); return locked.frozen_header; }
    const boundedClient={query:async(...args)=>{
      const remaining=deadline-Date.now();
      if(remaining<=0)throw new AppError('Source freeze exceeded its time budget',503,'statement_export_freeze_timeout');
      await client.query(`SET LOCAL statement_timeout='${Math.max(1,remaining)}ms'`);
      return client.query(...args);
    }};
    const day=value=>value instanceof Date?value.toISOString().slice(0,10):String(value);
    const header = await materialize(boundedClient, {...locked,period_from:day(locked.period_from),period_to:day(locked.period_to)}, { maxRows:1000000 });
    await client.query(
      `UPDATE statement_export_jobs SET frozen_header=$4,frozen_at=$5,row_count=$6,
       state='rendering',lease_until=now()+interval '45 seconds',updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND fence=$3`,
      [job.id,job.lease_owner,job.fence,JSON.stringify(header),header.generatedAt,header.transactionCount]);
    await client.query('COMMIT');
    return header;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function readExportChunk(db, jobId, after = 0, limit = DEFAULT_CHUNK_SIZE) {
  if (!Number.isSafeInteger(Number(after)) || Number(after)<0 || !Number.isSafeInteger(limit) || limit<1 || limit>5000) {
    throw new AppError('Invalid export cursor', 400, 'statement_snapshot_invalid_chunk_size');
  }
  const { rows } = await db.query(
    `SELECT ordinal,row_data FROM statement_export_rows WHERE job_id=$1 AND ordinal>$2
     ORDER BY ordinal LIMIT $3`, [jobId,after,limit]);
  return rows.map(row=>({ordinal:Number(row.ordinal),...row.row_data}));
}

module.exports = {
  getFrozenDocument,
  freezeExportSource,
  readExportChunk,
  freezeSnapshot,
  verifySnapshot,
  getSnapshot,
  evidenceForDocument,
  parseIssuanceKey,
  SETTLEMENT_PRODUCTS,
  UUID_SCOPED_PRODUCTS,
  SNAPSHOT_SCHEMA_VERSION,
  DEFAULT_CHUNK_SIZE,
};
