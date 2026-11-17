'use strict';

/**
 * Progressive account access — persistence and transitions.
 *
 * Every mutation runs in one transaction that locks the exact request row,
 * checks the expected version, re-resolves authority, validates against the
 * current policy, writes the immutable decision, creates/updates the grant,
 * bumps the projection version and enqueues the outbox event before COMMIT
 * (spec: "Transition concurrency and retry behavior").
 *
 * Errors are AppError(message, status, code) using the codes documented in
 * docs/progressive-access/HANDOFF.md.
 */

const crypto = require('crypto');
const pool = require('../../db');
const AppError = require('../../utils/appError');
const registry = require('./policyRegistry');
const lifecycle = require('./lifecycle');
const resolver = require('./resolver');

const MAX_PAGE = 50;

function err(status, code, message, extra) {
  const e = new AppError(message, status, code);
  if (extra) Object.assign(e, extra);
  return e;
}

// ── safe internal return targets ────────────────────────────────────────────
const RETURN_PREFIXES = Object.freeze([
  '/jobs', '/dashboard', '/home', '/account', '/settings', '/business', '/business-hub',
  '/restaurants', '/restaurant', '/tools', '/tool-rentals', '/consulting', '/logistics',
  '/investor', '/careers', '/messages', '/helpers', '/direct', '/media', '/delivery', '/me',
]);

/** Accept only same-origin, absolute-path, allow-listed return targets. */
function safeReturnTo(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || v.length > 500) return null;
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return null;
  if (/[\u0000-\u001f]/.test(v)) return null;
  let url;
  try { url = new URL(v, 'https://oxsteed.invalid'); } catch { return null; }
  if (url.origin !== 'https://oxsteed.invalid') return null;
  const path = url.pathname;
  if (!RETURN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  // Never carry query strings: private data must not ride in links.
  return path;
}

// ── subjects ────────────────────────────────────────────────────────────────
function subjectKey(type, id) {
  return type === 'self' ? 'self' : `${type}:${id}`;
}

async function resolveSubject(client, applicantId, cap, rawSubject) {
  const type = (rawSubject && rawSubject.type) || 'self';
  if (!cap.subjectTypes.includes(type)) throw err(400, 'invalid_subject', 'This application does not accept that subject.');
  if (type === 'self') return { type, id: null, key: 'self' };
  if (type === 'business_proposal') {
    // Private proposal id minted by the server; linked to a canonical
    // business only by an audited approval/activation step.
    const id = crypto.randomUUID();
    return { type, id, key: subjectKey(type, id) };
  }
  if (type === 'business') {
    const id = String(rawSubject.id || '');
    if (!/^\d{1,12}$/.test(id)) throw err(400, 'invalid_subject', 'This application does not accept that subject.');
    // A claim binds to a validated business row. Resource hiding: a missing
    // or deleted business is indistinguishable from an unknown id.
    // WP-046: only the canonical owner may name an existing business; a
    // copied id of someone else's business is indistinguishable from an
    // unknown one (no claim by identifier or exact name).
    const { rows } = await client.query('SELECT id FROM businesses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [id, applicantId]);
    if (!rows.length) throw err(404, 'subject_not_found', 'Not found.');
    return { type, id, key: subjectKey(type, id) };
  }
  throw err(400, 'invalid_subject', 'This application does not accept that subject.');
}

// ── facts / projection ──────────────────────────────────────────────────────
async function loadFacts(userId, db = pool) {
  const { rows: users } = await db.query(
    `SELECT id, role, is_active, deleted_at, COALESCE(is_suspended, FALSE) AS is_suspended,
            suspended_until, COALESCE(is_banned, FALSE) AS is_banned
       FROM users WHERE id = $1`,
    [userId],
  );
  const user = users[0] || null;
  if (!user) return { user: null, grants: [], businesses: [] };
  const { rows: grants } = await db.query(
    `SELECT id, capability, subject_type, subject_id, status, expires_at, provenance, version
       FROM access_grants WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  const { rows: businesses } = await db.query(
    `SELECT b.id, b.business_name AS name,
            CASE WHEN b.user_id = $1 THEN 'owner' ELSE bm.role END AS role
       FROM businesses b
       LEFT JOIN business_members bm
              ON bm.business_id = b.id AND bm.member_id = $1 AND bm.status = 'active'
      WHERE b.deleted_at IS NULL AND (b.user_id = $1 OR bm.id IS NOT NULL)
      ORDER BY b.id`,
    [userId],
  );
  return { user, grants, businesses };
}

async function projectionVersion(userId, db = pool) {
  const { rows } = await db.query('SELECT version FROM access_projection_versions WHERE user_id = $1', [userId]);
  return rows.length ? Number(rows[0].version) : 0;
}

async function bumpProjection(client, userId) {
  await client.query(
    `INSERT INTO access_projection_versions (user_id, version) VALUES ($1, 1)
     ON CONFLICT (user_id) DO UPDATE SET version = access_projection_versions.version + 1, updated_at = NOW()`,
    [userId],
  );
}

async function getProjection(userId, db = pool) {
  const facts = await loadFacts(userId, db);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM access_requests
      WHERE applicant_id = $1 AND status IN ('draft','submitted','in_review','needs_information')`,
    [userId],
  );
  const version = await projectionVersion(userId, db);
  const projection = resolver.project(facts, { openRequestCount: rows[0].n, version });
  // OxSteed Invest (Track 2): the client renders participation surfaces
  // from this projection only. Granted invest capabilities already appear
  // in projection.personal through resolver.project (any effective grant).
  // The invest flags below are client-visible state, never a permission
  // boundary: every invest route rechecks the flags server-side.
  // investor.reporting stays reporting-only: it never implies
  // investor.participate, and ACCESS_INVESTOR_ENFORCEMENT is never read
  // as a participation gate.
  projection.invest = require('../invest/flags').clientFlags(userId);
  if (projection.personal.includes('investor.reporting')) {
    const audience = await getInvestorAudience(userId, db);
    if (audience) {
      projection.investorAudience = {
        audienceKey: audience.audience_key,
        datasets: Array.isArray(audience.datasets) ? audience.datasets : [],
        expiresAt: audience.expires_at,
      };
    }
  }
  return projection;
}

async function can(userId, capability, subject, db = pool) {
  const facts = await loadFacts(userId, db);
  return resolver.evaluate(facts, capability, subject);
}

async function getInvestorAudience(userId, db = pool) {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.audience_key, a.datasets, a.expires_at
         FROM investor_reporting_audiences a
         JOIN access_grants g ON g.id = a.grant_id
        WHERE a.user_id = $1
          AND g.user_id = a.user_id
          AND g.capability = 'investor.reporting'
          AND g.status = 'active'
          AND a.status = 'active'
          AND (a.expires_at IS NULL OR a.expires_at > NOW())
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0] || null;
  } catch (error) {
    // Older deployments may not have the audience table yet. The capability
    // projection remains usable until the additive migration is deployed.
    if (error && error.code === '42P01') return null;
    throw error;
  }
}

// ── serialization ───────────────────────────────────────────────────────────
function subjectDisplay(row) {
  if (row.subject_type === 'self') return { kind: 'self' };
  if (row.subject_type === 'business_proposal') {
    const name = row.answers && (row.answers.businessName || row.answers.restaurantName);
    return { kind: 'new_business', name: name || null };
  }
  return { kind: row.subject_type, id: row.subject_id, name: row.subject_name || null };
}

function toApplicantView(row) {
  return {
    id: String(row.id),
    capability: row.capability,
    status: row.status,
    version: row.version,
    policyVersion: row.policy_version,
    subject: { type: row.subject_type, id: row.subject_type === 'business' ? row.subject_id : null },
    subjectDisplay: subjectDisplay(row),
    answers: row.answers || {},
    evidenceRevision: row.evidence_revision,
    publicReasonCode: row.public_reason_code || null,
    informationRequest: row.status === 'needs_information' ? row.information_request || null : null,
    availableActions: lifecycle.availableApplicantActions(row.status),
    returnTo: row.return_to || null,
    source: row.source,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toApplicantSummary(row) {
  const v = toApplicantView(row);
  delete v.answers;
  if (row.business_launch_status) v.businessLaunch = { status: row.business_launch_status };
  return v;
}

// ── idempotency ─────────────────────────────────────────────────────────────
function fingerprint(action, target, payload) {
  return crypto.createHash('sha256').update(JSON.stringify([action, target, payload ?? null])).digest('hex');
}

function validIdemKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(key);
}

async function idemLookup(client, actorId, key, fp) {
  if (!key) return null;
  const { rows } = await client.query(
    'SELECT fingerprint, status_code, response FROM access_idempotency_keys WHERE actor_id = $1 AND idem_key = $2',
    [actorId, key],
  );
  if (!rows.length) return null;
  if (rows[0].fingerprint !== fp) throw err(422, 'idempotency_key_reused', 'This request key was already used for a different request.');
  return { replay: true, status: rows[0].status_code, body: rows[0].response };
}

async function idemStore(client, actorId, key, action, fp, status, body) {
  if (!key) return;
  await client.query(
    `INSERT INTO access_idempotency_keys (actor_id, idem_key, action, fingerprint, status_code, response)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, key, action, fp, status, JSON.stringify(body)],
  );
}

// ── transaction helper ──────────────────────────────────────────────────────
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection already failed */ }
    // Concurrent idempotent retry raced us to the key: surface as replay.
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Run `work` once per (actor, Idempotency-Key). Same key + same payload
 * returns the stored result; same key + different payload → 422.
 */
async function idempotent(actorId, idemKey, action, target, payload, work) {
  if (idemKey != null && !validIdemKey(idemKey)) throw err(400, 'invalid_idempotency_key', 'Invalid Idempotency-Key header.');
  const fp = fingerprint(action, target, payload);
  try {
    return await tx(async (client) => {
      if (idemKey) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`access-idem:${actorId}:${idemKey}`]);
      const prior = await idemLookup(client, actorId, idemKey, fp);
      if (prior) return prior;
      const { status, body } = await work(client);
      await idemStore(client, actorId, idemKey, action, fp, status, body);
      return { replay: false, status, body };
    });
  } catch (e) {
    if (e && e.code === '23505' && /access_requests_one_open_idx/.test(e.constraint || e.message || '')) {
      const { rows } = await pool.query(
        `SELECT id FROM access_requests WHERE applicant_id = $1 AND capability = $2
            AND status IN ('draft','submitted','in_review','needs_information') ORDER BY id LIMIT 1`,
        [actorId, payload && payload.capability],
      );
      throw err(409, 'request_already_open', 'You already have an open application for this.', { requestId: rows[0] ? String(rows[0].id) : null });
    }
    throw e;
  }
}

async function writeDecision(client, row, { action, toStatus, actorId, actorType, authority = null, reasonCode = null, note = null }) {
  const { rows } = await client.query(
    `INSERT INTO access_request_decisions
       (request_id, action, from_status, to_status, request_version, actor_id, actor_type,
        reviewer_authority, evidence_revision, policy_version, public_reason_code, internal_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [row.id, action, row.status, toStatus, row.version + 1, actorId, actorType, authority,
      row.evidence_revision, row.policy_version, reasonCode, note],
  );
  return rows[0].id;
}

async function enqueue(client, { eventType, userId, requestId = null, grantId = null, payload = {}, dedupeKey }) {
  await client.query(
    `INSERT INTO access_outbox (event_type, user_id, request_id, grant_id, payload, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [eventType, userId, requestId, grantId, JSON.stringify(payload), dedupeKey],
  );
}

async function lockOwnRequest(client, applicantId, id) {
  if (!/^\d{1,18}$/.test(String(id))) throw err(404, 'access_request_not_found', 'Application not found.');
  const { rows } = await client.query('SELECT * FROM access_requests WHERE id = $1 AND applicant_id = $2 FOR UPDATE', [id, applicantId]);
  if (!rows.length) throw err(404, 'access_request_not_found', 'Application not found.');
  return rows[0];
}

function assertVersion(row, expectedVersion) {
  if (!Number.isInteger(expectedVersion)) throw err(400, 'validation_failed', 'expectedVersion is required.', { fields: { expectedVersion: 'required' } });
  if (row.version !== expectedVersion) {
    throw err(409, 'request_version_conflict', 'This application changed since you opened it.', { current: toApplicantSummary(row) });
  }
}

// ── applicant operations ────────────────────────────────────────────────────
async function createRequest(applicantId, input, { idemKey = null } = {}) {
  const capability = input && input.capability;
  const cap = registry.getCapability(capability);
  if (!cap) throw err(400, 'unknown_capability', 'Unknown capability.');
  if (!cap.applicantMayRequest) throw err(403, 'access_request_not_available', 'This access is not requested here.');
  const submit = input.submit === true;
  const v = lifecycle.validateAnswers(capability, input.answers || {}, { mode: submit ? 'submit' : 'draft' });
  if (!v.ok) throw err(400, 'validation_failed', 'Validation failed', { fields: v.fields });
  const source = ['signup', 'in_context', 'settings'].includes(input.source) ? input.source : 'in_context';
  const returnTo = safeReturnTo(input.returnTo);
  const payload = { capability, subject: input.subject || { type: 'self' }, answers: v.answers, submit, source, returnTo };

  return idempotent(applicantId, idemKey, 'create', null, payload, async (client) => {
    const facts = await loadFacts(applicantId, client);
    if (!resolver.accountActive(facts.user)) throw err(403, 'account_inactive', 'Your account cannot apply right now.');
    const subject = await resolveSubject(client, applicantId, cap, payload.subject);
    if (subject.type !== 'business_proposal' && resolver.evaluate(facts, capability, subject).allowed) {
      throw err(409, 'access_already_granted', 'You already have this access.');
    }
    const { rows: open } = await client.query(
      `SELECT id FROM access_requests WHERE applicant_id = $1 AND capability = $2
          AND (subject_key = $3 OR ($4 AND subject_type = 'business_proposal'))
          AND status IN ('draft','submitted','in_review','needs_information') LIMIT 1`,
      [applicantId, capability, subject.key, subject.type === 'business_proposal'],
    );
    if (open.length) throw err(409, 'request_already_open', 'You already have an open application for this.', { requestId: String(open[0].id) });
    const status = submit ? 'submitted' : 'draft';
    const { rows } = await client.query(
      `INSERT INTO access_requests
         (applicant_id, capability, subject_type, subject_id, subject_key, status, policy_version,
          answers, source, return_to, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6::varchar,$7,$8,$9,$10, CASE WHEN $6::varchar = 'submitted' THEN NOW() END)
       RETURNING *`,
      [applicantId, capability, subject.type, subject.id, subject.key, status, cap.version,
        JSON.stringify(v.answers), source, returnTo],
    );
    let row = rows[0];
    await client.query(
      `INSERT INTO access_request_decisions (request_id, action, from_status, to_status, request_version, actor_id, actor_type, policy_version, evidence_revision)
       VALUES ($1, $2, NULL, $3, 1, $4, 'applicant', $5, 1)`,
      [row.id, submit ? 'create_and_submit' : 'create', status, applicantId, cap.version],
    );
    if (submit) await enqueue(client, { eventType: 'access_request.submitted', userId: applicantId, requestId: row.id, payload: { capability }, dedupeKey: `submitted:${row.id}:1` });
    await bumpProjection(client, applicantId);
    return { status: 201, body: { request: toApplicantView(row) } };
  });
}

async function applicantTransition(applicantId, id, action, { expectedVersion, answers, idemKey = null } = {}) {
  return idempotent(applicantId, idemKey, action, String(id), { expectedVersion, answers }, async (client) => {
    const row = await lockOwnRequest(client, applicantId, id);
    assertVersion(row, expectedVersion);
    const toStatus = lifecycle.applicantNext(action, row.status);
    if (!toStatus) throw err(409, 'invalid_transition', 'This application cannot do that right now.', { current: toApplicantSummary(row) });
    const cap = registry.getCapability(row.capability);
    let nextAnswers = row.answers || {};
    let evidenceRevision = row.evidence_revision;
    let policyVersion = row.policy_version;
    if (action === 'update' || ((action === 'submit' || action === 'resubmit') && answers !== undefined)) {
      const merged = { ...nextAnswers, ...(answers || {}) };
      const draftCheck = lifecycle.validateAnswers(row.capability, merged, { mode: 'draft' });
      if (!draftCheck.ok) throw err(400, 'validation_failed', 'Validation failed', { fields: draftCheck.fields });
      nextAnswers = draftCheck.answers;
      if (JSON.stringify(nextAnswers) !== JSON.stringify(row.answers || {})) evidenceRevision += 1;
    }
    if (action === 'submit' || action === 'resubmit') {
      // Fresh validation against the CURRENT policy version.
      const full = lifecycle.validateAnswers(row.capability, nextAnswers, { mode: 'submit' });
      if (!full.ok) throw err(400, 'validation_failed', 'Validation failed', { fields: full.fields });
      policyVersion = cap ? cap.version : row.policy_version;
    }
    await writeDecision(client, row, { action, toStatus, actorId: applicantId, actorType: 'applicant' });
    const { rows } = await client.query(
      `UPDATE access_requests
          SET status = $2::varchar, answers = $3, evidence_revision = $4, policy_version = $5,
              version = version + 1, updated_at = NOW(),
              submitted_at = CASE WHEN $2::varchar = 'submitted' THEN NOW() ELSE submitted_at END,
              information_request = CASE WHEN $2::varchar = 'submitted' THEN NULL ELSE information_request END,
              assigned_reviewer_id = CASE WHEN $2::varchar IN ('submitted','withdrawn') THEN NULL ELSE assigned_reviewer_id END
        WHERE id = $1 RETURNING *`,
      [row.id, toStatus, JSON.stringify(nextAnswers), evidenceRevision, policyVersion],
    );
    if (toStatus === 'submitted') {
      await enqueue(client, { eventType: 'access_request.submitted', userId: applicantId, requestId: row.id, payload: { capability: row.capability }, dedupeKey: `submitted:${row.id}:${rows[0].version}` });
    }
    await bumpProjection(client, applicantId);
    return { status: 200, body: { request: toApplicantView(rows[0]) } };
  });
}

async function listMine(applicantId, { limit = 20, before = null } = {}) {
  const lim = Math.max(1, Math.min(MAX_PAGE, Number(limit) || 20));
  const params = [applicantId, lim + 1];
  let cursor = '';
  if (before != null) {
    if (!/^\d{1,18}$/.test(String(before))) throw err(400, 'validation_failed', 'Invalid cursor.', { fields: { before: 'invalid' } });
    params.push(String(before));
    cursor = 'AND ar.id < $3';
  }
  const { rows } = await pool.query(
    `SELECT ar.*, launch.status AS business_launch_status
     FROM access_requests ar
     LEFT JOIN LATERAL (
       SELECT cr.status FROM consulting_requests cr
       WHERE cr.access_request_id = ar.id AND cr.user_id = ar.applicant_id AND cr.status <> 'archived'
       ORDER BY cr.created_at DESC, cr.id DESC LIMIT 1
     ) launch ON TRUE
     WHERE ar.applicant_id = $1 ${cursor}
     ORDER BY ar.id DESC LIMIT $2`,
    params,
  );
  const page = rows.slice(0, lim);
  return {
    requests: page.map(toApplicantSummary),
    nextCursor: rows.length > lim ? String(page[page.length - 1].id) : null,
  };
}

async function getMine(applicantId, id) {
  if (!/^\d{1,18}$/.test(String(id))) throw err(404, 'access_request_not_found', 'Application not found.');
  const { rows } = await pool.query('SELECT * FROM access_requests WHERE id = $1 AND applicant_id = $2', [id, applicantId]);
  if (!rows.length) throw err(404, 'access_request_not_found', 'Application not found.');
  const { rows: history } = await pool.query(
    `SELECT action, from_status, to_status, public_reason_code, created_at
       FROM access_request_decisions WHERE request_id = $1 ORDER BY request_version`,
    [id],
  );
  return {
    request: toApplicantView(rows[0]),
    history: history.map((h) => ({ action: h.action, fromStatus: h.from_status, toStatus: h.to_status, publicReasonCode: h.public_reason_code, at: h.created_at })),
  };
}

module.exports = {
  // facts / projection
  loadFacts,
  getProjection,
  projectionVersion,
  bumpProjection,
  can,
  getInvestorAudience,
  // applicant
  createRequest,
  applicantTransition,
  listMine,
  getMine,
  // shared internals for reviewer service / tests
  _internal: { tx, idempotent, writeDecision, enqueue, assertVersion, toApplicantView, toApplicantSummary, err, safeReturnTo, subjectKey },
  safeReturnTo,
};
