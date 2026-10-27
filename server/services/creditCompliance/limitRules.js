'use strict';

/**
 * Currency-aware, per-country OxSteed Credit limits stored as data
 * (licence readiness: review bug 3, §3, §6; migration 20261027110200).
 *
 * resolveLimit(key, { currency, country, tier }) returns the limit in the
 * requested currency's minor units. Most specific rule wins:
 *   country+tier > country > currency+tier > currency > default+tier >
 *   default > CODE_DEFAULTS (historical env value, USD cents).
 * A rule stored in another currency is translated through
 * credit_limit_reference_rates (limit sizing only, never pricing). A
 * currency with no rule and no reference rate fails closed (503
 * credit_limit_unavailable): an unknown limit is never "unlimited".
 *
 * Rules live in a per-process snapshot that boot warms (warmLimitRules)
 * and a timer refreshes every REFRESH_MS, so the money paths resolve limits
 * synchronously without an extra query inside their transactions. A
 * snapshot older than STALE_MS (refresh failing) fails closed in
 * production. Before the first load, test/dev processes use the built-in
 * seed (same values as the migration); production refuses (503).
 */

const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');

const REFRESH_MS = 60_000;
const STALE_MS = 15 * 60_000;

// Mirror of the migration seed (credit_limit_reference_rates). Used only
// before the first DB snapshot in non-production processes.
const SEED_REFERENCE_RATES = Object.freeze({
  USD: '1', AED: '3.6725', AUD: '1.52', BRL: '5.40', CAD: '1.39', CHF: '0.80', CNY: '7.10',
  CZK: '21.0', DOP: '63.0', EGP: '48.0', EUR: '0.86', GBP: '0.75', HKD: '7.78', HTG: '130.65',
  HUF: '335', ILS: '3.30', INR: '88.0', MAD: '9.20', MXN: '18.4', NGN: '1460', NOK: '10.1',
  NZD: '1.74', PHP: '58.0', PLN: '3.65', RON: '4.37', SAR: '3.75', SEK: '9.50', SGD: '1.30',
  THB: '32.5', TRY: '42.0', ZAR: '17.3', BHD: '0.376', IQD: '1310', JOD: '0.709', KWD: '0.306',
  LYD: '5.45', OMR: '0.3845', TND: '2.95', CLP: '950', ISK: '123', JPY: '152', KRW: '1430',
  PYG: '7100', UGX: '3450', VND: '26300', VUV: '120', XAF: '563', XOF: '563', XPF: '102.6', KES: '129',
});

// Mirror of the migration's seeded default rules.
const SEED_RULES = Object.freeze([
  { scope: 'default', scopeCode: '*', tier: null, key: 'aml_structuring_threshold', amountMinor: 200000, currency: 'USD', id: null },
  { scope: 'country', scopeCode: 'US', tier: null, key: 'aml_structuring_threshold', amountMinor: 200000, currency: 'USD', id: null },
  { scope: 'default', scopeCode: '*', tier: 0, key: 'kyc_balance_max', amountMinor: 50000, currency: 'USD', id: null },
  { scope: 'default', scopeCode: '*', tier: 1, key: 'kyc_balance_max', amountMinor: 300000, currency: 'USD', id: null },
  { scope: 'default', scopeCode: '*', tier: 2, key: 'kyc_balance_max', amountMinor: 1000000, currency: 'USD', id: null },
  { scope: 'default', scopeCode: '*', tier: 0, key: 'kyc_monthly_inflow_max', amountMinor: 100000, currency: 'USD', id: null },
  { scope: 'default', scopeCode: '*', tier: 1, key: 'kyc_monthly_inflow_max', amountMinor: 500000, currency: 'USD', id: null },
  { scope: 'default', scopeCode: '*', tier: 2, key: 'kyc_monthly_inflow_max', amountMinor: 2500000, currency: 'USD', id: null },
]);

function envMinor(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Historical env-driven caps, all in USD cents. They remain the base the
// data rules override, so existing deployments keep their configured USD
// values while other currencies scale correctly.
function codeDefaults() {
  const balance = envMinor('OXSTEED_CREDIT_MAX_CUSTOMER_BALANCE_CENTS', 1000000);
  return {
    max_transaction: envMinor('OXSTEED_CREDIT_MAX_TRANSACTION_CENTS', 250000),
    max_customer_balance: balance,
    max_total_issuance: envMinor('OXSTEED_CREDIT_MAX_TOTAL_ISSUANCE_CENTS', 5000000),
    daily_customer_issuance: envMinor('OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_ISSUANCE_CENTS', balance),
    daily_customer_transfer: envMinor('OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_TRANSFER_CENTS', balance),
    daily_customer_spend: envMinor('OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_SPEND_CENTS', balance),
    cash_out_transaction: envMinor('OXSTEED_CREDIT_MAX_CASH_OUT_TRANSACTION_CENTS', 20000),
    daily_cash_out: envMinor('OXSTEED_CREDIT_MAX_DAILY_CUSTOMER_CASH_OUT_CENTS', 20000),
    kyc_tier1_topup_max: envMinor('OXSTEED_CREDIT_TIER1_TOPUP_MAX_CENTS', 50000),
    kyc_tier2_topup_max: envMinor('OXSTEED_CREDIT_TIER2_TOPUP_MAX_CENTS', 250000),
    withdrawal_daily: envMinor('OXSTEED_CREDIT_WITHDRAWAL_DAILY_CAP_CENTS', 250000),
    stepup_threshold: envMinor('OXSTEED_CREDIT_STEPUP_THRESHOLD_CENTS', 100000),
    aml_structuring_threshold: envMinor('OXSTEED_CREDIT_MONITOR_STRUCTURING_THRESHOLD_CENTS', 200000),
    aml_large_payout: envMinor('OXSTEED_CREDIT_MONITOR_LARGE_PAYOUT_CENTS', 500000),
    aml_velocity_floor: envMinor('OXSTEED_CREDIT_MONITOR_VELOCITY_BASELINE_FLOOR_CENTS', 50000),
    aml_cross_border_daily: envMinor('OXSTEED_CREDIT_MONITOR_CROSS_BORDER_DAILY_CENTS', 300000),
    helper_cashout_review: envMinor('OXSTEED_CREDIT_HELPER_CASHOUT_REVIEW_CENTS', 100000),
    kyc_large_change_inflow: envMinor('OXSTEED_CREDIT_KYC_LARGE_CHANGE_CENTS', 500000),
  };
}

const LIMIT_KEYS = Object.freeze([
  ...Object.keys(codeDefaults()),
  'kyc_balance_max',
  'kyc_monthly_inflow_max',
]);

// Minor-unit exponents (ISO 4217). Mirrors oxsteedCreditService and the
// currency_minor_units table; kept here so limit math never guesses.
const EXPONENTS = Object.freeze({
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLP: 0, ISK: 0, JPY: 0, KRW: 0, PYG: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
});

function currencyExponent(code) {
  return Object.prototype.hasOwnProperty.call(EXPONENTS, code) ? EXPONENTS[code] : 2;
}

let snapshot = null; // { at, rules: [], rates: Map, seed?: true }
let loading = null;
let refreshTimer = null;

function rowsOf(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function loadSnapshot(client = pool) {
  const [rules, rates] = await Promise.all([
    client.query(
      `SELECT id, scope, scope_code, kyc_tier, limit_key, amount_minor, currency_code
         FROM credit_limit_rules WHERE active = TRUE`
    ),
    client.query('SELECT currency_code, units_per_usd FROM credit_limit_reference_rates'),
  ]);
  if (!Array.isArray(rules?.rows) || !Array.isArray(rates?.rows)) {
    throw new Error('Credit limit tables returned no rows array');
  }
  return {
    at: Date.now(),
    rules: rowsOf(rules).map((r) => ({
      id: String(r.id),
      scope: r.scope,
      scopeCode: String(r.scope_code).trim(),
      tier: r.kyc_tier === null || r.kyc_tier === undefined ? null : Number(r.kyc_tier),
      key: r.limit_key,
      amountMinor: Number(r.amount_minor),
      currency: String(r.currency_code).trim().toUpperCase(),
    })),
    rates: new Map(rowsOf(rates).map((r) => [String(r.currency_code).trim().toUpperCase(), String(r.units_per_usd)])),
  };
}

/** Load (or reload) the rules snapshot. Boot and the refresh timer call this. */
async function warmLimitRules(client = pool) {
  if (!loading) {
    loading = loadSnapshot(client)
      .then((fresh) => { snapshot = fresh; return fresh; })
      .finally(() => { loading = null; });
  }
  return loading;
}

function startLimitRuleRefresh(logger = null) {
  if (refreshTimer) return refreshTimer;
  refreshTimer = setInterval(() => {
    warmLimitRules().catch((error) => {
      if (logger) logger.warn('credit_limits.refresh_failed', { error: error.message });
    });
  }, REFRESH_MS);
  if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
  return refreshTimer;
}

function stopLimitRuleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function seedSnapshot() {
  return { at: Date.now(), seed: true, rules: SEED_RULES.map((r) => ({ ...r })), rates: new Map(Object.entries(SEED_REFERENCE_RATES)) };
}

function currentSnapshot() {
  if (snapshot) {
    if (Date.now() - snapshot.at > STALE_MS && process.env.NODE_ENV === 'production') {
      throw new AppError('Credit limits are temporarily unavailable', 503, 'credit_limit_unavailable');
    }
    return snapshot;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('Credit limits are temporarily unavailable', 503, 'credit_limit_unavailable');
  }
  return seedSnapshot();
}

// Called from inside the approving transaction, so reload a little later
// (after commit). The current snapshot keeps serving meanwhile; other
// instances pick the change up on their next refresh tick.
function invalidateLimitCache() {
  for (const delay of [500, 5000]) {
    const t = setTimeout(() => { warmLimitRules().catch(() => {}); }, delay);
    if (typeof t.unref === 'function') t.unref();
  }
}

/** Test hook: install a snapshot directly. */
function setLimitSnapshotForTests(value) {
  snapshot = value ? { at: Date.now(), rules: value.rules || [], rates: new Map(Object.entries(value.rates || SEED_REFERENCE_RATES)) } : null;
}

// Decimal string -> { num, den } BigInt fraction.
function toFraction(decimal) {
  const text = String(decimal).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  const den = 10n ** BigInt(frac.length);
  const num = BigInt(whole + frac);
  return num > 0n ? { num, den } : null;
}

/**
 * Translate an amount between currencies for LIMIT purposes. Rounds down
 * (toward the stricter limit). Returns null when either rate is unknown.
 */
function translateMinor(amountMinor, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return amountMinor;
  const from = toFraction(rates.get(fromCurrency));
  const to = toFraction(rates.get(toCurrency));
  if (!from || !to) return null;
  // amount_major_usd = amountMinor / 10^expFrom / (from.num/from.den)
  // target_minor = usd * (to.num/to.den) * 10^expTo
  const expFrom = BigInt(currencyExponent(fromCurrency));
  const expTo = BigInt(currencyExponent(toCurrency));
  const numerator = BigInt(amountMinor) * from.den * to.num * 10n ** expTo;
  const denominator = 10n ** expFrom * from.num * to.den;
  const result = numerator / denominator;
  return result > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(result);
}

function pickRule(rules, { key, currency, country, tier }) {
  const candidates = rules.filter((r) => r.key === key);
  const order = [
    (r) => r.scope === 'country' && r.scopeCode === country && tier !== null && r.tier === tier,
    (r) => r.scope === 'country' && r.scopeCode === country && r.tier === null,
    (r) => r.scope === 'currency' && r.scopeCode === currency && tier !== null && r.tier === tier,
    (r) => r.scope === 'currency' && r.scopeCode === currency && r.tier === null,
    (r) => r.scope === 'default' && tier !== null && r.tier === tier,
    (r) => r.scope === 'default' && r.tier === null,
  ];
  for (const match of order) {
    const hit = candidates.find(match);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve one limit for a currency (and optionally country / KYC tier).
 * Returns { amountMinor, currency, source, ruleId }.
 */
function resolveLimitSync(key, { currency, country = null, tier = null } = {}) {
  if (!LIMIT_KEYS.includes(key)) {
    throw new AppError(`Unknown Credit limit '${key}'`, 500, 'credit_limit_key_unknown');
  }
  const target = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(target)) throw new AppError('A currency is required to resolve a limit', 400, 'credit_limit_currency_required');
  const normalizedCountry = country ? String(country).trim().toUpperCase().slice(0, 2) : null;
  const normalizedTier = tier === null || tier === undefined ? null : Number(tier);
  const snap = currentSnapshot();
  const rule = pickRule(snap.rules, { key, currency: target, country: normalizedCountry, tier: normalizedTier });
  const base = rule
    ? { amountMinor: rule.amountMinor, currency: rule.currency, source: `${rule.scope}:${rule.scopeCode}${rule.tier === null ? '' : `:t${rule.tier}`}`, ruleId: rule.id }
    : (Object.prototype.hasOwnProperty.call(codeDefaults(), key)
      ? { amountMinor: codeDefaults()[key], currency: 'USD', source: 'code_default', ruleId: null }
      : null);
  if (!base) {
    throw new AppError(`Credit limit '${key}' is not configured`, 503, 'credit_limit_unavailable', { key, currency: target });
  }
  const rates = new Map(snap.rates);
  if (!rates.has('USD')) rates.set('USD', '1');
  const amountMinor = translateMinor(base.amountMinor, base.currency, target, rates);
  if (amountMinor === null) {
    throw new AppError(
      `Credit limit '${key}' has no reference rate for ${target}; the movement is blocked until finance sets one`,
      503,
      'credit_limit_unavailable',
      { key, currency: target }
    );
  }
  return { amountMinor, currency: target, source: base.source, ruleId: base.ruleId, ruleCurrency: base.currency };
}

function resolveLimitMinor(key, options) {
  return resolveLimitSync(key, options).amountMinor;
}

async function resolveLimit(key, options) {
  if (!snapshot && process.env.NODE_ENV === 'production') {
    try { await warmLimitRules(); } catch { /* currentSnapshot fails closed below */ }
  }
  return resolveLimitSync(key, options);
}

/** Admin read model: every rule and rate as stored. */
async function listLimitConfiguration(client = pool) {
  const [rules, rates] = await Promise.all([
    client.query(
      `SELECT * FROM credit_limit_rules ORDER BY limit_key, scope, scope_code, kyc_tier NULLS FIRST`
    ),
    client.query('SELECT * FROM credit_limit_reference_rates ORDER BY currency_code'),
  ]);
  return {
    keys: LIMIT_KEYS,
    codeDefaultsUsdMinor: codeDefaults(),
    rules: rowsOf(rules).map((r) => ({
      id: String(r.id), scope: r.scope, scopeCode: String(r.scope_code).trim(), kycTier: r.kyc_tier,
      limitKey: r.limit_key, amountMinor: Number(r.amount_minor), currencyCode: r.currency_code,
      active: r.active, note: r.note || null, updatedBy: r.updated_by || null, updatedAt: r.updated_at,
    })),
    referenceRates: rowsOf(rates).map((r) => ({
      currencyCode: r.currency_code, unitsPerUsd: String(r.units_per_usd), source: r.source, asOf: r.as_of,
    })),
  };
}

function validateRuleInput(input) {
  const scope = String(input.scope || '').trim();
  if (!['default', 'currency', 'country'].includes(scope)) {
    throw new AppError('scope must be default, currency or country', 400, 'credit_limit_scope_invalid');
  }
  const scopeCode = scope === 'default' ? '*' : String(input.scopeCode || '').trim().toUpperCase();
  if (scope === 'currency' && !/^[A-Z]{3}$/.test(scopeCode)) throw new AppError('A currency code is required', 400, 'credit_limit_scope_invalid');
  if (scope === 'country' && !/^[A-Z]{2}$/.test(scopeCode)) throw new AppError('A country code is required', 400, 'credit_limit_scope_invalid');
  const limitKey = String(input.limitKey || '').trim();
  if (!LIMIT_KEYS.includes(limitKey)) throw new AppError('Unknown limit key', 400, 'credit_limit_key_unknown');
  const amountMinor = Number(input.amountMinor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new AppError('amountMinor must be a non-negative integer', 400, 'credit_limit_amount_invalid');
  const currencyCode = String(input.currencyCode || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new AppError('currencyCode is required', 400, 'credit_limit_currency_required');
  const kycTier = input.kycTier === null || input.kycTier === undefined || input.kycTier === '' ? null : Number(input.kycTier);
  if (kycTier !== null && (!Number.isInteger(kycTier) || kycTier < 0 || kycTier > 3)) throw new AppError('kycTier must be 0-3', 400, 'credit_limit_tier_invalid');
  return {
    scope, scopeCode, limitKey, amountMinor, currencyCode, kycTier,
    active: input.active !== false,
    note: input.note ? String(input.note).slice(0, 1000) : null,
  };
}

/**
 * Executor for the two-admin pending action 'credit_limit_rule_update'.
 * Runs inside the checker's decision transaction.
 */
async function applyLimitRuleUpdate(client, { payload, makerUserId, checkerUserId, pendingActionId }) {
  const rule = validateRuleInput(payload || {});
  const { rows: before } = await client.query(
    `SELECT * FROM credit_limit_rules
      WHERE scope = $1 AND scope_code = $2 AND COALESCE(kyc_tier, -1) = COALESCE($3::smallint, -1) AND limit_key = $4
      FOR UPDATE`,
    [rule.scope, rule.scopeCode, rule.kycTier, rule.limitKey]
  );
  const { rows } = await client.query(
    `INSERT INTO credit_limit_rules (scope, scope_code, kyc_tier, limit_key, amount_minor, currency_code, active, note, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (scope, scope_code, COALESCE(kyc_tier, -1), limit_key)
     DO UPDATE SET amount_minor = EXCLUDED.amount_minor, currency_code = EXCLUDED.currency_code,
                   active = EXCLUDED.active, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    [rule.scope, rule.scopeCode, rule.kycTier, rule.limitKey, rule.amountMinor, rule.currencyCode, rule.active, rule.note, makerUserId || null]
  );
  await client.query(
    `INSERT INTO credit_limit_rule_history
       (rule_id, scope, scope_code, kyc_tier, limit_key, before_state, after_state, changed_by, approved_by, pending_action_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)`,
    [rows[0].id, rule.scope, rule.scopeCode, rule.kycTier, rule.limitKey,
      before[0] ? JSON.stringify(before[0]) : null, JSON.stringify(rows[0]), makerUserId || null, checkerUserId || null, pendingActionId || null]
  );
  invalidateLimitCache();
  return { ruleId: String(rows[0].id), limitKey: rule.limitKey, scope: rule.scope, scopeCode: rule.scopeCode };
}

async function applyReferenceRateUpdate(client, { payload, checkerUserId }) {
  const currencyCode = String(payload?.currencyCode || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) throw new AppError('currencyCode is required', 400, 'credit_limit_currency_required');
  const units = String(payload?.unitsPerUsd || '').trim();
  if (!toFraction(units)) throw new AppError('unitsPerUsd must be a positive decimal', 400, 'credit_limit_rate_invalid');
  const asOf = String(payload?.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  await client.query(
    `INSERT INTO credit_limit_reference_rates (currency_code, units_per_usd, source, as_of, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (currency_code) DO UPDATE SET units_per_usd = EXCLUDED.units_per_usd, source = EXCLUDED.source,
       as_of = EXCLUDED.as_of, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [currencyCode, units, String(payload?.source || 'admin').slice(0, 120), asOf, checkerUserId || null]
  );
  invalidateLimitCache();
  return { currencyCode, unitsPerUsd: units };
}

function registerOversightActions(register) {
  register('credit_limit_rule_update', ({ client, payload, requestedBy, actorUserId }) =>
    applyLimitRuleUpdate(client, { payload, makerUserId: requestedBy, checkerUserId: actorUserId, pendingActionId: payload?.pendingActionId || null }));
  register('credit_limit_reference_rate_update', ({ client, payload, actorUserId }) =>
    applyReferenceRateUpdate(client, { payload, checkerUserId: actorUserId }));
}

module.exports = {
  registerOversightActions,
  SEED_REFERENCE_RATES,
  SEED_RULES,
  warmLimitRules,
  startLimitRuleRefresh,
  stopLimitRuleRefresh,
  setLimitSnapshotForTests,
  resolveLimitSync,
  LIMIT_KEYS,
  codeDefaults,
  currencyExponent,
  translateMinor,
  pickRule,
  resolveLimit,
  resolveLimitMinor,
  invalidateLimitCache,
  listLimitConfiguration,
  validateRuleInput,
  applyLimitRuleUpdate,
  applyReferenceRateUpdate,
};
