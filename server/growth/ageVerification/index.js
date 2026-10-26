"use strict";
// D-ENG-06 / D19: provider-agnostic age verification for growth tracking.
//
// Safe default: nothing here marks anyone as an adult unless an operator has
// explicitly enabled a method. With the defaults
//   GROWTH_AGE_VERIFICATION_PROVIDER=none
//   GROWTH_AGE_SELF_ATTESTATION=off
// every subject stays adult_confirmed=false and the tracking gate denies them
// ("age_or_identity_unknown"), exactly like before this module existed.
//
// Self-attestation is a legal/policy decision, not an engineering one. It is
// only honoured when GROWTH_AGE_SELF_ATTESTATION is exactly "on", and each
// attestation stores the attestation text version the user saw.
const crypto = require("crypto");
const providers = require("./providers");

const OUTCOMES = new Set(["adult", "not_adult", "unknown"]);
const EXCLUDED_ROLES = new Set(["admin", "super_admin"]);

function selfAttestationEnabled(env = process.env) {
  return env.GROWTH_AGE_SELF_ATTESTATION === "on";
}

function attestationVersion(env = process.env) {
  return String(env.GROWTH_AGE_ATTESTATION_VERSION || "age-attest-v1").slice(0, 40);
}

function hashReference(reference) {
  if (reference == null || reference === "") return null;
  return crypto.createHash("sha256").update(String(reference)).digest("hex");
}

function status(env = process.env) {
  const provider = providers.active(env);
  return {
    provider: provider.name,
    provider_available: provider.name !== "none" && provider.available() === true,
    self_attestation: selfAttestationEnabled(env),
    attestation_version: attestationVersion(env),
  };
}

async function subjectKey(userId) {
  return require("../identity").key("subject", userId);
}

/**
 * Records one age decision and updates the gate input in the same
 * transaction. Anything other than an "adult" outcome clears
 * adult_confirmed and erases growth data, mirroring the admin route.
 */
async function recordOutcome(conn, { userId, method, provider = null, outcome, reference = null, attestation = null, actorId = null, reason = null }) {
  if (!OUTCOMES.has(outcome)) throw Object.assign(new Error("invalid_age_outcome"), { statusCode: 400, code: "invalid_age_outcome" });
  if (!["provider", "self_attestation", "backfill"].includes(method))
    throw Object.assign(new Error("invalid_age_method"), { statusCode: 400, code: "invalid_age_method" });
  const { rows: [user] } = await conn.query("SELECT role FROM users WHERE id=$1", [userId]);
  if (!user) throw Object.assign(new Error("user_not_found"), { statusCode: 404, code: "user_not_found" });
  if (EXCLUDED_ROLES.has(user.role)) throw Object.assign(new Error("excluded_subject"), { statusCode: 409, code: "excluded_subject" });

  const adult = outcome === "adult";
  const storedMethod = method === "backfill" ? "provider" : method;
  const { rows: [prior] } = await conn.query(
    "SELECT adult_confirmed, is_internal FROM growth_subject_eligibility WHERE user_id=$1 FOR UPDATE",
    [userId],
  );
  // "unknown" never downgrades an adult already confirmed by another method.
  if (outcome === "unknown" && prior?.adult_confirmed) {
    await conn.query(
      `INSERT INTO growth_age_verification_events (user_id, method, provider, outcome, reference_hash, attestation_version, actor_id, reason)
       VALUES ($1,$2,$3,'unknown',$4,$5,$6,$7)`,
      [userId, method, provider, hashReference(reference), attestation, actorId, reason],
    );
    return { adult_confirmed: true, changed: false };
  }
  await conn.query(
    `INSERT INTO growth_subject_eligibility
       (user_id, adult_confirmed, is_internal, evidence_ref, reviewed_at, subject_key,
        verification_method, verification_provider, attestation_version, verified_at, revoked_at)
     VALUES ($1,$2,FALSE,$3,NOW(),$4,$5,$6,$7,CASE WHEN $2 THEN NOW() END,NULL)
     ON CONFLICT (user_id) DO UPDATE SET
       adult_confirmed = EXCLUDED.adult_confirmed,
       evidence_ref = EXCLUDED.evidence_ref,
       reviewed_at = NOW(),
       verification_method = EXCLUDED.verification_method,
       verification_provider = EXCLUDED.verification_provider,
       attestation_version = EXCLUDED.attestation_version,
       verified_at = EXCLUDED.verified_at,
       revoked_at = NULL`,
    [userId, adult, `${storedMethod}:${provider || "self"}`, await subjectKey(userId), storedMethod, provider, attestation],
  );
  await conn.query(
    `INSERT INTO growth_age_verification_events (user_id, method, provider, outcome, reference_hash, attestation_version, actor_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [userId, method, provider, outcome, hashReference(reference), attestation, actorId, reason],
  );
  if (!adult || prior?.is_internal)
    await require("../rights").erase(conn, userId, "eligibility_removed");
  return { adult_confirmed: adult && !prior?.is_internal, changed: Boolean(prior?.adult_confirmed) !== adult };
}

async function selfAttest(conn, userId, { adult, version }, env = process.env) {
  if (!selfAttestationEnabled(env))
    throw Object.assign(new Error("age_self_attestation_disabled"), { statusCode: 404, code: "age_self_attestation_disabled" });
  if (version !== attestationVersion(env))
    throw Object.assign(new Error("age_attestation_version_mismatch"), { statusCode: 409, code: "age_attestation_version_mismatch" });
  return recordOutcome(conn, {
    userId,
    method: "self_attestation",
    outcome: adult === true ? "adult" : "not_adult",
    attestation: version,
    actorId: userId,
  });
}

/**
 * User or admin withdraws an age decision: tracking stops and growth data is
 * erased. rights.erase() deletes the eligibility row itself (no row = not
 * confirmed); the append-only event keeps the withdrawal on record so the
 * backfill never re-verifies this user.
 */
async function revoke(conn, userId, { actorId = null, reason = "withdrawn" } = {}) {
  await conn.query(
    `UPDATE growth_subject_eligibility
        SET adult_confirmed = FALSE, revoked_at = NOW(), reviewed_at = NOW()
      WHERE user_id = $1`,
    [userId],
  );
  await conn.query(
    `INSERT INTO growth_age_verification_events (user_id, method, outcome, actor_id, reason)
     VALUES ($1,'revocation','revoked',$2,$3)`,
    [userId, actorId, String(reason).slice(0, 200)],
  );
  await require("../rights").erase(conn, userId, "eligibility_removed");
  return { adult_confirmed: false };
}

async function handleProviderCallback(conn, providerName, req, env = process.env) {
  const provider = providers.active(env);
  if (provider.name === "none" || provider.name !== providerName || provider.available() !== true)
    throw Object.assign(new Error("age_verification_unavailable"), { statusCode: 404, code: "age_verification_unavailable" });
  const parsed = await provider.parseCallback(req);
  return recordOutcome(conn, {
    userId: parsed.userId,
    method: "provider",
    provider: provider.name,
    outcome: parsed.outcome,
    reference: parsed.reference,
  });
}

/**
 * Backfill: asks the active provider about subjects that are not yet
 * confirmed. Dry run by default. Refuses to run with "none" or with a
 * provider that has no bulk lookup; never infers age from activity.
 */
async function backfill(conn, { apply = false, limit = 500, env = process.env } = {}) {
  const provider = providers.active(env);
  if (provider.name === "none" || provider.available() !== true)
    return { mode: apply ? "apply" : "dry_run", ran: false, reason: "no_age_provider_configured", provider: provider.name };
  if (typeof provider.lookupBatch !== "function")
    return { mode: apply ? "apply" : "dry_run", ran: false, reason: "provider_has_no_bulk_lookup", provider: provider.name };
  const { rows } = await conn.query(
    `SELECT u.id FROM users u
       LEFT JOIN growth_subject_eligibility e ON e.user_id = u.id
      WHERE COALESCE(e.adult_confirmed, FALSE) = FALSE
        -- a user who withdrew is never re-verified behind their back
        AND NOT EXISTS (SELECT 1 FROM growth_age_verification_events v
                         WHERE v.user_id = u.id AND v.outcome = 'revoked')
        AND u.role NOT IN ('admin','super_admin')
      ORDER BY u.id
      LIMIT $1`,
    [Math.max(1, Math.min(Number(limit) || 500, 5000))],
  );
  const results = await provider.lookupBatch(rows.map((r) => r.id));
  const summary = { mode: apply ? "apply" : "dry_run", ran: true, provider: provider.name, candidates: rows.length, adult: 0, not_adult: 0, unknown: 0 };
  const wanted = new Set(rows.map((r) => r.id));
  for (const r of results || []) {
    if (!wanted.has(r.userId) || !OUTCOMES.has(r.outcome)) continue;
    summary[r.outcome] += 1;
    if (apply)
      await recordOutcome(conn, { userId: r.userId, method: "backfill", provider: provider.name, outcome: r.outcome, reference: r.reference, reason: "backfill" });
  }
  return summary;
}

async function subjectStatus(conn, userId, env = process.env) {
  const { rows: [row] } = await conn.query(
    "SELECT adult_confirmed, verification_method, attestation_version, revoked_at FROM growth_subject_eligibility WHERE user_id=$1",
    [userId],
  );
  return {
    ...status(env),
    adult_confirmed: Boolean(row?.adult_confirmed),
    method: row?.verification_method || null,
    attested_version: row?.attestation_version || null,
    revoked: Boolean(row?.revoked_at),
  };
}

module.exports = {
  status,
  subjectStatus,
  selfAttestationEnabled,
  attestationVersion,
  recordOutcome,
  selfAttest,
  revoke,
  handleProviderCallback,
  backfill,
  hashReference,
  providers,
};
