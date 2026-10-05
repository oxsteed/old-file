import api from './axios';

export const MAX_STATEMENT_TRANSACTIONS = 5000;
export const STATEMENT_PAGE_SIZE = 50;

// All document requests use the signed-in customer's existing protected API.
// Restaurant wallets and OxSteed Credit deliberately have different endpoints.
export function creditStatementEndpoint(product, restaurantId) {
  if (product === 'oxsteed') return '/oxsteed-credit/documents';
  if (product === 'restaurant' && restaurantId != null && String(restaurantId).trim()) {
    return `/food/customer/wallets/${encodeURIComponent(String(restaurantId))}/statements`;
  }
  throw new Error('Invalid statement account');
}

function statementParams({ from, to, currencyCode, language }) {
  return { from, to, currencyCode, language };
}

export function getCreditStatement(product, restaurantId, params, { signal } = {}) {
  return api.get(creditStatementEndpoint(product, restaurantId), {
    params: statementParams(params), signal,
  }).then(response => response.data?.statement || null);
}

export function downloadCreditStatement(product, restaurantId, format, params, { signal } = {}) {
  if (!['pdf', 'csv'].includes(format)) throw new Error('Invalid statement format');
  return api.get(`${creditStatementEndpoint(product, restaurantId)}.${format}`, {
    params: statementParams(params), responseType: 'blob', signal,
  });
}

export function previousStatementMonth(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function validStatementPeriod(from, to, today = new Date().toISOString().slice(0, 10)) {
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return validDate(from) && validDate(to) && from >= '2000-01-01' && from <= to && to <= today
    && (Date.parse(to) - Date.parse(from)) / 86400000 + 1 <= 366;
}

// Reject incomplete/oversized reports rather than displaying silently truncated
// financial activity. The server is still responsible for ledger reconciliation.
export function isCompleteCreditStatement(statement, params, product) {
  const safeAmount = value => Number.isSafeInteger(value);
  const optionalText = value => value == null || typeof value === 'string';
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const validShape = Boolean(typeof statement?.id === 'string' && statement.id && ['monthly', 'interim'].includes(statement.kind)
    && (!product || statement.product === product)
    && statement.currencyCode === params.currencyCode
    && statement.period?.from === params.from && statement.period?.to === params.to
    && Array.isArray(statement.transactions) && Array.isArray(statement.holds)
    && Number.isSafeInteger(statement.transactionCount)
    && statement.transactionCount === statement.transactions.length
    && statement.transactions.length <= MAX_STATEMENT_TRANSACTIONS
    && ['openingBalanceCents', 'closingBalanceCents', 'totalCreditsCents', 'totalDebitsCents', 'totalHeldCents']
      .every(key => safeAmount(statement[key]))
    && ['ownerName', 'accountLabel', 'accountReference', 'contentHash'].every(key => optionalText(statement[key]))
    && statement.transactions.every(entry => typeof entry?.id === 'string' && entry.id && validDate(entry.date)
      && optionalText(entry.type) && optionalText(entry.description)
      && ['debitCents', 'creditCents', 'balanceAfterCents'].every(key => safeAmount(entry[key]))
      && entry.debitCents >= 0 && entry.creditCents >= 0 && !(entry.debitCents && entry.creditCents))
    && statement.holds.length <= MAX_STATEMENT_TRANSACTIONS
    && statement.holds.every(hold => typeof hold?.id === 'string' && hold.id && safeAmount(hold.amountCents) && hold.amountCents >= 0));
  if (!validShape || statement.totalCreditsCents < 0 || statement.totalDebitsCents < 0 || statement.totalHeldCents < 0) return false;
  let running = BigInt(statement.openingBalanceCents);
  let credits = 0n; let debits = 0n;
  for (const entry of statement.transactions) {
    credits += BigInt(entry.creditCents); debits += BigInt(entry.debitCents);
    running += BigInt(entry.creditCents) - BigInt(entry.debitCents);
    if (running !== BigInt(entry.balanceAfterCents)) return false;
  }
  return running === BigInt(statement.closingBalanceCents)
    && credits === BigInt(statement.totalCreditsCents) && debits === BigInt(statement.totalDebitsCents)
    && statement.holds.reduce((sum, hold) => sum + BigInt(hold.amountCents), 0n) === BigInt(statement.totalHeldCents)
    && (statement.kind !== 'monthly' || (!statement.holds.length && !statement.holdsAsOf && !statement.totalHeldCents));
}
