'use strict';

const crypto = require('crypto');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const MAX_ROWS = 5000;

function periodFor(from, to, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const previousEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const previousStart = new Date(Date.UTC(previousEnd.getUTCFullYear(), previousEnd.getUTCMonth(), 1));
  const parse = (value, fallback) => {
    const text = value === undefined ? fallback : value;
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)
        || Number.isNaN(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) {
      throw new AppError('Invalid statement date', 400, 'statement_invalid_period');
    }
    return text;
  };
  const start = parse(from, previousStart.toISOString().slice(0, 10));
  const end = parse(to, previousEnd.toISOString().slice(0, 10));
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days < 1 || days > 366 || end > today || start < '2000-01-01') {
    throw new AppError('Invalid statement period', 400, 'statement_invalid_period');
  }
  const startDate = new Date(start);
  const monthEnd = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { from: start, to: end, kind: start.endsWith('-01') && end === monthEnd && end < today ? 'monthly' : 'interim' };
}

function exactMoney(value) {
  // pg returns BIGINT as decimal text; do not round an unsafe JS number.
  if (!/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new AppError('Statement amount cannot be represented safely', 409, 'statement_integrity_failed');
  }
  return Number(value);
}

function hashDocument(document) {
  const stable = (value) => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
  const { contentHash, ...body } = document;
  return crypto.createHash('sha256').update(JSON.stringify(stable(body))).digest('hex');
}

function reconcileRows(rows, openingValue) {
  let running = BigInt(openingValue);
  let credits = 0n;
  let debits = 0n;
  const transactions = rows.map((row) => {
    const amount = BigInt(exactMoney(row.amount_cents));
    if (amount <= 0n) throw new AppError('Invalid ledger amount', 409, 'statement_integrity_failed');
    const debit = row.direction === 'debit';
    if (!debit && row.direction !== 'credit') throw new AppError('Invalid ledger direction', 409, 'statement_integrity_failed');
    running += debit ? -amount : amount;
    if (running !== BigInt(exactMoney(row.balance_after_cents))) {
      throw new AppError('Statement does not reconcile with the ledger', 409, 'statement_integrity_failed');
    }
    if (debit) debits += amount; else credits += amount;
    return {
      id: String(row.id), date: new Date(row.date).toISOString(),
      type: row.type === 'credit' ? 'load' : row.type === 'debit' ? 'purchase' : row.type,
      description: String(row.description || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 255),
      debitCents: debit ? Number(amount) : 0, creditCents: debit ? 0 : Number(amount),
      balanceAfterCents: exactMoney(running),
    };
  });
  return { transactions, closingBalanceCents: exactMoney(running), totalCreditsCents: exactMoney(credits), totalDebitsCents: exactMoney(debits) };
}

async function buildStatement(client, customerId, options) {
  const { product = 'oxsteed', restaurantId } = options;
  // Phase 4 (workstream 3): rederive skips the archived-document read and the
  // archive insert so the amendment workflow can rebuild an issued monthly
  // period from the current ledger. Default false: every existing caller keeps
  // the archived original.
  const rederive = options.rederive === true;
  if (!['oxsteed', 'restaurant'].includes(product)) throw new AppError('Unknown statement product', 400, 'statement_invalid_product');
  const currency = String(options.currencyCode || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || (product === 'restaurant' && !/^[1-9]\d*$/.test(String(restaurantId)))) {
    throw new AppError('Invalid statement account', 400, 'statement_invalid_account');
  }
  const { rows: [{ now }] } = await client.query('SELECT transaction_timestamp() AS now');
  const period = periodFor(options.from, options.to, new Date(now));
  const restaurant = product === 'restaurant';
  const { rows: [account] } = await client.query(restaurant
    ? `SELECT a.id, a.currency_code, a.created_at, COALESCE(NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),''),u.email) AS owner_name, r.display_name AS account_label
       FROM food_customer_wallet_accounts a JOIN users u ON u.id = a.customer_id
       JOIN food_restaurants r ON r.id = a.restaurant_id
       WHERE a.customer_id = $1 AND a.restaurant_id = $2 AND a.currency_code = $3`
    : `SELECT a.id, a.currency_code, a.created_at, COALESCE(NULLIF(TRIM(CONCAT_WS(' ',u.first_name,u.last_name)),''),u.email) AS owner_name, 'OxSteed Credit' AS account_label
       FROM oxsteed_credit_accounts a JOIN users u ON u.id = a.customer_id
       WHERE a.customer_id = $1 AND a.account_type = 'customer_wallet' AND a.currency_code = $2`,
  restaurant ? [customerId, restaurantId, currency] : [customerId, currency]);
  if (!account) throw new AppError('Statement account not found', 404, 'statement_account_not_found');
  if (period.to < new Date(account.created_at).toISOString().slice(0, 10)) {
    throw new AppError('Statement period precedes this account', 400, 'statement_before_account');
  }
  const archiveKey = [customerId, product, account.id, currency, period.from, period.to];
  if (period.kind === 'monthly' && !rederive) {
    const { rows: [saved] } = await client.query(
      `SELECT document, content_hash FROM credit_statement_documents
       WHERE customer_id=$1 AND product=$2 AND account_id=$3 AND currency_code=$4 AND period_from=$5 AND period_to=$6`, archiveKey);
    if (saved) {
      if (saved.document?.contentHash !== saved.content_hash || hashDocument(saved.document) !== saved.content_hash) {
        throw new AppError('Statement verification failed', 409, 'statement_integrity_failed');
      }
      return saved.document;
    }
  }
  // Explicit UTC boundaries, independent of the DB session's local time zone.
  const start = `${period.from}T00:00:00.000Z`;
  const end = new Date(Date.parse(period.to) + 86400000).toISOString();
  const dateExpression = restaurant ? 'e.created_at' : 'COALESCE(t.posted_at,t.created_at)';
  const ledger = restaurant ? 'food_customer_wallet_ledger e' : 'oxsteed_credit_transaction_entries e JOIN oxsteed_credit_transactions t ON t.id=e.transaction_id';
  const posted = restaurant ? '' : " AND t.status IN ('posted', 'reversed')";
  const sequence = restaurant ? 'e.entry_sequence' : 'e.sequence';
  const { rows: [opening] } = await client.query(
    `SELECT e.balance_after_cents FROM ${ledger} WHERE e.account_id=$1 AND ${restaurant ? 'e' : 't'}.currency_code=$2 AND ${dateExpression}<$3::timestamptz${posted}
     ORDER BY ${dateExpression} DESC, ${sequence} DESC NULLS LAST, e.id DESC LIMIT 1`,
    [account.id, currency, start]);
  const { rows } = await client.query(
    `SELECT ${restaurant ? 'e.entry_type' : 't.transaction_type'} AS type,
            ${restaurant ? 'e.id' : 't.id'} AS id, ${dateExpression} AS date,
            ${restaurant ? 'e.description' : 't.description'} AS description, e.amount_cents, e.balance_after_cents,
            ${restaurant ? "CASE WHEN e.entry_type='debit' THEN 'debit' ELSE 'credit' END" : 'e.entry_side'} AS direction
       FROM ${ledger} WHERE e.account_id=$1 AND ${restaurant ? 'e' : 't'}.currency_code=$2
       AND ${dateExpression}>=$3::timestamptz AND ${dateExpression}<$4::timestamptz AND ${dateExpression}<=$5::timestamptz${posted}
       ORDER BY ${dateExpression}, ${sequence} NULLS LAST, e.id LIMIT $6`,
    [account.id, currency, start, end, now, MAX_ROWS + 1]);
  if (rows.length > MAX_ROWS) throw new AppError('Narrow the period to export the complete statement', 409, 'statement_export_too_large');
  const openingBalanceCents = exactMoney(opening?.balance_after_cents || '0');
  const activity = reconcileRows(rows, openingBalanceCents);
  const { rows: [closing] } = await client.query(
    `SELECT e.balance_after_cents FROM ${ledger} WHERE e.account_id=$1 AND ${restaurant ? 'e' : 't'}.currency_code=$2
     AND ${dateExpression}<$3::timestamptz AND ${dateExpression}<=$4::timestamptz${posted}
     ORDER BY ${dateExpression} DESC, ${sequence} DESC NULLS LAST, e.id DESC LIMIT 1`,
    [account.id, currency, end, now]);
  if (activity.closingBalanceCents !== exactMoney(closing?.balance_after_cents || '0')) {
    throw new AppError('Statement closing balance does not reconcile', 409, 'statement_integrity_failed');
  }
  // Never substitute today's holds for historical period-end balances.
  const holds = period.kind === 'interim' ? (await client.query(
    `SELECT id, amount_cents, expires_at FROM ${restaurant ? 'food_customer_wallet_holds' : 'oxsteed_credit_holds'}
     WHERE account_id=$1 AND currency_code=$2 AND status='active' AND expires_at>$3::timestamptz
     ORDER BY created_at,id LIMIT $4`, [account.id, currency, now, MAX_ROWS + 1])).rows : [];
  if (holds.length > MAX_ROWS) throw new AppError('Too many pending holds to export completely', 409, 'statement_export_too_large');
  const document = {
    id: crypto.randomUUID(), version: 1, kind: period.kind, product,
    ownerName: account.owner_name, accountLabel: account.account_label,
    accountReference: `${restaurant ? 'RC' : 'OC'}-••••${String(account.id).slice(-4).padStart(4, '0')}`,
    currencyCode: currency, period: { from: period.from, to: period.to },
    generatedAt: new Date(now).toISOString(), openingBalanceCents, ...activity,
    transactionCount: rows.length,
    holds: holds.map((hold) => ({ id: String(hold.id), amountCents: exactMoney(hold.amount_cents), expiresAt: new Date(hold.expires_at).toISOString() })),
    holdsAsOf: period.kind === 'interim' ? new Date(now).toISOString() : null,
    totalHeldCents: exactMoney(holds.reduce((total, hold) => total + BigInt(hold.amount_cents), 0n)),
  };
  document.contentHash = hashDocument(document);
  if (period.kind === 'monthly' && !rederive) {
    await client.query(`INSERT INTO credit_statement_documents
      (id,customer_id,product,account_id,currency_code,period_from,period_to,generated_at,document,content_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [document.id, ...archiveKey, now, JSON.stringify(document), document.contentHash]);
  }
  return document;
}

async function getStatement(customerId, options = {}) {
  // Concurrent issuance retries from a fresh consistent snapshot. A statement
  // either includes all ledger changes visible here or none of them.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query("SET LOCAL statement_timeout = '15000ms'");
      const document = await buildStatement(client, customerId, options);
      await client.query('COMMIT');
      return document;
    } catch (err) {
      await client.query('ROLLBACK');
      if (['40001', '23505'].includes(err.code) && attempt < 2) continue;
      throw err;
    } finally { client.release(); }
  }
}

// Background exports materialize directly inside one bounded repeatable-read
// transaction. No complete document/ledger row array crosses the DB connection.
// The database orders null sequences last and retains entry identity (not just
// transaction identity) so multiple entries and sub-millisecond ties stay exact.
async function materializeExportSource(client, job, { maxRows = 1000000 } = {}) {
  const restaurant = job.product === 'restaurant';
  const settlement = job.product === 'restaurant_settlement';
  if (!['oxsteed', 'restaurant', 'restaurant_settlement'].includes(job.product)) {
    throw new AppError('This product needs a dated settlement source adapter', 409, 'statement_export_source_unavailable');
  }
  const currency = job.currency_code;
  const { rows: [{ now }] } = await client.query('SELECT transaction_timestamp() AS now');
  const period = periodFor(job.period_from, job.period_to, new Date(now));
  const { rows: [account] } = await client.query(restaurant
    ? `SELECT a.id,a.created_at,u.first_name AS owner_name,r.display_name AS account_label
       FROM food_customer_wallet_accounts a JOIN users u ON u.id=a.customer_id
       JOIN food_restaurants r ON r.id=a.restaurant_id
       WHERE a.id=$1 AND a.customer_id=$2 AND a.currency_code=$3`
    : settlement
      ? `SELECT a.id,a.created_at,r.display_name AS owner_name,r.display_name AS account_label
         FROM oxsteed_credit_accounts a JOIN food_restaurants r ON r.id=a.restaurant_id
         WHERE a.id=$1 AND a.account_type='restaurant_sub_bank' AND a.currency_code=$3 AND $2::uuid IS NOT NULL`
      : `SELECT a.id,a.created_at,u.first_name AS owner_name,'OxSteed Credit' AS account_label
         FROM oxsteed_credit_accounts a JOIN users u ON u.id=a.customer_id
         WHERE a.id=$1 AND a.customer_id=$2 AND a.account_type='customer_wallet' AND a.currency_code=$3`,
  [job.account_id, job.requested_by, currency]);
  if (!account) throw new AppError('Statement account not found', 404, 'statement_account_not_found');
  if (period.to < new Date(account.created_at).toISOString().slice(0, 10)) {
    throw new AppError('Statement period precedes this account', 400, 'statement_before_account');
  }
  const date = restaurant ? 'e.created_at' : 'COALESCE(t.posted_at,t.created_at)';
  const seq = restaurant ? 'e.entry_sequence' : 'e.sequence';
  const ledger = restaurant ? 'food_customer_wallet_ledger e'
    : 'oxsteed_credit_transaction_entries e JOIN oxsteed_credit_transactions t ON t.id=e.transaction_id';
  const scope = `e.account_id=$1 AND ${restaurant ? 'e' : 't'}.currency_code=$2${restaurant ? '' : " AND t.status IN ('posted','reversed')"}`;
  const start = `${period.from}T00:00:00.000Z`;
  const end = new Date(Date.parse(period.to) + 86400000).toISOString();
  const { rows: [opening] } = await client.query(
    `SELECT e.balance_after_cents FROM ${ledger} WHERE ${scope} AND ${date}<$3::timestamptz AND ${date}<=$4::timestamptz
     ORDER BY ${date} DESC,${seq} DESC NULLS FIRST,e.id DESC LIMIT 1`, [account.id,currency,start,now]);
  const { rows: [closing] } = await client.query(
    `SELECT e.balance_after_cents FROM ${ledger} WHERE ${scope} AND ${date}<$3::timestamptz AND ${date}<=$4::timestamptz
     ORDER BY ${date} DESC,${seq} DESC NULLS FIRST,e.id DESC LIMIT 1`, [account.id,currency,end,now]);
  const openingMinor = String(exactMoney(opening?.balance_after_cents || '0'));
  const closingMinor = String(exactMoney(closing?.balance_after_cents || '0'));
  const side = restaurant ? "CASE WHEN e.entry_type='debit' THEN 'debit' ELSE 'credit' END" : 'e.entry_side';
  const { rows: [count] } = await client.query(
    `SELECT count(*)::bigint AS count FROM ${ledger} WHERE ${scope}
     AND ${date}>=$3::timestamptz AND ${date}<$4::timestamptz AND ${date}<=$5::timestamptz`,
    [account.id,currency,start,end,now]);
  if (BigInt(count.count) > BigInt(maxRows)) throw new AppError('Export exceeds the approved resource budget', 409, 'statement_export_budget_exceeded');
  await client.query(
    `INSERT INTO statement_export_rows (job_id,ordinal,source_id,source_date,source_sequence,row_data,credit_minor,debit_minor,balance_minor)
     SELECT $6,row_number() OVER (ORDER BY ${date},${seq} NULLS LAST,e.id),e.id::text,${date},${seq},
       jsonb_build_object('id',e.id::text,'transactionId',${restaurant ? 'e.id' : 't.id'}::text,
         'date',${date},'type',${restaurant ? 'e.entry_type' : 't.transaction_type'},
         'description',left(regexp_replace(COALESCE(${restaurant ? 'e.description' : 't.description'},''),'[[:cntrl:]]',' ','g'),255),
         'creditCents',CASE WHEN (${side})='credit' THEN e.amount_cents ELSE 0 END::text,
         'debitCents',CASE WHEN (${side})='debit' THEN e.amount_cents ELSE 0 END::text,
         'balanceAfterCents',e.balance_after_cents::text),
       CASE WHEN (${side})='credit' THEN e.amount_cents ELSE 0 END,
       CASE WHEN (${side})='debit' THEN e.amount_cents ELSE 0 END,e.balance_after_cents
     FROM ${ledger} WHERE ${scope} AND ${date}>=$3::timestamptz AND ${date}<$4::timestamptz AND ${date}<=$5::timestamptz`,
    [account.id,currency,start,end,now,job.id]);
  const { rows: [totals] } = await client.query(
    `SELECT count(*)::bigint AS count,COALESCE(sum(credit_minor),0)::text AS credits,
      COALESCE(sum(debit_minor),0)::text AS debits,
      COALESCE(sum(pg_column_size(row_data)),0)::bigint AS source_bytes,
      COALESCE(bool_and(balance_minor=running AND credit_minor>=0 AND debit_minor>=0
        AND (credit_minor>0 OR debit_minor>0) AND NOT (credit_minor>0 AND debit_minor>0)),true) AS valid
     FROM (SELECT *, $2::numeric+sum(credit_minor-debit_minor) OVER (ORDER BY ordinal) AS running
       FROM statement_export_rows WHERE job_id=$1) frozen`, [job.id,openingMinor]);
  if (BigInt(totals.source_bytes)>512n*1024n*1024n) throw new AppError('Frozen source exceeds the approved byte budget',409,'statement_export_budget_exceeded');
  if (!totals.valid || String(totals.count)!==String(count.count)
      || BigInt(openingMinor)+BigInt(totals.credits)-BigInt(totals.debits)!==BigInt(closingMinor)) {
    throw new AppError('Statement export source does not reconcile', 409, 'statement_integrity_failed');
  }
  exactMoney(totals.credits); exactMoney(totals.debits);
  return { contract:'statement-export-source-v1',product:job.product,currencyCode:currency,
    period:{from:period.from,to:period.to},kind:period.kind,generatedAt:new Date(now).toISOString(),
    ownerName:account.owner_name||'',accountLabel:account.account_label||'',
    accountReference:`${restaurant?'RC':settlement?'RS':'OC'}-••••${String(account.id).slice(-4).padStart(4,'0')}`,
    openingBalanceCents:openingMinor,closingBalanceCents:closingMinor,totalCreditsCents:totals.credits,
    totalDebitsCents:totals.debits,transactionCount:Number(totals.count),holdsAsOf:null,holds:[],totalHeldCents:0,
    holdsUnavailable:true };
}

module.exports = { getStatement, periodFor, reconcileRows, exactMoney, hashDocument, MAX_ROWS, materializeExportSource };
