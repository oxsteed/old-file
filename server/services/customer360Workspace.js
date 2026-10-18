"use strict";
const db = require("../db");
const { sources } = require("./customer360Sources");
const { hasGlobalGrant } = require("../middleware/adminAuth");
const { logAdminAction } = require("./auditService");
const {
  deriveHelperOnboarding,
  ONBOARDING_COLUMNS,
} = require("./helperOnboarding");
const {
  isDiditIdentitySatisfied,
  isDiditVerificationFresh,
} = require("../utils/diditGate");
const AppError = require("../utils/appError");
const logger = require("../utils/logger");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTENTION = new Set([
  "failed",
  "past_due",
  "overdue",
  "under_review",
  "open",
  "pending",
  "conflict",
  "unpaid_review",
  "blocked",
  "needs_review",
]);
const ROLES = new Set(["helper", "helper_pro", "broker"]);

function filters(query = {}) {
  const integer = (value, fallback, min, max) => {
    if (value === undefined || value === "") return fallback;
    if (
      !/^\d+$/.test(String(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      throw new AppError("Invalid pagination", 400, "invalid_pagination");
    return Number(value);
  };
  const date = (v) => {
    if (!v) return null;
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v
    )
      throw new AppError("Invalid date", 400, "invalid_date");
    return v;
  };
  const from = date(query.from),
    to = date(query.to);
  if (from && to && from > to)
    throw new AppError("Invalid date range", 400, "invalid_date_range");
  return {
    from,
    to,
    q: String(query.q || "")
      .trim()
      .slice(0, 120),
    limit: integer(query.limit, 5, 1, 100),
    offset: integer(query.offset, 0, 0, 100000),
    status: String(query.status || "").slice(0, 60),
  };
}
async function target(req) {
  const id = req.params.userId;
  if (!UUID.test(String(id)))
    throw new AppError("Invalid user id", 400, "invalid_user_id");
  const {
    rows: [user],
  } = await db.query(
    `SELECT ${ONBOARDING_COLUMNS}, didit_enforcement_required, didit_verified_at, is_active, is_suspended, is_restricted, w9_completed, (lower(email) LIKE '%@oxsteed.internal') AS is_internal, membership_tier, last_login_at FROM users WHERE id=$1::uuid`,
    [id],
  );
  if (
    !user ||
    id.toLowerCase() === "00000000-0000-4000-8000-000000000001" ||
    user.is_internal
  )
    throw new AppError("User not found", 404, "not_found");
  if (
    ["admin", "super_admin"].includes(user.role) &&
    req.user?.role !== "super_admin"
  )
    throw new AppError(
      "Cannot view admin account details",
      403,
      "permission_denied",
    );
  return user;
}
function access(req) {
  const grants = new Map();
  return async (definition) => {
    if (req.user?.role === "super_admin") return true;
    if (definition.superOnly) return false;
    if (!grants.has(definition.grant))
      grants.set(
        definition.grant,
        hasGlobalGrant(req.user.id, definition.grant),
      );
    return grants.get(definition.grant);
  };
}
async function readSource(definition, userId, filter, runner = db) {
  // Definition is a server allowlist; every client input remains a bind value.
  // Counts, currency/status groups, and page share one statement snapshot.
  const {
    rows: [result],
  } = await runner.query(
    `WITH scoped AS (${definition.sql}), filtered AS (
    SELECT * FROM scoped WHERE ($2::date IS NULL OR occurred_at >= $2::date)
      AND ($3::date IS NULL OR occurred_at < $3::date+interval '1 day')
      AND ($4::text='' OR strpos(lower(concat_ws(' ',label,id,status,to_jsonb(scoped)->>'reference',to_jsonb(scoped)->>'reference_id',to_jsonb(scoped)->>'provider_reference',to_jsonb(scoped)->>'correlation_id',to_jsonb(scoped)->>'job_id',to_jsonb(scoped)->>'business_id',to_jsonb(scoped)->>'restaurant_id',to_jsonb(scoped)->>'shipment_id')),lower($4))>0)
      AND ($7::text='' OR status=$7)
  ), page AS (SELECT * FROM filtered ORDER BY occurred_at DESC NULLS LAST,id DESC LIMIT $5 OFFSET $6),
  groups AS (SELECT status,to_jsonb(f)->>'participant_role' AS participant_role,COALESCE(to_jsonb(f)->>'currency_code','') AS currency_code,COUNT(*)::int AS count,
    SUM(NULLIF(to_jsonb(f)->>'amount_major','')::numeric)::text AS recorded_amount_major, SUM(NULLIF(to_jsonb(f)->>'amount_cents','')::numeric)::text AS recorded_amount_cents FROM filtered f GROUP BY status,to_jsonb(f)->>'participant_role',COALESCE(to_jsonb(f)->>'currency_code',''))
  SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
    COALESCE((SELECT json_agg((SELECT jsonb_object_agg(e.key,CASE
      WHEN e.key ~ '(_cents|_major|_id)$' AND e.value<>'null'::jsonb THEN to_jsonb(e.value #>> '{}')
      ELSE e.value END) FROM jsonb_each(to_jsonb(p)) e)
      ORDER BY occurred_at DESC NULLS LAST,id DESC) FROM page p),'[]') AS records,
    COALESCE((SELECT json_agg(g) FROM groups g),'[]') AS groups,
    (SELECT json_build_object('firstAt',MIN(occurred_at),'lastAt',MAX(occurred_at),
      'activeDays',COUNT(DISTINCT occurred_at::date),'last30Count',COUNT(*) FILTER(WHERE occurred_at>=now()-interval '30 days'),
      'ratingCount',COUNT(NULLIF(to_jsonb(f)->>'rating','')),'averageRating',AVG(NULLIF(to_jsonb(f)->>'rating','')::numeric)) FROM filtered f) AS statistics`,
    [
      userId,
      filter.from,
      filter.to,
      filter.q,
      filter.limit,
      filter.offset,
      filter.status,
    ],
  );
  if (["memberships", "businesses"].includes(definition.key)) {
    for (const record of result.records) {
      const owned =
        definition.key === "businesses" &&
        String(record.owner_user_id) === String(userId);
      const active =
        definition.key === "memberships" && record.status === "active";
      if (!owned && !active) continue;
      try {
        const resolved =
          await require("./permissionsService").getEffectivePermissions({
            businessId: owned ? record.id : record.business_id,
            userId,
            role: owned ? "owner" : String(record.role).toLowerCase(),
            membershipId: owned ? undefined : record.id,
          });
        record.effective_permissions = [...resolved.permissions].sort();
      } catch {
        record.permissions_state = "unavailable";
      }
    }
  }
  return {
    key: definition.key,
    area: definition.area,
    source: definition.table,
    route: definition.route,
    recordRoute: definition.recordRoute || null,
    state: "ready",
    total: Number(result.total),
    records: result.records,
    groups: result.groups,
    statistics: result.statistics,
    offset: filter.offset,
    limit: filter.limit,
    hasMore: filter.offset + result.records.length < Number(result.total),
    fetchedAt: new Date().toISOString(),
  };
}
function eligibility(user) {
  const facts = deriveHelperOnboarding(user),
    helper = ROLES.has(user.role);
  return {
    role: user.role,
    accountAccess: {
      settings: true,
      statements: "authorized_accounts",
      support: true,
      verification: true,
    },
    helper: {
      applicable: helper,
      steps: facts.steps,
      missing: facts.missing,
      listing: helper && !!user.onboarding_completed && facts.canAppearInSearch,
      work: helper && facts.complete,
      finalized: !!user.onboarding_completed,
    },
    identity: {
      verified: !!(user.id_verified || user.identity_verified),
      diditStatus: user.didit_status,
      diditRequired: !!user.didit_enforcement_required,
      diditGateSatisfied: isDiditIdentitySatisfied(user),
      diditFresh: isDiditVerificationFresh(user.didit_verified_at),
    },
    payout: {
      taxComplete: !!user.w9_completed,
      diditFresh: isDiditVerificationFresh(user.didit_verified_at),
    },
    restrictions: {
      active: !!user.is_active,
      suspended: !!user.is_suspended,
      restricted: !!user.is_restricted,
    },
    membershipTier: user.membership_tier,
    lastLoginAt: user.last_login_at,
    background: facts.steps.background,
  };
}
async function workspace(req) {
  const user = await target(req),
    filter = filters(req.query),
    can = access(req);
  const names = req.query.source
    ? [String(req.query.source)]
    : Object.keys(sources);
  if (names.some((name) => !sources[name]))
    throw new AppError("Unknown source", 400, "invalid_source");
  const sections = {};
  let cursor = 0;
  // Bound fanout rather than flooding the shared production connection pool.
  await Promise.all(
    Array.from({ length: Math.min(4, names.length) }, async () => {
      while (cursor < names.length) {
        const key = names[cursor++],
          def = sources[key];
        if (!(await can(def))) {
          sections[key] = {
            key,
            area: def.area,
            source: def.table,
            state: "restricted",
          };
          continue;
        }
        try {
          sections[key] = await readSource(def, user.id, filter);
        } catch (error) {
          logger.warn("Customer 360 source unavailable", {
            source: key,
            code: error.code,
          });
          sections[key] = {
            key,
            area: def.area,
            source: def.table,
            state: "unavailable",
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    }),
  );
  const attention = Object.values(sections)
    .filter((s) => s.state === "ready")
    .flatMap((s) =>
      s.records
        .filter(
          (r) =>
            ATTENTION.has(String(r.status)) ||
            (r.due_at &&
              new Date(r.due_at) < new Date() &&
              !["completed", "cancelled"].includes(r.status)) ||
            r.sla_first_response_breached ||
            r.sla_resolution_breached ||
            r.conflict_code,
        )
        .map((r) => ({
          source: s.key,
          id: r.id,
          label: r.label,
          status: r.status,
          dueAt: r.due_at || r.sla_due_at || null,
          route: s.route,
        })),
    );
  await logAdminAction({
    adminId: req.user.id,
    action: "customer360_workspace_read",
    targetType: "user",
    targetId: user.id,
    description: JSON.stringify({
      sources: names,
      from: filter.from,
      to: filter.to,
    }),
    req,
    throwOnError: true,
  });
  return {
    userId: user.id,
    viewerId: req.user.id,
    generatedAt: new Date().toISOString(),
    filters: filter,
    sections,
    eligibility: eligibility(user),
    attention,
    partial: Object.values(sections).some(
      (s) => s.state !== "ready" || s.hasMore,
    ),
  };
}
function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
module.exports = {
  sources,
  filters,
  target,
  access,
  readSource,
  eligibility,
  workspace,
  csvCell,
  UUID,
  ATTENTION,
};
