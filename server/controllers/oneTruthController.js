const pool = require('../db');
const logger = require('../utils/logger');
const AppError = require('../utils/appError');
const countriesUtil = require('../utils/countries');
const { userMatchesAnyRegion } = require('../middleware/regionAuth');
const { logAdminAction } = require('../services/auditService');
const {
  checkInvestigationAccess,
  logInvestigationRead,
  logOneTruthRead,
  requestInvestigationAccess,
  InvestigationAccessError,
} = require('../services/investigationAccessService');

const SUSPECT_THRESHOLD = 2;

const SIGNAL_WEIGHTS = {
  same_ip: 3,
  same_ip_hash: 2,
  same_phone: 3,
  same_name: 1,
  same_device_terms: 2,
  same_didit_hash: 4,
  same_referral: 1,
  close_created: 1,
};

function tableExistsQuery(name) {
  return `SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = $1
  ) AS exists`;
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
    ) AS exists`,
    [table, column]
  );
  return rows[0]?.exists ?? false;
}

async function buildUserSelect(client) {
  const always = [
    'id', 'email', 'first_name', 'last_name', 'role',
    'is_active', 'is_banned', 'is_suspended',
    'created_at', 'last_login_at',
  ];
  const optional = [
    'phone', 'phone_number', 'city', 'state', 'country', 'zip_code',
    'latitude', 'longitude', 'last_login_ip', 'last_known_ip_hash',
    'terms_acceptance_ua', 'didit_identity_hash', 'referral_code',
    'referred_by', 'profile_photo_url', 'identity_verified',
  ];
  const cols = [...always];
  for (const col of optional) {
    if (await columnExists(client, 'users', col)) cols.push(col);
  }
  return cols.map((c) => `u.${c}`).join(', ');
}

function parseRegionDefinition(region) {
  if (!region?.boundary_definition) return null;
  return typeof region.boundary_definition === 'string'
    ? JSON.parse(region.boundary_definition)
    : region.boundary_definition;
}

function normalizeCountryFilter(raw) {
  if (!raw) return '';
  const upper = String(raw).trim().toUpperCase();
  return countriesUtil.isValidCountry(upper) ? upper : '';
}

// P1 item 13: boundary types One Truth can actually scope to. Anything else
// (geo_radius, unknown types) is rejected with 400 instead of silently
// querying globally.
const SUPPORTED_BOUNDARY_TYPES = new Set(['country_only', 'country_region', 'city_state', 'zip_range']);

function summarizeBoundary(def) {
  if (!def?.type) return 'Custom scope';
  switch (def.type) {
    case 'country_only': {
      const list = def.countries || [];
      if (!list.length) return 'Country scope';
      return list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} +${list.length - 3}`;
    }
    case 'country_region': {
      const list = def.entries || [];
      if (!list.length) return 'Country / region scope';
      const first = list[0];
      return `${first.country}/${first.region}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
    }
    case 'city_state': {
      const list = def.entries || [];
      if (!list.length) return 'City / state scope';
      const first = list[0];
      return `${first.city}, ${first.state}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
    }
    case 'zip_range':
      return `${def.ranges?.length || 0} ZIP range(s)`;
    case 'geo_radius':
      return `${def.radius_miles || 0}mi radius`;
    default:
      return def.type;
  }
}

async function getRegionScope(client, regionId) {
  if (!regionId) return { region: null, def: null, warning: null };
  const { rows } = await client.query(
    'SELECT id, name, description, boundary_definition FROM admin_regions WHERE id = $1',
    [regionId]
  );
  if (!rows.length) {
    return {
      region: null,
      def: null,
      warning: 'Selected region could not be found. Showing unscoped results.',
    };
  }
  const region = rows[0];
  const def = parseRegionDefinition(region);
  return { region, def, warning: null };
}

function buildBoundaryClause(def, fields, startIndex) {
  if (!def?.type) return { clause: '', params: [], nextIndex: startIndex, unsupported: false };

  const params = [];
  const fragments = [];
  let idx = startIndex;
  let unsupported = false;

  if (def.type === 'country_only') {
    if (!fields.country) unsupported = true;
    else if (Array.isArray(def.countries) && def.countries.length) {
      const normalized = def.countries
        .map((country) => normalizeCountryFilter(country))
        .filter(Boolean);
      if (normalized.length) {
        fragments.push(`UPPER(COALESCE(${fields.country}, '')) = ANY($${idx}::text[])`);
        params.push(normalized);
        idx += 1;
      }
    }
  } else if (def.type === 'country_region') {
    if (!fields.country || !fields.state) unsupported = true;
    else if (Array.isArray(def.entries) && def.entries.length) {
      for (const entry of def.entries) {
        const country = normalizeCountryFilter(entry?.country);
        const region = String(entry?.region || '').trim();
        if (!country || !region) continue;
        fragments.push(
          `(UPPER(COALESCE(${fields.country}, '')) = $${idx} AND UPPER(COALESCE(${fields.state}, '')) = UPPER($${idx + 1}))`
        );
        params.push(country, region);
        idx += 2;
      }
    }
  } else if (def.type === 'city_state') {
    if (!fields.city || !fields.state) unsupported = true;
    else if (Array.isArray(def.entries) && def.entries.length) {
      for (const entry of def.entries) {
        const city = String(entry?.city || '').trim();
        const state = String(entry?.state || '').trim();
        if (!city || !state) continue;
        fragments.push(
          `(LOWER(COALESCE(${fields.city}, '')) = LOWER($${idx}) AND UPPER(COALESCE(${fields.state}, '')) = UPPER($${idx + 1}))`
        );
        params.push(city, state);
        idx += 2;
      }
    }
  } else if (def.type === 'zip_range') {
    if (!fields.zip) unsupported = true;
    else if (Array.isArray(def.ranges) && def.ranges.length) {
      for (const range of def.ranges) {
        if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end)) continue;
        fragments.push(
          `(NULLIF(regexp_replace(COALESCE(${fields.zip}, ''), '\\D', '', 'g'), '') IS NOT NULL AND CAST(regexp_replace(COALESCE(${fields.zip}, ''), '\\D', '', 'g') AS INTEGER) BETWEEN $${idx} AND $${idx + 1})`
        );
        params.push(range.start, range.end);
        idx += 2;
      }
    }
  } else if (def.type === 'geo_radius') {
    unsupported = true;
  } else {
    unsupported = true;
  }

  if (!fragments.length) {
    return { clause: '', params, nextIndex: idx, unsupported };
  }

  return {
    clause: `(${fragments.join(' OR ')})`,
    params,
    nextIndex: idx,
    unsupported,
  };
}

function combineClauses(parts) {
  const clean = parts.filter(Boolean);
  if (!clean.length) return '';
  return clean.length === 1 ? clean[0] : `(${clean.join(' OR ')})`;
}

// ── P1 item 11: purpose-trail helpers ─────────────────────────────────────

// Fields treated as sensitive on One Truth list reads. Named in the per-read
// audit entry; masked for delegated analysts (super-admins keep full values,
// matching pre-existing behavior).
const SENSITIVE_LIST_FIELDS = [
  'phone', 'phone_number', 'last_login_ip', 'last_known_ip_hash',
  'didit_identity_hash', 'terms_acceptance_ua',
];

function maskPII(users) {
  return users.map((u) => ({
    ...u,
    phone: u.phone ? `***${String(u.phone).slice(-4)}` : null,
    phone_number: u.phone_number ? `***${String(u.phone_number).slice(-4)}` : null,
    last_login_ip: u.last_login_ip ? '***.***.***.***' : null,
    last_known_ip_hash: u.last_known_ip_hash ? '[redacted]' : null,
    didit_identity_hash: u.didit_identity_hash ? '[redacted]' : null,
    terms_acceptance_ua: u.terms_acceptance_ua ? '[redacted]' : null,
  }));
}

// Delegated analysts only ever see rows for user ids inside their active
// grants. scopeIds === null means super-admin (unscoped). Appends
// `col = ANY($N::uuid[])` fragments and pushes the params.
function withAnalystScope(whereParts, params, userColumns, scopeIds) {
  if (!scopeIds) return;
  const cols = Array.isArray(userColumns) ? userColumns : [userColumns];
  const start = params.length + 1;
  const ors = cols.map((col, i) => `${col} = ANY($${start + i}::uuid[])`);
  whereParts.push(cols.length > 1 ? `(${ors.join(' OR ')})` : ors[0]);
  for (const _col of cols) params.push(scopeIds);
}

// P1 item 13: operational errors (e.g. unsupported region types) must
// surface their real status instead of collapsing into a 500.
function sendOneTruthError(res, err, fallbackMessage) {
  logger.error('oneTruth error', { message: err.message, stack: err.stack, code: err.code });
  const status = Number(err.statusCode || err.status) || 500;
  if (status >= 500) {
    return res.status(500).json({ error: fallbackMessage });
  }
  return res.status(status).json({ error: err.message, code: err.code || 'one_truth_error' });
}

// ── P1 item 12.4: suspect-pair review helpers ─────────────────────────────

const PAIR_REVIEW_STATUSES = ['reviewed', 'confirmed', 'dismissed'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Deterministic pair key: the two user ids sorted, joined with ':'.
// Matches the one_truth_pair_reviews primary key (migration 716).
function pairKeyFor(idA, idB) {
  const [a, b] = [String(idA), String(idB)].sort();
  return `${a}:${b}`;
}

// Account-creation cohort for the suspect queue cohort filter (YYYY-MM).
function cohortOf(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getPairReviews(client, pairKeys) {
  const map = new Map();
  if (!pairKeys.length) return map;
  const { rows: existsRows } = await client.query(
    tableExistsQuery('one_truth_pair_reviews'),
    ['one_truth_pair_reviews']
  );
  if (!existsRows[0]?.exists) return map;
  const { rows } = await client.query(
    `SELECT pair_key, status, reviewed_by, notes, updated_at
     FROM one_truth_pair_reviews
     WHERE pair_key = ANY($1)`,
    [pairKeys]
  );
  for (const row of rows) map.set(row.pair_key, row);
  return map;
}

// P1 item 12.1: fraud-case pipeline rollups. Platform-wide (fraud cases are
// platform records, not region-scoped); analyst reads are limited to cases
// whose subject is inside their grant scope.
async function getFraudCaseStats(client, scopeIds) {
  const empty = { open: 0, investigating: 0, resolved: 0, dismissed: 0, total: 0, bySource: [] };
  const { rows: existsRows } = await client.query(tableExistsQuery('fraud_cases'), ['fraud_cases']);
  if (!existsRows[0]?.exists) return empty;

  const params = [];
  let subjectFilter = '';
  if (scopeIds) {
    subjectFilter = `WHERE subject_type = 'user' AND subject_id = ANY($1)`;
    params.push(scopeIds);
  } else {
    subjectFilter = `WHERE subject_type = 'user'`;
  }
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS count FROM fraud_cases ${subjectFilter} GROUP BY status`,
    params
  );
  const stats = { ...empty };
  for (const row of rows) {
    if (row.status in stats) stats[row.status] = row.count;
    stats.total += row.count;
  }
  const { rows: srcRows } = await client.query(
    `SELECT source, COUNT(*)::int AS count FROM fraud_cases ${subjectFilter} GROUP BY source ORDER BY count DESC`,
    params
  );
  stats.bySource = srcRows;
  return stats;
}

function buildUserScopeClause(filters, startIndex) {
  const clauses = [];
  const params = [];
  let idx = startIndex;
  const warnings = [];

  if (filters.country) {
    clauses.push(
      `(UPPER(COALESCE(u.country, '')) = $${idx} OR EXISTS (
        SELECT 1
        FROM businesses b_scope
        WHERE b_scope.user_id = u.id
          AND b_scope.deleted_at IS NULL
          AND UPPER(COALESCE(b_scope.address_country, '')) = $${idx}
      ))`
    );
    params.push(filters.country);
    idx += 1;
  }

  if (filters.regionDef) {
    const userBoundary = buildBoundaryClause(filters.regionDef, {
      country: 'u.country',
      state: 'u.state',
      city: 'u.city',
      zip: 'u.zip_code',
    }, idx);
    idx = userBoundary.nextIndex;

    const businessBoundary = buildBoundaryClause(filters.regionDef, {
      country: 'b_scope.address_country',
      state: 'b_scope.address_state',
      city: 'b_scope.address_city',
      zip: 'b_scope.address_zip',
    }, idx);
    idx = businessBoundary.nextIndex;

    const regionClause = combineClauses([
      userBoundary.clause,
      businessBoundary.clause
        ? `EXISTS (
          SELECT 1
          FROM businesses b_scope
          WHERE b_scope.user_id = u.id
            AND b_scope.deleted_at IS NULL
            AND ${businessBoundary.clause}
        )`
        : '',
    ]);

    params.push(...userBoundary.params, ...businessBoundary.params);

    if (regionClause) clauses.push(regionClause);
    const regionUnusable =
      (userBoundary.unsupported && businessBoundary.unsupported) ||
      (filters.regionDef?.type && !regionClause);
    if (regionUnusable) {
      // P1 item 13: never silently widen scope. A selected-but-unusable
      // region type (geo_radius, unknown types, or a definition with no
      // usable entries) must fail loudly instead of querying everything
      // while the UI shows a region name.
      throw new AppError(
        `Region type "${filters.regionDef.type}" is not supported for One Truth scoping.`,
        400,
        'unsupported_region'
      );
    }
  }

  return { clause: clauses.join(' AND '), params, nextIndex: idx, warnings };
}

function buildEntityScopeClause(filters, fields, startIndex) {
  const clauses = [];
  const params = [];
  let idx = startIndex;
  const warnings = [];

  if (filters.country && fields.country) {
    clauses.push(`UPPER(COALESCE(${fields.country}, '')) = $${idx}`);
    params.push(filters.country);
    idx += 1;
  }

  if (filters.regionDef) {
    const boundary = buildBoundaryClause(filters.regionDef, fields, idx);
    idx = boundary.nextIndex;
    params.push(...boundary.params);
    if (boundary.clause) clauses.push(boundary.clause);
    if (boundary.unsupported) {
      // Audit fix: reject instead of silently going global. A warning is not
      // enough; the UI would show a region name while querying everything.
      throw new AppError(
        `Region type "${filters.regionDef.type}" is not supported for One Truth scoping.`,
        400,
        'unsupported_region'
      );
    }
  }

  return { clause: clauses.join(' AND '), params, nextIndex: idx, warnings };
}

async function resolveScope(client, req) {
  const country = normalizeCountryFilter(req.query.country);
  const { region, def, warning } = await getRegionScope(client, req.query.regionId);
  const warnings = warning ? [warning] : [];
  return {
    country,
    region,
    regionDef: def,
    warnings,
  };
}

function formatScopeMeta(scope) {
  return {
    selectedCountry: scope.country || null,
    selectedRegionId: scope.region?.id || null,
    selectedRegionName: scope.region?.name || null,
    selectedRegionBoundaryType: scope.regionDef?.type || null,
    selectedRegionCoverage: summarizeBoundary(scope.regionDef),
    warnings: Array.from(new Set(scope.warnings || [])),
  };
}

async function getCountryOptions(client) {
  const parts = [];

  if (await columnExists(client, 'users', 'country')) {
    parts.push(`SELECT DISTINCT UPPER(country) AS country_code FROM users WHERE deleted_at IS NULL AND country IS NOT NULL AND TRIM(country) <> ''`);
  }
  if (await columnExists(client, 'businesses', 'address_country')) {
    parts.push(`SELECT DISTINCT UPPER(address_country) AS country_code FROM businesses WHERE deleted_at IS NULL AND address_country IS NOT NULL AND TRIM(address_country) <> ''`);
  }
  if (await columnExists(client, 'jobs', 'location_country')) {
    parts.push(`SELECT DISTINCT UPPER(location_country) AS country_code FROM jobs WHERE location_country IS NOT NULL AND TRIM(location_country) <> ''`);
  }

  if (!parts.length) return [];

  const { rows } = await client.query(
    `${parts.join(' UNION ')} ORDER BY country_code ASC`
  );

  return rows
    .map((row) => row.country_code)
    .filter((code) => countriesUtil.isValidCountry(code))
    .map((code) => ({ code, name: countriesUtil.getCountryName(code) }));
}

async function getRegionOptions(client) {
  const { rows } = await client.query(
    `SELECT id, name, description, boundary_definition
     FROM admin_regions
     ORDER BY name ASC`
  );

  return rows.map((row) => {
    const def = parseRegionDefinition(row);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      boundaryType: def?.type || null,
      coverageLabel: summarizeBoundary(def),
      // P1 item 13: lets the UI flag region types One Truth cannot scope
      // before the request fails loudly with 400 unsupported_region.
      supported: def?.type ? SUPPORTED_BOUNDARY_TYPES.has(def.type) : false,
    };
  });
}

async function attachBusinesses(client, users) {
  if (!users.length) return users;
  const userIds = users.map((user) => user.id);
  const { rows: businesses } = await client.query(
    `SELECT b.id, b.user_id, b.business_name, b.is_active, b.is_primary,
            b.address_city, b.address_state, b.address_country, b.industry_category,
            b.created_at, b.deleted_at
     FROM businesses b
     WHERE b.user_id = ANY($1)
     ORDER BY b.created_at ASC`,
    [userIds]
  );

  const byUser = new Map();
  for (const business of businesses) {
    if (!byUser.has(business.user_id)) byUser.set(business.user_id, []);
    byUser.get(business.user_id).push(business);
  }

  return users.map((user) => ({
    ...user,
    businesses: byUser.get(user.id) || [],
  }));
}

async function attachOperationalCounts(client, users) {
  if (!users.length) return users;
  const userIds = users.map((user) => user.id);
  const opsMap = new Map(userIds.map((id) => [id, {
    jobsPosted: 0,
    jobsWorked: 0,
    supportTickets: 0,
    orders: 0,
    toolsListed: 0,
    paymentsSent: 0,
    paymentsReceived: 0,
    consultingSessions: 0,
  }]));

  const queries = [];

  const addGroupedCount = async (table, sql, key) => {
    const { rows: existsRows } = await client.query(tableExistsQuery(table), [table]);
    if (!existsRows[0]?.exists) return;
    queries.push(client.query(sql, [userIds]).then(({ rows }) => ({ rows, key })));
  };

  await addGroupedCount(
    'jobs',
    `SELECT client_id AS user_id, COUNT(*)::int AS count
     FROM jobs
     WHERE client_id = ANY($1)
     GROUP BY client_id`,
    'jobsPosted'
  );

  await addGroupedCount(
    'jobs',
    `SELECT assigned_helper_id AS user_id, COUNT(*)::int AS count
     FROM jobs
     WHERE assigned_helper_id = ANY($1)
     GROUP BY assigned_helper_id`,
    'jobsWorked'
  );

  await addGroupedCount(
    'support_tickets',
    `SELECT user_id, COUNT(*)::int AS count
     FROM support_tickets
     WHERE user_id = ANY($1)
     GROUP BY user_id`,
    'supportTickets'
  );

  await addGroupedCount(
    'marketplace_orders',
    `SELECT customer_id AS user_id, COUNT(*)::int AS count
     FROM marketplace_orders
     WHERE customer_id = ANY($1)
     GROUP BY customer_id`,
    'orders'
  );

  await addGroupedCount(
    'tool_rentals',
    `SELECT user_id, COUNT(*)::int AS count
     FROM tool_rentals
     WHERE user_id = ANY($1)
     GROUP BY user_id`,
    'toolsListed'
  );

  await addGroupedCount(
    'payments',
    `SELECT payer_id AS user_id, COUNT(*)::int AS count
     FROM payments
     WHERE payer_id = ANY($1)
     GROUP BY payer_id`,
    'paymentsSent'
  );

  await addGroupedCount(
    'payments',
    `SELECT payee_id AS user_id, COUNT(*)::int AS count
     FROM payments
     WHERE payee_id = ANY($1)
     GROUP BY payee_id`,
    'paymentsReceived'
  );

  await addGroupedCount(
    'consulting_sessions',
    `SELECT user_id, COUNT(*)::int AS count
     FROM consulting_sessions
     WHERE user_id = ANY($1)
     GROUP BY user_id`,
    'consultingSessions'
  );

  const results = await Promise.all(queries);
  for (const result of results) {
    for (const row of result.rows) {
      if (!opsMap.has(row.user_id)) continue;
      opsMap.get(row.user_id)[result.key] = parseInt(row.count, 10) || 0;
    }
  }

  return users.map((user) => ({
    ...user,
    ops: opsMap.get(user.id) || opsMap.values().next().value,
  }));
}

async function enrichUsers(client, users) {
  const withBusinesses = await attachBusinesses(client, users);
  return attachOperationalCounts(client, withBusinesses);
}

/**
 * Build suspect pairs using indexed database queries instead of O(n²) in-memory
 * comparison. For each signal type, find users sharing the same value via
 * GROUP BY ... HAVING COUNT(*) > 1, then build pairs from those groups.
 * This is O(n) in database time with proper indexes, not O(n²) in Node.
 */
async function buildSuspectPairsIndexed(client, userIds) {
  if (!userIds.length) return [];
  const suspectPairs = [];
  const seen = new Set();

  const addPairs = (users, signalType, label, weight) => {
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        const a = users[i], b = users[j];
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        if (seen.has(pairKey + signalType)) continue;
        seen.add(pairKey + signalType);
        suspectPairs.push({
          userA: { id: a.id }, userB: { id: b.id },
          signals: [{ type: signalType, label, weight }],
          score: weight,
        });
      }
    }
  };

  // Same phone
  const { rows: phoneGroups } = await client.query(
    `SELECT phone, array_agg(id) AS user_ids
     FROM users WHERE id = ANY($1) AND phone IS NOT NULL AND phone != ''
     GROUP BY phone HAVING COUNT(*) > 1`,
    [userIds]
  );
  for (const g of phoneGroups) {
    const users = g.user_ids.map(id => ({ id }));
    addPairs(users, 'same_phone', 'Same phone number', SIGNAL_WEIGHTS.same_phone);
  }

  // Same last login IP
  const { rows: ipGroups } = await client.query(
    `SELECT last_login_ip, array_agg(id) AS user_ids
     FROM users WHERE id = ANY($1) AND last_login_ip IS NOT NULL
     GROUP BY last_login_ip HAVING COUNT(*) > 1`,
    [userIds]
  );
  for (const g of ipGroups) {
    const users = g.user_ids.map(id => ({ id }));
    addPairs(users, 'same_ip', 'Same last login IP', SIGNAL_WEIGHTS.same_ip);
  }

  return suspectPairs;
}

async function countUsersWithMultipleBusinesses(client, scope, scopeIds) {
  const base = [`u.deleted_at IS NULL`, `u.role NOT IN ('admin', 'super_admin')`];
  const params = [];
  let idx = 1;
  const scopeClause = buildUserScopeClause(scope, idx);
  idx = scopeClause.nextIndex;
  params.push(...scopeClause.params);
  scope.warnings.push(...scopeClause.warnings);
  if (scopeClause.clause) base.push(scopeClause.clause);
  // P1 item 11/12.2: delegated analysts only count users inside their grant scope.
  withAnalystScope(base, params, 'u.id', scopeIds);

  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM users u
     WHERE ${base.join(' AND ')}
       AND (SELECT COUNT(*) FROM businesses b WHERE b.user_id = u.id AND b.deleted_at IS NULL) > 1`,
    params
  );
  return rows[0]?.count || 0;
}

exports.getFilters = async (_req, res) => {
  const client = await pool.connect();
  try {
    const [countries, regions] = await Promise.all([
      getCountryOptions(client),
      getRegionOptions(client),
    ]);
    res.json({ countries, regions });
  } catch (err) {
    logger.error('oneTruth.getFilters error', { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to load One Truth filters' });
  } finally {
    client.release();
  }
};

exports.listUsers = async (req, res) => {
  const client = await pool.connect();
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    const scope = await resolveScope(client, req);
    const userSelect = await buildUserSelect(client);

    const conditions = [`u.deleted_at IS NULL`, `u.role NOT IN ('admin','super_admin')`];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(
        u.email ILIKE $${idx}
        OR u.first_name ILIKE $${idx}
        OR u.last_name ILIKE $${idx}
        OR (u.first_name || ' ' || u.last_name) ILIKE $${idx}
      )`);
      params.push(`%${search}%`);
      idx += 1;
    }

    const scopeClause = buildUserScopeClause(scope, idx);
    idx = scopeClause.nextIndex;
    params.push(...scopeClause.params);
    scope.warnings.push(...scopeClause.warnings);
    if (scopeClause.clause) conditions.push(scopeClause.clause);

    // P1 item 11/12.2: delegated analysts only see users inside their grant scope.
    withAnalystScope(conditions, params, 'u.id', req.oneTruthScopeIds);

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM users u ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.count || 0;

    const { rows } = await client.query(
      `SELECT ${userSelect},
              (SELECT COUNT(*) FROM businesses b WHERE b.user_id = u.id AND b.deleted_at IS NULL) AS business_count
       FROM users u
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    const users = await enrichUsers(client, rows);

    // P1 item 11: analysts get PII-masked rows; every list read is
    // audit-logged with purpose + approver + the sensitive fields served.
    const isAnalyst = Array.isArray(req.oneTruthGrants) && req.oneTruthGrants.length > 0;
    const visibleUsers = isAnalyst ? maskPII(users) : users;
    await logOneTruthRead({
      readerAdminId: req.user.id,
      grants: req.oneTruthGrants,
      endpoint: 'one_truth_list_users',
      resultCount: visibleUsers.length,
      sensitiveFields: SENSITIVE_LIST_FIELDS,
      piiMasked: isAnalyst,
      req,
    });

    res.json({
      users: visibleUsers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      scope: formatScopeMeta(scope),
    });
  } catch (err) {
    sendOneTruthError(res, err, 'Failed to load users');
  } finally {
    client.release();
  }
};

exports.listSuspects = async (req, res) => {
  const client = await pool.connect();
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const scope = await resolveScope(client, req);
    const userSelect = await buildUserSelect(client);
    const conditions = [`u.deleted_at IS NULL`, `u.role NOT IN ('admin','super_admin')`];
    const params = [];
    let idx = 1;

    const scopeClause = buildUserScopeClause(scope, idx);
    idx = scopeClause.nextIndex;
    params.push(...scopeClause.params);
    scope.warnings.push(...scopeClause.warnings);
    if (scopeClause.clause) conditions.push(scopeClause.clause);

    // P1 item 11/12.2: delegated analysts only evaluate users inside their grant scope.
    withAnalystScope(conditions, params, 'u.id', req.oneTruthScopeIds);

    const { rows } = await client.query(
      `SELECT ${userSelect},
              (SELECT COUNT(*) FROM businesses b WHERE b.user_id = u.id AND b.deleted_at IS NULL) AS business_count
       FROM users u
       WHERE ${conditions.join(' AND ')}
       ORDER BY u.created_at DESC
       -- Audit fix: was ASC (oldest 5k only, missing recent multi-accounting).
       -- Now DESC to catch recent signups. The 5k cap remains; production
       -- needs an async suspect job, not a larger limit.
       LIMIT 5000`,
      params
    );

    if (rows.length >= 5000) {
      scope.warnings.push(
        'Investigation truncated at 5,000 users. Refine the scope for a complete review.'
      );
    }

    const enrichedUsers = await enrichUsers(client, rows);
    const userMap = new Map(enrichedUsers.map((user) => [user.id, user]));
    // Use indexed DB queries instead of O(n²) in-memory comparison.
    const userIds = enrichedUsers.map(u => u.id);
    const suspectPairs = (await buildSuspectPairsIndexed(client, userIds)).map((pair) => ({
      ...pair,
      userA: userMap.get(pair.userA.id) || pair.userA,
      userB: userMap.get(pair.userB.id) || pair.userB,
    }));

    // P1 item 12.4: deterministic pair keys + persistent review state.
    const pairKeys = suspectPairs.map((pair) => pairKeyFor(pair.userA.id, pair.userB.id));
    const reviews = await getPairReviews(client, pairKeys);
    const isAnalyst = Array.isArray(req.oneTruthGrants) && req.oneTruthGrants.length > 0;
    let pairs = suspectPairs.map((pair) => {
      const pairKey = pairKeyFor(pair.userA.id, pair.userB.id);
      const userA = isAnalyst ? maskPII([pair.userA])[0] : pair.userA;
      const userB = isAnalyst ? maskPII([pair.userB])[0] : pair.userB;
      return {
        ...pair,
        id: pairKey,
        pairKey,
        userA,
        userB,
        review: reviews.get(pairKey) || null,
        cohort: cohortOf(pair.userA.created_at),
      };
    });

    // Stable filter options, computed before filtering.
    const filterMeta = {
      signalTypes: [...new Set(pairs.flatMap((p) => p.signals.map((s) => s.type)))].sort(),
      cohorts: [...new Set(pairs.map((p) => p.cohort).filter(Boolean))].sort().reverse(),
      reviewStatuses: ['open', ...PAIR_REVIEW_STATUSES],
    };

    // P1 item 12.4: suspect queue ops filters (signal, score range,
    // reviewed status, cohort). Applied in-memory before pagination.
    const signalFilter = String(req.query.signal || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const minScore = req.query.minScore !== undefined && req.query.minScore !== ''
      ? Number(req.query.minScore) : null;
    const maxScore = req.query.maxScore !== undefined && req.query.maxScore !== ''
      ? Number(req.query.maxScore) : null;
    const reviewedFilter = String(req.query.reviewed || 'all').trim().toLowerCase();
    const cohortFilter = String(req.query.cohort || '').trim();
    const isOpenPair = (p) => !p.review || p.review.status === 'reviewed';

    pairs = pairs.filter((pair) => {
      if (signalFilter.length && !pair.signals.some((s) => signalFilter.includes(s.type))) return false;
      if (Number.isFinite(minScore) && pair.score < minScore) return false;
      if (Number.isFinite(maxScore) && pair.score > maxScore) return false;
      if (reviewedFilter === 'open' && !isOpenPair(pair)) return false;
      if (PAIR_REVIEW_STATUSES.includes(reviewedFilter) && pair.review?.status !== reviewedFilter) return false;
      if (cohortFilter && pair.cohort !== cohortFilter) return false;
      return true;
    });

    const total = pairs.length;
    const paged = pairs.slice(offset, offset + limit);

    // P1 item 11: every suspect-queue read is audit-logged with purpose +
    // approver + the sensitive fields served.
    await logOneTruthRead({
      readerAdminId: req.user.id,
      grants: req.oneTruthGrants,
      endpoint: 'one_truth_list_suspects',
      resultCount: paged.length,
      sensitiveFields: SENSITIVE_LIST_FIELDS,
      piiMasked: isAnalyst,
      req,
    });

    res.json({
      pairs: paged,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      scope: formatScopeMeta(scope),
      filterMeta,
      filters: {
        signal: signalFilter,
        minScore: Number.isFinite(minScore) ? minScore : null,
        maxScore: Number.isFinite(maxScore) ? maxScore : null,
        reviewed: reviewedFilter,
        cohort: cohortFilter || null,
      },
    });
  } catch (err) {
    sendOneTruthError(res, err, 'Failed to run duplicate detection');
  } finally {
    client.release();
  }
};

exports.getStats = async (req, res) => {
  const client = await pool.connect();
  try {
    const scope = await resolveScope(client, req);
    // P1 item 11/12.2: null for super-admins (unscoped); delegated analysts
    // are limited to the union of their active grants' scope_user_ids.
    const analystIds = req.oneTruthScopeIds || null;
    const response = {
      ...formatScopeMeta(scope),
      usersWithMultipleBusinesses: 0,
      flaggedPairs: 0,
      totalUsers: 0,
      inactiveUsers: 0,
      bannedUsers: 0,
      totalBusinesses: 0,
      inactiveBusinesses: 0,
      sections: {
        people: {},
        commerce: {},
        marketplace: {},
        support: {},
        rentals: {},
        consulting: {},
        money: {},
      },
      coverage: null,
    };

    const userScope = buildUserScopeClause(scope, 1);
    scope.warnings.push(...userScope.warnings);
    const userWhereParts = [
      `u.deleted_at IS NULL`,
      `u.role NOT IN ('admin','super_admin')`,
      userScope.clause,
    ].filter(Boolean);
    const userParams = [...userScope.params];
    withAnalystScope(userWhereParts, userParams, 'u.id', analystIds);

    const { rows: userRows } = await client.query(
      `SELECT COUNT(*)::int AS total_users,
              SUM(CASE WHEN u.is_active = false THEN 1 ELSE 0 END)::int AS inactive_users,
              SUM(CASE WHEN u.is_banned = true THEN 1 ELSE 0 END)::int AS banned_users,
              SUM(CASE WHEN COALESCE(u.identity_verified, false) = true THEN 1 ELSE 0 END)::int AS verified_users
       FROM users u
       WHERE ${userWhereParts.join(' AND ')}`,
      userParams
    );

    response.totalUsers = userRows[0]?.total_users || 0;
    response.inactiveUsers = userRows[0]?.inactive_users || 0;
    response.bannedUsers = userRows[0]?.banned_users || 0;
    response.sections.people = {
      totalUsers: response.totalUsers,
      activeUsers: Math.max(response.totalUsers - response.inactiveUsers, 0),
      inactiveUsers: response.inactiveUsers,
      bannedUsers: response.bannedUsers,
      verifiedUsers: userRows[0]?.verified_users || 0,
    };

    const businessScope = buildEntityScopeClause(scope, {
      country: 'b.address_country',
      state: 'b.address_state',
      city: 'b.address_city',
      zip: 'b.address_zip',
    }, 1);
    scope.warnings.push(...businessScope.warnings);
    const businessWhereParts = [
      `b.deleted_at IS NULL`,
      businessScope.clause,
    ].filter(Boolean);
    const businessParams = [...businessScope.params];
    withAnalystScope(businessWhereParts, businessParams, 'b.user_id', analystIds);

    const { rows: businessRows } = await client.query(
      `SELECT COUNT(*)::int AS total_businesses,
              SUM(CASE WHEN b.is_active = false THEN 1 ELSE 0 END)::int AS inactive_businesses,
              SUM(CASE WHEN b.is_active = true THEN 1 ELSE 0 END)::int AS active_businesses
       FROM businesses b
       WHERE ${businessWhereParts.join(' AND ')}`,
      businessParams
    );

    response.totalBusinesses = businessRows[0]?.total_businesses || 0;
    response.inactiveBusinesses = businessRows[0]?.inactive_businesses || 0;
    response.usersWithMultipleBusinesses = await countUsersWithMultipleBusinesses(client, scope, analystIds);
    response.sections.people.totalBusinesses = response.totalBusinesses;
    response.sections.people.activeBusinesses = businessRows[0]?.active_businesses || 0;
    response.sections.people.inactiveBusinesses = response.inactiveBusinesses;
    response.sections.people.usersWithMultipleBusinesses = response.usersWithMultipleBusinesses;

    if ((await client.query(tableExistsQuery('jobs'), ['jobs'])).rows[0]?.exists) {
      const jobScope = buildEntityScopeClause(scope, {
        country: 'j.location_country',
        state: 'j.location_state',
        city: 'j.location_city',
        zip: 'j.location_zip',
      }, 1);
      scope.warnings.push(...jobScope.warnings);
      const jobWhereParts = [jobScope.clause].filter(Boolean);
      const jobParams = [...jobScope.params];
      withAnalystScope(jobWhereParts, jobParams, ['j.client_id', 'j.assigned_helper_id'], analystIds);
      const jobWhere = jobWhereParts.length ? `WHERE ${jobWhereParts.join(' AND ')}` : '';
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total_jobs,
                COUNT(*) FILTER (WHERE status = 'published')::int AS open_jobs,
                COUNT(*) FILTER (WHERE status = 'in_progress')::int AS active_jobs,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_jobs,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_jobs
         FROM jobs j
         ${jobWhere}`,
        jobParams
      );
      response.sections.marketplace = {
        totalJobs: rows[0]?.total_jobs || 0,
        openJobs: rows[0]?.open_jobs || 0,
        activeJobs: rows[0]?.active_jobs || 0,
        completedJobs: rows[0]?.completed_jobs || 0,
        cancelledJobs: rows[0]?.cancelled_jobs || 0,
      };
    }

    if ((await client.query(tableExistsQuery('support_tickets'), ['support_tickets'])).rows[0]?.exists) {
      const supportScope = buildEntityScopeClause(scope, {
        country: 'u.country',
        state: 'u.state',
        city: 'u.city',
        zip: 'u.zip_code',
      }, 1);
      scope.warnings.push(...supportScope.warnings);
      const supportWhereParts = [`1 = 1`];
      const supportParams = [...supportScope.params];
      if (supportScope.clause) supportWhereParts.push(`(${supportScope.clause})`);
      withAnalystScope(supportWhereParts, supportParams, 'st.user_id', analystIds);
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total_tickets,
                COUNT(*) FILTER (WHERE st.status IN ('open', 'assigned', 'in_progress', 'waiting_user'))::int AS open_tickets,
                COUNT(*) FILTER (WHERE st.priority IN ('high', 'urgent'))::int AS escalated_tickets
         FROM support_tickets st
         LEFT JOIN users u ON u.id = st.user_id
         WHERE ${supportWhereParts.join(' AND ')}`,
        supportParams
      );
      response.sections.support = {
        totalTickets: rows[0]?.total_tickets || 0,
        openTickets: rows[0]?.open_tickets || 0,
        escalatedTickets: rows[0]?.escalated_tickets || 0,
      };
    }

    if ((await client.query(tableExistsQuery('tool_rentals'), ['tool_rentals'])).rows[0]?.exists) {
      const rentalScope = buildEntityScopeClause(scope, {
        country: 'u.country',
        state: 'tr.location_state',
        city: 'tr.location_city',
        zip: 'u.zip_code',
      }, 1);
      scope.warnings.push(...rentalScope.warnings);
      const rentalWhereParts = [rentalScope.clause].filter(Boolean);
      const rentalParams = [...rentalScope.params];
      withAnalystScope(rentalWhereParts, rentalParams, 'tr.user_id', analystIds);
      const rentalWhere = rentalWhereParts.length ? `WHERE ${rentalWhereParts.join(' AND ')}` : '';
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total_listings,
                COUNT(*) FILTER (WHERE tr.is_available = true)::int AS available_listings
         FROM tool_rentals tr
         LEFT JOIN users u ON u.id = tr.user_id
         ${rentalWhere}`,
        rentalParams
      );

      let activeBookings = 0;
      if ((await client.query(tableExistsQuery('tool_rentals_bookings'), ['tool_rentals_bookings'])).rows[0]?.exists) {
        const bookingWhereParts = [`tb.status IN ('pending', 'invoice_sent', 'payment_confirmed')`];
        const bookingParams = [];
        if (rentalScope.clause) {
          // Rebuild the rental scope params for this query's numbering.
          const reScope = buildEntityScopeClause(scope, {
            country: 'u.country',
            state: 'tr.location_state',
            city: 'tr.location_city',
            zip: 'u.zip_code',
          }, 1);
          if (reScope.clause) bookingWhereParts.push(`(${reScope.clause})`);
          bookingParams.push(...reScope.params);
        }
        withAnalystScope(bookingWhereParts, bookingParams, 'tr.user_id', analystIds);
        const { rows: bookingRows } = await client.query(
          `SELECT COUNT(*)::int AS active_bookings
           FROM tool_rentals_bookings tb
           JOIN tool_rentals tr ON tr.id = tb.tool_id
           LEFT JOIN users u ON u.id = tr.user_id
           WHERE ${bookingWhereParts.join(' AND ')}`,
          bookingParams
        );
        activeBookings = bookingRows[0]?.active_bookings || 0;
      }

      response.sections.rentals = {
        totalListings: rows[0]?.total_listings || 0,
        availableListings: rows[0]?.available_listings || 0,
        activeBookings,
      };
    }

    if ((await client.query(tableExistsQuery('marketplace_orders'), ['marketplace_orders'])).rows[0]?.exists) {
      const orderScope = buildEntityScopeClause(scope, {
        country: `COALESCE(NULLIF(UPPER(mo.shipping_address->>'country'), ''), UPPER(u.country))`,
        state: `COALESCE(mo.shipping_address->>'state', u.state)`,
        city: `COALESCE(mo.shipping_address->>'city', u.city)`,
        zip: `COALESCE(mo.shipping_address->>'zip', u.zip_code)`,
      }, 1);
      scope.warnings.push(...orderScope.warnings);
      const orderWhereParts = [orderScope.clause].filter(Boolean);
      const orderParams = [...orderScope.params];
      withAnalystScope(orderWhereParts, orderParams, 'mo.customer_id', analystIds);
      const orderWhere = orderWhereParts.length ? `WHERE ${orderWhereParts.join(' AND ')}` : '';
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total_orders,
                COUNT(*) FILTER (WHERE mo.status IN ('paid', 'processing', 'completed'))::int AS paid_orders
         FROM marketplace_orders mo
         LEFT JOIN users u ON u.id = mo.customer_id
         ${orderWhere}`,
        orderParams
      );
      // P1 item 14: currency-aware volume. Never sum mixed currencies under
      // one label: group by the stored currency (cents stay in cents).
      const { rows: volumeRows } = await client.query(
        `SELECT UPPER(mo.currency) AS currency,
                COALESCE(SUM(CASE WHEN mo.status IN ('paid', 'processing', 'completed') THEN mo.total_cents ELSE 0 END), 0)::bigint AS volume_cents
         FROM marketplace_orders mo
         LEFT JOIN users u ON u.id = mo.customer_id
         ${orderWhere}
         GROUP BY 1
         ORDER BY 1`,
        orderParams
      );
      response.sections.commerce = {
        totalOrders: rows[0]?.total_orders || 0,
        paidOrders: rows[0]?.paid_orders || 0,
        volumeByCurrency: volumeRows.map((r) => ({
          currency: r.currency,
          amountCents: parseInt(r.volume_cents, 10) || 0,
        })),
      };
    }

    if ((await client.query(tableExistsQuery('consulting_sessions'), ['consulting_sessions'])).rows[0]?.exists) {
      const consultingScope = buildEntityScopeClause(scope, {
        country: 'u.country',
        state: 'u.state',
        city: 'u.city',
        zip: 'u.zip_code',
      }, 1);
      scope.warnings.push(...consultingScope.warnings);
      const consultingWhereParts = [consultingScope.clause].filter(Boolean);
      const consultingParams = [...consultingScope.params];
      withAnalystScope(consultingWhereParts, consultingParams, 'cs.user_id', analystIds);
      const consultingWhere = consultingWhereParts.length ? `WHERE ${consultingWhereParts.join(' AND ')}` : '';
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total_sessions,
                COUNT(*) FILTER (WHERE cs.status = 'scheduled')::int AS scheduled_sessions,
                COUNT(*) FILTER (WHERE cs.status = 'completed')::int AS completed_sessions
         FROM consulting_sessions cs
         LEFT JOIN users u ON u.id = cs.user_id
         ${consultingWhere}`,
        consultingParams
      );
      response.sections.consulting = {
        totalSessions: rows[0]?.total_sessions || 0,
        scheduledSessions: rows[0]?.scheduled_sessions || 0,
        completedSessions: rows[0]?.completed_sessions || 0,
      };
    }

    if ((await client.query(tableExistsQuery('payments'), ['payments'])).rows[0]?.exists) {
      const paymentScope = buildEntityScopeClause(scope, {
        country: 'payer.country',
        state: 'payer.state',
        city: 'payer.city',
        zip: 'payer.zip_code',
      }, 1);
      scope.warnings.push(...paymentScope.warnings);
      const paymentWhereParts = [paymentScope.clause].filter(Boolean);
      const paymentParams = [...paymentScope.params];
      withAnalystScope(paymentWhereParts, paymentParams, ['p.payer_id', 'p.payee_id'], analystIds);
      const paymentWhere = paymentWhereParts.length ? `WHERE ${paymentWhereParts.join(' AND ')}` : '';
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total_payments,
                COUNT(*) FILTER (WHERE p.status IN ('pending', 'authorized'))::int AS pending_payments,
                COUNT(*) FILTER (WHERE p.status IN ('captured', 'released'))::int AS completed_payments
         FROM payments p
         JOIN users payer ON payer.id = p.payer_id
         ${paymentWhere}`,
        paymentParams
      );
      // P1 item 14: currency-aware volume. The old code hardcoded
      // 'USD' AS volume_currency while summing mixed rails, and read the
      // wrong result key (volume_amount vs volume_amount_dollars, so it
      // always rendered 0). Group by the stored currency instead; amounts
      // are NUMERIC major units (dollars), never mixed with cents.
      // The column default is 'usd', so a blank currency coalesces to USD.
      const { rows: volumeRows } = await client.query(
        `SELECT UPPER(COALESCE(NULLIF(TRIM(p.currency), ''), 'USD')) AS currency,
                COALESCE(SUM(CASE WHEN p.status IN ('captured', 'released') THEN p.amount ELSE 0 END), 0) AS volume_amount
         FROM payments p
         JOIN users payer ON payer.id = p.payer_id
         ${paymentWhere}
         GROUP BY 1
         ORDER BY 1`,
        paymentParams
      );
      response.sections.money = {
        totalPayments: rows[0]?.total_payments || 0,
        pendingPayments: rows[0]?.pending_payments || 0,
        completedPayments: rows[0]?.completed_payments || 0,
        volumeByCurrency: volumeRows.map((r) => ({
          currency: r.currency,
          amount: Number(r.volume_amount) || 0,
        })),
      };
    }

    const suspectScope = buildUserScopeClause(scope, 1);
    const suspectWhereParts = [
      `u.deleted_at IS NULL`,
      `u.role NOT IN ('admin', 'super_admin')`,
      suspectScope.clause,
    ].filter(Boolean);
    const suspectParams = [...suspectScope.params];
    withAnalystScope(suspectWhereParts, suspectParams, 'u.id', analystIds);
    const { rows: suspectUsers } = await client.query(
      `SELECT ${await buildUserSelect(client)}
       FROM users u
       WHERE ${suspectWhereParts.join(' AND ')}
       ORDER BY u.created_at ASC
       -- Keep the pairwise investigation bounded. A complete enterprise
       -- review must use an indexed/async suspect job rather than allowing a
       -- dashboard request to materialize the whole user table.
       LIMIT 5000`,
      suspectParams
    );
    if (suspectUsers.length >= 5000) {
      scope.warnings.push('Duplicate statistics are truncated at 5,000 users. Refine the scope for a complete review.');
    }
    const rawPairs = await buildSuspectPairsIndexed(client, suspectUsers.map((u) => u.id));
    response.flaggedPairs = rawPairs.length;
    response.warnings = Array.from(new Set(scope.warnings));

    // P1 item 12.1: coverage / pipeline watermark KPIs.
    const asOf = new Date().toISOString();
    const pairKeys = rawPairs.map((p) => pairKeyFor(p.userA.id, p.userB.id));
    const pairReviews = await getPairReviews(client, pairKeys);
    const openPairs = rawPairs.filter((p) => {
      const review = pairReviews.get(pairKeyFor(p.userA.id, p.userB.id));
      return !review || review.status === 'reviewed';
    }).length;
    const pairReviewCounts = { reviewed: 0, confirmed: 0, dismissed: 0, total: 0 };
    {
      const { rows: existsRows } = await client.query(
        tableExistsQuery('one_truth_pair_reviews'),
        ['one_truth_pair_reviews']
      );
      if (existsRows[0]?.exists) {
        const reviewParams = [];
        const reviewFilter = analystIds ? `WHERE user_a_id = ANY($1) AND user_b_id = ANY($1)` : '';
        if (analystIds) reviewParams.push(analystIds);
        const { rows: reviewRows } = await client.query(
          `SELECT status, COUNT(*)::int AS count FROM one_truth_pair_reviews ${reviewFilter} GROUP BY status`,
          reviewParams
        );
        for (const row of reviewRows) {
          if (row.status in pairReviewCounts) pairReviewCounts[row.status] = row.count;
          pairReviewCounts.total += row.count;
        }
      }
    }
    const fraud = await getFraudCaseStats(client, analystIds);
    response.coverage = {
      evaluatedUsers: suspectUsers.length,
      unevaluatedUsers: Math.max(response.totalUsers - suspectUsers.length, 0),
      totalPairs: response.flaggedPairs,
      openPairs,
      confirmedCases: fraud.resolved + pairReviewCounts.confirmed,
      pairReviews: pairReviewCounts,
      fraudCases: {
        open: fraud.open,
        investigating: fraud.investigating,
        resolved: fraud.resolved,
        dismissed: fraud.dismissed,
        total: fraud.total,
        // Fraud cases are platform records; they are not region-scoped.
        scope: 'platform',
      },
      sources: [
        {
          key: 'duplicate_detection',
          evaluatedUsers: suspectUsers.length,
          totalPairs: response.flaggedPairs,
          openPairs,
          asOf,
        },
        {
          key: 'fraud_cases',
          total: fraud.total,
          byStatus: {
            open: fraud.open,
            investigating: fraud.investigating,
            resolved: fraud.resolved,
            dismissed: fraud.dismissed,
          },
          bySource: fraud.bySource,
          asOf,
        },
      ],
      asOf,
    };

    // P1 item 11: per-read audit entry for the stats read (aggregate-level;
    // no per-user PII is served here).
    await logOneTruthRead({
      readerAdminId: req.user.id,
      grants: req.oneTruthGrants,
      endpoint: 'one_truth_stats',
      resultCount: response.totalUsers,
      sensitiveFields: ['aggregate_financials'],
      piiMasked: false,
      req,
    });

    res.json(response);
  } catch (err) {
    sendOneTruthError(res, err, 'Failed to load stats');
  } finally {
    client.release();
  }
};

exports.getUserDetail = async (req, res) => {
  const { userId } = req.params;
  const client = await pool.connect();
  try {
    // P1 item 11: super-admins pass by role; delegated analysts need an
    // active investigation grant covering this exact user id (mirrors the
    // E13 investigation profile endpoint). Fail closed otherwise.
    let grant = null;
    if (!req.isSuper) {
      const check = await checkInvestigationAccess(req.user.id, userId);
      if (!check.granted) {
        return res.status(403).json({
          error: 'Investigation access required: request a purpose-limited grant approved by an authorized approver.',
          code: 'investigation_access_required',
        });
      }
      grant = check.grant;
    }

    const userSelect = await buildUserSelect(client);

    const { rows: userRows } = await client.query(
      `SELECT ${userSelect} FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });

    const user = userRows[0];

    const { rows: businesses } = await client.query(
      `SELECT b.*,
              (SELECT COUNT(*) FROM jobs j WHERE j.business_id = b.id) AS job_count
       FROM businesses b
       WHERE b.user_id = $1
       ORDER BY b.created_at ASC`,
      [userId]
    );

    let loginHistory = [];
    const { rows: hasHistory } = await client.query(tableExistsQuery('user_login_history'), ['user_login_history']);
    if (hasHistory[0]?.exists) {
      const { rows } = await client.query(
        `SELECT * FROM user_login_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [userId]
      );
      loginHistory = rows;
    }

    // P1 item 11: every elevated detail read is audit-logged with purpose +
    // approver (+ expiry + scoped ids inside the grant payload).
    await logInvestigationRead({
      readerAdminId: req.user.id,
      targetUserId: userId,
      grant,
      endpoint: 'one_truth_user_detail',
      req,
    });

    res.json({ user, businesses, loginHistory });
  } catch (err) {
    sendOneTruthError(res, err, 'Failed to load user detail');
  } finally {
    client.release();
  }
};

/**
 * POST /admin/one-truth/access-request
 *
 * P1 item 12.5: the "request investigation access" action for non-granted
 * analysts. Any admin may file the request; the grant still starts
 * 'pending' and only the named approver (a super-admin or manage_users
 * holder, never the requester) can activate it. Emails in the scope are
 * resolved to user ids; the approver is named by email and resolved
 * server-side with a generic error so admin emails are not enumerable.
 */
exports.requestOneTruthAccess = async (req, res, next) => {
  try {
    const body = req.body || {};
    const approverEmail = String(body.approver_email || body.approverEmail || '').trim();
    const purpose = body.purpose;
    const investigationRef = body.investigation_ref || body.investigationRef;
    const expiresAt = body.expires_at || body.expiresAt;
    let scopeEntries = body.scope_user_ids || body.scopeUserIds || body.scope || [];
    if (typeof scopeEntries === 'string') scopeEntries = scopeEntries.split(/[,\n]+/);

    const ids = [];
    const emails = [];
    for (const entry of scopeEntries) {
      const s = String(entry || '').trim();
      if (!s) continue;
      if (UUID_RE.test(s)) ids.push(s);
      else if (s.includes('@')) emails.push(s.toLowerCase());
    }
    if (emails.length) {
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE LOWER(email) = ANY($1) AND deleted_at IS NULL`,
        [emails]
      );
      for (const row of rows) ids.push(row.id);
    }
    const scopeUserIds = [...new Set(ids)];

    if (!approverEmail) {
      return res.status(400).json({ error: 'An approver email is required.', code: 'approver_required' });
    }
    const { rows: approverRows } = await pool.query(
      `SELECT id FROM users
        WHERE LOWER(email) = LOWER($1)
          AND role IN ('admin', 'super_admin')
          AND is_active = true
          AND deleted_at IS NULL
        LIMIT 1`,
      [approverEmail]
    );
    if (!approverRows.length) {
      return res.status(400).json({
        error: 'Approver not found or not authorized to approve investigation access.',
        code: 'approver_not_authorized',
      });
    }

    const grant = await requestInvestigationAccess({
      requesterId: req.user.id,
      approverId: approverRows[0].id,
      purpose,
      scopeUserIds,
      investigationRef,
      expiresAt,
      grantScope: 'fraud_analyst',
    });
    return res.status(201).json({ grant });
  } catch (err) {
    if (err instanceof InvestigationAccessError) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    return next(err);
  }
};

/**
 * POST /admin/one-truth/pairs/review
 *
 * P1 item 12.4: persist analyst triage of a suspect pair. Super-admins may
 * review any pair; delegated analysts only pairs inside their grant scope.
 * The write is audit-logged.
 */
exports.reviewSuspectPair = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userAId, userBId, status, notes } = req.body || {};
    if (!PAIR_REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Status must be one of: ${PAIR_REVIEW_STATUSES.join(', ')}.`,
        code: 'invalid_review_status',
      });
    }
    const aRaw = String(userAId || '');
    const bRaw = String(userBId || '');
    if (!UUID_RE.test(aRaw) || !UUID_RE.test(bRaw) || aRaw.toLowerCase() === bRaw.toLowerCase()) {
      return res.status(400).json({
        error: 'Two distinct user ids are required.',
        code: 'invalid_pair',
      });
    }
    const [a, b] = [aRaw, bRaw].sort();
    if (
      req.oneTruthScopeIds &&
      (!req.oneTruthScopeIds.includes(a) || !req.oneTruthScopeIds.includes(b))
    ) {
      return res.status(403).json({
        error: 'This pair is outside your investigation grant scope.',
        code: 'grant_scope_exceeded',
      });
    }
    const { rows: existsRows } = await client.query(
      tableExistsQuery('one_truth_pair_reviews'),
      ['one_truth_pair_reviews']
    );
    if (!existsRows[0]?.exists) {
      return res.status(503).json({
        error: 'Pair reviews are unavailable (pending migration).',
        code: 'reviews_unavailable',
      });
    }

    const pairKey = `${a}:${b}`;
    const { rows } = await client.query(
      `INSERT INTO one_truth_pair_reviews
         (pair_key, user_a_id, user_b_id, status, reviewed_by, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (pair_key) DO UPDATE SET
         status = EXCLUDED.status,
         reviewed_by = EXCLUDED.reviewed_by,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [pairKey, a, b, status, req.user.id, String(notes || '').slice(0, 2000) || null]
    );

    await logAdminAction({
      adminId: req.user.id,
      action: 'one_truth_pair_reviewed',
      targetType: 'one_truth_pair',
      targetKey: pairKey,
      description: `Marked suspect pair ${pairKey} as ${status}`,
      after: { status, notes: String(notes || '').slice(0, 500) || null },
      req,
    });

    return res.json({ review: rows[0] });
  } catch (err) {
    sendOneTruthError(res, err, 'Failed to save pair review');
  } finally {
    client.release();
  }
};
