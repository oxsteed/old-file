'use strict';

// OFX 2.2 (SGML) generation from statement documents. Pure functions: no DB,
// no network. QFX and QBO are OFX variants, so all three formats map to this
// generator with different file extensions, MIME types, and Intuit markers.
//
// Money contract: amounts arrive as integer minor units in strings
// (the ledger's exactMoney cents contract, x100). Positive TRNAMT is money
// into the account (credit), negative is money out (debit). A statement
// document is always single-currency; mixing currencies in one file is
// refused rather than guessed.

const crypto = require('node:crypto');
const AppError = require('../utils/appError');

const VARIANTS = {
  ofx: { extension: 'ofx', mediaType: 'application/x-ofx', intuBid: null },
  qfx: { extension: 'qfx', mediaType: 'application/x-ofx', intuBid: 'OXSTEED' },
  qbo: { extension: 'qbo', mediaType: 'application/vnd.intu.qbo', intuBid: 'OXSTEED' },
};

const fail = (code, status = 400) => { throw new AppError(code, status, code); };

function parseMinor(value, label) {
  if (typeof value === 'bigint') return value;
  if (!/^-?\d+$/.test(String(value ?? ''))) fail(`statement_ofx_invalid_${label}`, 409);
  return BigInt(String(value));
}

// Minor units (x100) to a signed 2-decimal OFX amount: "-1234.56".
function formatAmount(minor) {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// OFX SGML datetime: YYYYMMDDHHMMSS in UTC. OFX treats a bare 14-digit stamp
// as local time; emitting UTC keeps every importer on the same instant.
function ofxDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) fail('statement_ofx_invalid_date', 409);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function ofxDate(isoDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDay || ''))) fail('statement_ofx_invalid_period', 409);
  return String(isoDay).replace(/-/g, '');
}

function escapeSgml(value) {
  return String(value ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 255);
}

function cleanText(value, max = 255) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
}

// Normalize the five statement document shapes to one OFX-ready structure.
// Every branch keeps the document's own authoritative opening/closing so the
// LEDGERBAL always matches the statement the user already saw.
function normalizeDocument(document) {
  if (!document || typeof document !== 'object') fail('statement_ofx_invalid_document', 409);
  const currency = String(document.currencyCode || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('statement_ofx_invalid_currency', 409);
  const base = {
    accountLabel: cleanText(document.accountLabel || document.product || 'Statement', 96),
    accountReference: cleanText(document.accountReference || document.id || 'unknown', 64),
    currency,
    periodFrom: document.period?.from,
    periodTo: document.period?.to,
    generatedAt: document.generatedAt || new Date().toISOString(),
    product: String(document.product || 'unknown'),
  };
  const product = base.product;
  if (['oxsteed', 'restaurant', 'restaurant_settlement'].includes(product)) {
    const transactions = Array.isArray(document.transactions) ? document.transactions : [];
    return {
      ...base,
      openingCents: parseMinor(document.openingBalanceCents, 'opening_balance'),
      closingCents: parseMinor(document.closingBalanceCents, 'closing_balance'),
      transactions: transactions.map((tx, index) => {
        if (!tx || tx.id === undefined || tx.id === null || !tx.date) fail('statement_ofx_invalid_transaction', 409);
        const amount = parseMinor(tx.creditCents ?? 0, 'amount')
          - parseMinor(tx.debitCents ?? 0, 'amount');
        return {
          fitId: `${document.id || 'stmt'}:${String(tx.id)}:${index}`,
          date: tx.date,
          memo: cleanText(tx.description || tx.type || 'Statement entry'),
          amountCents: amount,
        };
      }),
    };
  }
  if (product === 'helper_earnings') {
    const movements = Array.isArray(document.movements) ? document.movements : [];
    return {
      ...base,
      openingCents: parseMinor(document.openingPayableCents, 'opening_balance'),
      closingCents: parseMinor(document.closingPayableCents, 'closing_balance'),
      transactions: movements.map((move, index) => {
        if (!move || !move.recordedAt) fail('statement_ofx_invalid_transaction', 409);
        const amount = parseMinor(move.postedEarningsCents ?? 0, 'amount')
          - parseMinor(move.settledPayoutsCents ?? 0, 'amount')
          - parseMinor(move.statusRemovalsCents ?? 0, 'amount');
        return {
          fitId: `${document.id || 'stmt'}:${String(move.sourceHistoryId || move.sourceId || index)}:${index}`,
          date: move.recordedAt,
          memo: cleanText(move.title ? `${move.title} (${move.jobId || ''})`.trim() : `Helper earnings movement ${move.sourceId || ''}`),
          amountCents: amount,
        };
      }),
    };
  }
  if (product === 'business') {
    const movements = Array.isArray(document.receivables?.movements) ? document.receivables.movements : [];
    return {
      ...base,
      openingCents: parseMinor(document.receivables.openingOutstandingCents, 'opening_balance'),
      closingCents: parseMinor(document.receivables.closingOutstandingCents, 'closing_balance'),
      transactions: movements.map((move, index) => {
        if (!move || !move.recordedAt) fail('statement_ofx_invalid_transaction', 409);
        const amount = parseMinor(move.invoicedCents ?? 0, 'amount')
          - parseMinor(move.collectedOrAdjustedCents ?? 0, 'amount')
          - parseMinor(move.cancelledCents ?? 0, 'amount');
        return {
          fitId: `${document.id || 'stmt'}:${String(move.sourceHistoryId || move.sourceId || index)}:${index}`,
          date: move.recordedAt,
          memo: cleanText(`Invoice movement ${move.sourceId || ''}`.trim()),
          amountCents: amount,
        };
      }),
    };
  }
  fail('statement_ofx_unsupported_product', 409);
}

function buildOfx(document, { variant = 'ofx', fileUid = crypto.randomUUID(), dtServer = new Date().toISOString() } = {}) {
  const spec = VARIANTS[variant];
  if (!spec) fail('statement_ofx_invalid_variant', 400);
  const normalized = normalizeDocument(document);

  const seen = new Set();
  const transactions = [];
  let skipped = 0;
  for (const tx of normalized.transactions) {
    if (seen.has(tx.fitId)) fail('statement_ofx_duplicate_fitid', 409);
    seen.add(tx.fitId);
    if (tx.amountCents === 0n) { skipped += 1; continue; } // No money moved; OFX gains nothing.
    transactions.push(tx);
  }

  const dtStart = ofxDate(normalized.periodFrom);
  const dtEnd = ofxDate(normalized.periodTo);
  const dtPosted = (iso) => ofxDateTime(iso);
  const lines = [];
  lines.push('OFXHEADER:100');
  lines.push('DATA:OFXSGML');
  lines.push('VERSION:220');
  lines.push('SECURITY:NONE');
  lines.push('ENCODING:UTF-8');
  lines.push('CHARSET:NONE');
  lines.push('COMPRESSION:NONE');
  lines.push('OLDFILEUID:NONE');
  lines.push(`NEWFILEUID:${fileUid}`);
  lines.push('');
  lines.push('<OFX>');
  lines.push('<SIGNONMSGSRSV1>');
  lines.push('<SONRS>');
  lines.push('<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY><MESSAGE>OK</MESSAGE></STATUS>');
  lines.push(`<DTSERVER>${ofxDateTime(dtServer)}</DTSERVER>`);
  lines.push('<LANGUAGE>ENG</LANGUAGE>');
  lines.push('<FI><ORG>OxSteed</ORG><FID>OXSTEED</FID></FI>');
  if (spec.intuBid) lines.push(`<INTU.BID>${spec.intuBid}</INTU.BID>`);
  lines.push('</SONRS>');
  lines.push('</SIGNONMSGSRSV1>');
  lines.push('<BANKMSGSRSV1>');
  lines.push('<STMTTRNRS>');
  lines.push(`<TRNUID>${fileUid}</TRNUID>`);
  lines.push('<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY><MESSAGE>OK</MESSAGE></STATUS>');
  lines.push('<STMTRS>');
  lines.push(`<CURDEF>${normalized.currency}</CURDEF>`);
  lines.push('<BANKACCTFROM>');
  lines.push('<BANKID>OXSTEED</BANKID>');
  lines.push(`<ACCTID>${escapeSgml(normalized.accountReference)}</ACCTID>`);
  lines.push('<ACCTTYPE>CHECKING</ACCTTYPE>');
  lines.push('</BANKACCTFROM>');
  lines.push('<BANKTRANLIST>');
  lines.push(`<DTSTART>${dtStart}</DTSTART>`);
  lines.push(`<DTEND>${dtEnd}</DTEND>`);
  for (const tx of transactions) {
    lines.push('<STMTTRN>');
    lines.push(`<TRNTYPE>${tx.amountCents > 0n ? 'CREDIT' : 'DEBIT'}</TRNTYPE>`);
    lines.push(`<DTPOSTED>${dtPosted(tx.date)}</DTPOSTED>`);
    lines.push(`<TRNAMT>${formatAmount(tx.amountCents)}</TRNAMT>`);
    lines.push(`<FITID>${escapeSgml(tx.fitId)}</FITID>`);
    lines.push(`<MEMO>${escapeSgml(tx.memo)}</MEMO>`);
    lines.push('</STMTTRN>');
  }
  lines.push('</BANKTRANLIST>');
  lines.push('<LEDGERBAL>');
  lines.push(`<BALAMT>${formatAmount(normalized.closingCents)}</BALAMT>`);
  lines.push(`<DTASOF>${ofxDateTime(normalized.generatedAt)}</DTASOF>`);
  lines.push('</LEDGERBAL>');
  lines.push(`<MKTGINFO>${escapeSgml(`${normalized.accountLabel} ${normalized.periodFrom} to ${normalized.periodTo}`)}</MKTGINFO>`);
  lines.push('</STMTRS>');
  lines.push('</STMTTRNRS>');
  lines.push('</BANKMSGSRSV1>');
  lines.push('</OFX>');

  const safePeriod = `${normalized.periodFrom}_${normalized.periodTo}`.replace(/[^0-9A-Za-z_-]/g, '-');
  return {
    content: lines.join('\r\n'),
    filename: `statement-${normalized.product}-${safePeriod}.${spec.extension}`,
    mediaType: spec.mediaType,
    variant,
    currency: normalized.currency,
    transactionCount: transactions.length,
    skippedZeroAmount: skipped,
  };
}

module.exports = { buildOfx, normalizeDocument, formatAmount, ofxDateTime, VARIANTS };
