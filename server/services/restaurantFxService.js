'use strict';

// Phase 8 Track A — FX policy + converted rollups (baseline gap 18).
//
// Rates are stored data, never a live feed and never invented: an
// admin enters them (or they are imported) and conversion uses the
// stored rate as of a stated date. A missing rate fails closed — the
// caller gets `missingRate: true` and shows native-currency detail
// only, with the gap flagged — instead of guessing a rate.
//
// Convention, stated on every converted figure: one unit of
// base_currency buys `rate` units of quote_currency, so
// amount_quote = amount_base * rate. Amounts are integer minor
// units, but the rate is major-to-major, so the conversion goes
// through major units on both sides using each currency's own
// minor-unit exponent (JPY 0, BHD 3, most 2): converting minor
// units directly would be off by 100x for JPY and 1000x for BHD.
// Same-currency conversion is exactly 1 and needs no stored row.
//
// Policy default (product decision still owed from Emile — see the
// Phase 8 report): reporting currency = the restaurant's primary
// location currency (falling back to the restaurant currency);
// rate date = the period end; rate source = any stored rate. A
// stored policy row (restaurant-level for HQ rollups, brand-level
// for brand rollups) wins over the default.

const AppError = require('../utils/appError');
const { minorUnitDecimals } = require('../utils/currencyPrecision');

const CURRENCY_RE = /^[A-Z]{3}$/;
const RATE_SOURCES = ['stored', 'admin_entered', 'import'];
const RATE_DATE_MODES = ['period_end', 'rate_date'];

function normalizeCurrencyCode(value, field = 'currency') {
  const code = String(value || '').trim().toUpperCase();
  if (!CURRENCY_RE.test(code)) {
    throw new AppError(`A valid 3-letter ${field} code is required`, 400, 'validation_failed');
  }
  return code;
}

function normalizeRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new AppError('A rate greater than zero is required', 400, 'validation_failed');
  }
  return rate;
}

function normalizeRateDate(value) {
  const text = toDateOnly(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new AppError('A valid rate date (YYYY-MM-DD) is required', 400, 'validation_failed');
  }
  return text;
}

// pg returns DATE columns as JS Date objects; String(date) gives
// "Thu Oct 01 ..." so a plain slice would corrupt the date.
function toDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function normalizeRateSource(value) {
  const source = String(value || 'stored').trim().toLowerCase();
  if (!RATE_SOURCES.includes(source)) {
    throw new AppError('Unknown rate source', 400, 'validation_failed');
  }
  return source;
}

// Default policy for a restaurant: primary location currency, then
// the restaurant currency, then USD as a last resort (a restaurant
// with no location and no currency still needs a reporting
// currency to render; the default flag says so plainly).
async function defaultReportingCurrency(client, restaurantId) {
  if (restaurantId != null) {
    const { rows: [row] } = await client.query(
      `SELECT l.currency_code AS location_currency, fr.currency_code AS restaurant_currency
         FROM food_restaurants fr
         LEFT JOIN restaurant_locations l
           ON l.restaurant_id = fr.id AND l.is_primary = TRUE
        WHERE fr.id = $1
        LIMIT 1`,
      [restaurantId]
    );
    if (row) return (row.location_currency || row.restaurant_currency || 'USD').toUpperCase();
  }
  return 'USD';
}

async function getFxPolicy(client, { restaurantId = null, brandId = null } = {}) {
  let row = null;
  if (brandId != null) {
    const { rows } = await client.query(
      `SELECT * FROM restaurant_fx_policies WHERE brand_id = $1 LIMIT 1`,
      [brandId]
    );
    row = rows[0] || null;
  } else if (restaurantId != null) {
    const { rows } = await client.query(
      `SELECT * FROM restaurant_fx_policies WHERE restaurant_id = $1 LIMIT 1`,
      [restaurantId]
    );
    row = rows[0] || null;
  }
  if (row) {
    // A stored row is validated on read, not just on write: a corrupt
    // row must fail closed here (callers degrade to native-only
    // totals) instead of flowing an undefined currency into a
    // conversion that throws mid-rollup.
    const mode = String(row.rate_date_mode || 'period_end').trim().toLowerCase();
    if (!RATE_DATE_MODES.includes(mode)) throw new AppError('Unknown rate date mode', 400, 'validation_failed');
    return {
      reportingCurrency: normalizeCurrencyCode(row.reporting_currency, 'reporting currency'),
      rateSource: normalizeRateSource(row.rate_source),
      rateDateMode: mode,
      rateDate: row.rate_date ? toDateOnly(row.rate_date) : null,
      isDefault: false,
      updatedAt: row.updated_at,
    };
  }
  return {
    reportingCurrency: await defaultReportingCurrency(client, restaurantId),
    rateSource: 'stored',
    rateDateMode: 'period_end',
    rateDate: null,
    isDefault: true,
    updatedAt: null,
  };
}

// Resolve the rate date a report actually converts as of: a fixed
// policy date wins, otherwise the period end the caller passes.
function resolveRateDate(policy, periodEnd) {
  if (policy.rateDateMode === 'rate_date' && policy.rateDate) return policy.rateDate;
  return normalizeRateDate(periodEnd);
}

async function setFxPolicy(client, { restaurantId = null, brandId = null, reportingCurrency, rateSource = 'stored', rateDateMode = 'period_end', rateDate = null, actorUserId = null }) {
  const currency = normalizeCurrencyCode(reportingCurrency, 'reporting currency');
  const source = normalizeRateSource(rateSource);
  const mode = String(rateDateMode || 'period_end').trim().toLowerCase();
  if (!RATE_DATE_MODES.includes(mode)) throw new AppError('Unknown rate date mode', 400, 'validation_failed');
  const fixedDate = mode === 'rate_date' ? normalizeRateDate(rateDate) : null;
  if (restaurantId != null && brandId != null) {
    throw new AppError('A policy belongs to one restaurant or one brand, not both', 400, 'validation_failed');
  }
  if (restaurantId == null && brandId == null) {
    throw new AppError('A policy needs a restaurant or a brand', 400, 'validation_failed');
  }
  const keyColumn = restaurantId != null ? 'restaurant_id' : 'brand_id';
  const keyValue = restaurantId != null ? restaurantId : brandId;
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_fx_policies
       (restaurant_id, brand_id, reporting_currency, rate_source, rate_date_mode, rate_date, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (${keyColumn}) WHERE ${keyColumn} IS NOT NULL DO UPDATE
       SET reporting_currency = EXCLUDED.reporting_currency,
           rate_source = EXCLUDED.rate_source,
           rate_date_mode = EXCLUDED.rate_date_mode,
           rate_date = EXCLUDED.rate_date,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
     RETURNING *`,
    [
      restaurantId != null ? restaurantId : null,
      brandId != null ? brandId : null,
      currency, source, mode, fixedDate, actorUserId || null,
    ]
  );
  return {
    reportingCurrency: row.reporting_currency,
    rateSource: row.rate_source,
    rateDateMode: row.rate_date_mode,
    rateDate: row.rate_date ? toDateOnly(row.rate_date) : null,
    isDefault: false,
    updatedAt: row.updated_at,
  };
}

// The stored rate in force for a pair as of a date: the latest rate
// dated on or before that date (a rate dated after the period cannot
// price it). Returns null when no stored rate covers the pair — the
// caller must fail closed, never substitute another pair or date.
async function getRate(client, { baseCurrency, quoteCurrency, rateDate, rateSource = 'stored' }) {
  const base = normalizeCurrencyCode(baseCurrency, 'base currency');
  const quote = normalizeCurrencyCode(quoteCurrency, 'quote currency');
  const date = normalizeRateDate(rateDate);
  const source = normalizeRateSource(rateSource);
  if (base === quote) {
    return { baseCurrency: base, quoteCurrency: quote, rate: 1, rateDate: date, source: 'same_currency', stored: false };
  }
  const params = [base, quote, date];
  let sourceFilter = '';
  if (source !== 'stored') {
    sourceFilter = ' AND source = $4';
    params.push(source);
  }
  const { rows: [row] } = await client.query(
    `SELECT base_currency, quote_currency, rate, rate_date, source
       FROM restaurant_fx_rates
      WHERE base_currency = $1 AND quote_currency = $2
        AND rate_date <= $3::date${sourceFilter}
      ORDER BY rate_date DESC, id DESC
      LIMIT 1`,
    params
  );
  if (!row) return null;
  return {
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: Number(row.rate),
    rateDate: toDateOnly(row.rate_date),
    source: row.source,
    stored: true,
  };
}

// Convert one integer minor-unit amount. Returns the converted
// amount with its provenance, or { missingRate: true } when no
// stored rate covers the pair as of the date.
async function convertAmount(client, { amountCents, fromCurrency, toCurrency, rateDate, rateSource = 'stored' }) {
  const amount = Math.round(Number(amountCents));
  if (!Number.isSafeInteger(amount)) {
    throw new AppError('An integer amount in minor units is required', 400, 'validation_failed');
  }
  const rate = await getRate(client, { baseCurrency: fromCurrency, quoteCurrency: toCurrency, rateDate, rateSource });
  if (!rate) {
    return {
      missingRate: true,
      fromCurrency: normalizeCurrencyCode(fromCurrency, 'source currency'),
      toCurrency: normalizeCurrencyCode(toCurrency, 'reporting currency'),
      rateDate: normalizeRateDate(rateDate),
    };
  }
  // The rate is major-to-major while the amount is integer minor
  // units, so convert through major units on both sides: divide by
  // the source currency's minor units per major, multiply by the
  // rate, then multiply by the target currency's minor units per
  // major and round to the nearest target minor unit.
  const fromDecimals = minorUnitDecimals(rate.baseCurrency);
  const toDecimals = minorUnitDecimals(rate.quoteCurrency);
  const convertedCents = Math.round(
    (amount / 10 ** fromDecimals) * rate.rate * 10 ** toDecimals
  );
  return {
    missingRate: false,
    fromCurrency: rate.baseCurrency,
    toCurrency: rate.quoteCurrency,
    convertedCents,
    amountCents: amount,
    rate: rate.rate,
    rateDate: rate.rateDate,
    rateSource: rate.source,
  };
}

// Convert a per-currency breakdown (e.g. sales grouped by currency)
// into one reporting currency. Native detail is always preserved
// line by line; the converted total is null when any currency lacks
// a rate, and the missing currencies are named — the caller shows
// native detail only for those lines.
async function convertBreakdown(client, { entries, reportingCurrency, rateDate, rateSource = 'stored' }) {
  const reporting = normalizeCurrencyCode(reportingCurrency, 'reporting currency');
  const date = normalizeRateDate(rateDate);
  const source = normalizeRateSource(rateSource);
  const lines = [];
  const missing = [];
  let convertedTotalCents = 0;
  for (const entry of entries || []) {
    const currencyCode = normalizeCurrencyCode(entry.currencyCode || entry.currency_code, 'entry currency');
    const amountCents = Math.round(Number(entry.amountCents ?? entry.net_collected_cents ?? entry.netCollectedCents ?? 0));
    const converted = await convertAmount(client, {
      amountCents, fromCurrency: currencyCode, toCurrency: reporting, rateDate: date, rateSource: source,
    });
    if (converted.missingRate) {
      missing.push(currencyCode);
      lines.push({ currencyCode, amountCents, convertedCents: null, rate: null, rateDate: date, rateSource: source, missingRate: true });
    } else {
      convertedTotalCents += converted.convertedCents;
      lines.push({
        currencyCode,
        amountCents,
        convertedCents: converted.convertedCents,
        rate: converted.rate,
        rateDate: converted.rateDate,
        rateSource: converted.rateSource,
        missingRate: false,
      });
    }
  }
  return {
    reportingCurrency: reporting,
    rateDate: date,
    rateSource: source,
    lines,
    missingCurrencies: [...new Set(missing)],
    convertedTotalCents: missing.length ? null : convertedTotalCents,
  };
}

async function listRates(client, { baseCurrency = null, quoteCurrency = null, limit = 100 } = {}) {
  const params = [];
  const where = [];
  if (baseCurrency != null) {
    params.push(normalizeCurrencyCode(baseCurrency, 'base currency'));
    where.push(`base_currency = $${params.length}`);
  }
  if (quoteCurrency != null) {
    params.push(normalizeCurrencyCode(quoteCurrency, 'quote currency'));
    where.push(`quote_currency = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const { rows } = await client.query(
    `SELECT id, base_currency, quote_currency, rate, rate_date, source, created_by, created_at
       FROM restaurant_fx_rates
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY rate_date DESC, id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => ({
    id: Number(row.id),
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: Number(row.rate),
    rateDate: toDateOnly(row.rate_date),
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

async function createRate(client, { baseCurrency, quoteCurrency, rate, rateDate, source = 'admin_entered', actorUserId = null }) {
  const base = normalizeCurrencyCode(baseCurrency, 'base currency');
  const quote = normalizeCurrencyCode(quoteCurrency, 'quote currency');
  if (base === quote) throw new AppError('Base and quote currencies must differ', 400, 'validation_failed');
  const value = normalizeRate(rate);
  const date = normalizeRateDate(rateDate);
  const storedSource = String(source || 'admin_entered').trim().toLowerCase();
  if (!['admin_entered', 'import'].includes(storedSource)) {
    throw new AppError('A stored rate source is admin_entered or import', 400, 'validation_failed');
  }
  const { rows: [row] } = await client.query(
    `INSERT INTO restaurant_fx_rates
       (base_currency, quote_currency, rate, rate_date, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (base_currency, quote_currency, rate_date) DO UPDATE
       SET rate = EXCLUDED.rate, source = EXCLUDED.source, created_by = EXCLUDED.created_by
     RETURNING id, base_currency, quote_currency, rate, rate_date, source, created_by, created_at`,
    [base, quote, value, date, storedSource, actorUserId || null]
  );
  return {
    id: Number(row.id),
    baseCurrency: row.base_currency,
    quoteCurrency: row.quote_currency,
    rate: Number(row.rate),
    rateDate: toDateOnly(row.rate_date),
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

module.exports = {
  normalizeCurrencyCode,
  normalizeRate,
  normalizeRateDate,
  normalizeRateSource,
  getFxPolicy,
  resolveRateDate,
  setFxPolicy,
  getRate,
  convertAmount,
  convertBreakdown,
  listRates,
  createRate,
};
