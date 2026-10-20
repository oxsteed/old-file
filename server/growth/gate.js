"use strict";
const db = require("../db");
const { key } = require("./identity");
const PURPOSES = new Set([
  "activity",
  "activity_offers",
  "partner_offers",
  "offer_push",
]);
const denied = (reason) => ({ allowed: false, reason });
function rolloutAllows(ctx, now = Date.now(), env = process.env) {
  if (env.GROWTH_TRACKING_HARD_OFF !== "false") return denied("hard_off");
  if (!ctx.enabled) return denied("switch_off");
  const r = ctx.rollout,
    date = Date.parse(r?.effective_at);
  if (
    !r ||
    r.state !== "effective" ||
    !Number.isFinite(date) ||
    date > now ||
    !r.legal_review_ref ||
    r.translations_reviewed !== true ||
    r.rights_verified !== true
  )
    return denied("rollout_not_effective");
  return { allowed: true };
}

function resolveJurisdiction(signals, rules) {
  const byCode = new Map(rules.map((r) => [r.code, r]));
  const selected = signals
    .filter(
      (s) => s === "unknown" || /^[A-Z]{2}(?:-[A-Z0-9]{1,8})?$/.test(s || ""),
    )
    .map(
      (code) =>
        byCode.get(code) ||
        byCode.get(code.split("-")[0]) ||
        byCode.get("default"),
    );
  if (!selected.length) selected.push(byCode.get("unknown"));
  if (selected.some((r) => !r || !r.reviewed_at))
    return {
      code: "unknown",
      basis: "consent",
      offersBasis: "consent",
      saleShare: true,
      reviewed: false,
    };
  return {
    code: [...new Set(selected.map((r) => r.code))].sort().join("+"),
    basis: selected.some((r) => r.activity_basis === "consent")
      ? "consent"
      : "notice",
    offersBasis: selected.some((r) => r.offers_basis === "consent")
      ? "consent"
      : "notice",
    saleShare: selected.some((r) => r.sale_share_control),
    reviewed: true,
  };
}

// The pure decision is shared by HTTP ingestion, domain outbox, writers,
// profile builders and delivery. Callers cannot assert consent in a payload.
function decide(
  ctx,
  purpose = "activity",
  now = Date.now(),
  env = process.env,
) {
  if (!PURPOSES.has(purpose)) return denied("unknown_purpose");
  const availability = rolloutAllows(ctx, now, env);
  if (!availability.allowed) return availability;
  if (!ctx.user?.id || !ctx.eligibility?.adult_confirmed)
    return denied("age_or_identity_unknown");
  if (
    !ctx.user.is_active ||
    ctx.user.is_banned ||
    ctx.user.deleted_at ||
    ctx.user.is_suspended ||
    ctx.eligibility.is_internal ||
    ctx.impersonated ||
    !require("./roles").canonicalRole(ctx.user.role)
  )
    return denied("excluded_subject");
  if (!ctx.jurisdiction.reviewed) return denied("jurisdiction_unreviewed");
  const { basis, offersBasis, saleShare } = ctx.jurisdiction;
  if (ctx.consents.activity === false) return denied("activity_withdrawn");
  if (purpose !== "activity" && ctx.consents.activity_offers === false)
    return denied("offers_withdrawn");
  if (basis === "consent" && ctx.consents.activity !== true)
    return denied("activity_consent_required");
  if (
    purpose !== "activity" &&
    offersBasis === "consent" &&
    ctx.consents.activity_offers !== true
  )
    return denied("offers_consent_required");
  if (
    purpose === "partner_offers" &&
    saleShare &&
    (ctx.gpc || ctx.consents.sale_share_optout === true)
  )
    return denied("sale_share_optout");
  if (purpose === "offer_push" && ctx.consents.offer_push !== true)
    return denied("push_optin_required");
  return { allowed: true, basis, jurisdiction: ctx.jurisdiction.code };
}

async function runtimePolicy(conn = db, { lockPolicy = false } = {}) {
  const lock = lockPolicy ? " FOR SHARE" : "";
  const { rows: settings } = await conn.query(
    "SELECT key,value FROM platform_settings WHERE key IN ('growth.activity_tracking_enabled','growth.jurisdiction_rules')" +
      lock,
  );
  const { rows: rollouts } = await conn.query(
    "SELECT * FROM activity_tracking_rollout WHERE id=1" + lock,
  );
  const rules = await require("./jurisdictions").load(conn);
  return {
    enabled:
      settings.find((s) => s.key === "growth.activity_tracking_enabled")
        ?.value === "true",
    rollout: rollouts[0],
    rules,
  };
}
async function contexts(
  userIds,
  { req, trustedSignals = [], db: conn = db, lockPolicy = false } = {},
) {
  const policy = await runtimePolicy(conn, { lockPolicy }),
    rules = policy.rules;
  const ids = [...new Set(userIds.filter(Boolean))];
  const users = ids.length
    ? (
        await conn.query(
          `SELECT u.id,u.role,u.is_active,u.is_banned,u.deleted_at,u.is_suspended,
    u.country,u.country_confirmed,u.city,u.state,u.zip_code,u.preferred_language,u.created_at,
    e.adult_confirmed,e.is_internal FROM users u LEFT JOIN growth_subject_eligibility e ON e.user_id=u.id WHERE u.id=ANY($1::uuid[])`,
          [ids],
        )
      ).rows
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const keys = new Map(ids.map((id) => [id, key("subject", id)]));
  const choices = ids.length
    ? (
        await conn.query(
          `SELECT c.subject_key,c.purpose,c.granted,h.consent_text_version
    FROM tracking_consent_current c JOIN tracking_consents h ON h.id=c.consent_id WHERE c.subject_key=ANY($1::char(64)[])`,
          [[...keys.values()]],
        )
      ).rows
    : [];
  const byKey = new Map();
  for (const choice of choices) {
    if (
      choice.granted &&
      choice.purpose !== "sale_share_optout" &&
      choice.consent_text_version !== policy.rollout?.policy_version
    )
      continue;
    const current = byKey.get(choice.subject_key) || {};
    current[choice.purpose] = choice.granted;
    byKey.set(choice.subject_key, current);
  }
  const result = new Map();
  for (const id of [...new Set(userIds)]) {
    const user = byId.get(id) || null;
    const signals = require("./jurisdictionSignals").signalsFor(user, {
      req,
      trustedSignals:
        trustedSignals instanceof Map
          ? trustedSignals.get(id) || []
          : trustedSignals,
    });
    const subjectKey = keys.get(id);
    result.set(id, {
      enabled: policy.enabled,
      rollout: policy.rollout,
      user,
      eligibility: user || {},
      subjectKey,
      consents: byKey.get(subjectKey) || {},
      impersonated: Boolean(
        req?.isImpersonated ||
          req?.impersonatedBy ||
          req?.user?.internal_access_id,
      ),
      gpc:
        req?.headers?.["sec-gpc"] === "1" ||
        req?.headers?.["x-growth-gpc"] === "1",
      jurisdiction: resolveJurisdiction(signals, rules),
      trustedSignals: signals,
    });
  }
  return result;
}
async function context(options = {}) {
  return (await contexts([options.userId], options)).get(options.userId);
}
async function allow(input, purpose = "activity") {
  try {
    const ctx = input?.consents ? input : await context(input);
    return { ...decide(ctx, purpose), context: ctx };
  } catch (error) {
    // A failed query aborts PostgreSQL transactions. Propagate instead of
    // returning a denial and letting COMMIT silently roll back a business write.
    if (input?.db && typeof input.db.release === "function") throw error;
    return denied("gate_unavailable");
  }
}
module.exports = {
  allow,
  context,
  contexts,
  runtimePolicy,
  rolloutAllows,
  decide,
  resolveJurisdiction,
};
