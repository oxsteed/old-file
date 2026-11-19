'use strict';

/**
 * Legacy → capability backfill (spec: "Backfill job and dry run").
 *
 * - Deterministic traversal by users.id, bounded batches, checkpoint saved
 *   in access_backfill_runs after every committed batch (resumable).
 * - dry_run writes only the run row with counts (no personal data).
 * - apply inserts grants with ON CONFLICT DO NOTHING: a replay never
 *   reactivates a revoked/suspended grant and never duplicates.
 * - Draft applications preserve an expressed-but-unapproved intent;
 *   skipped if any request for that capability already exists.
 * - Exceptions go to access_backfill_exceptions for human review.
 */

const pool = require('../../db');
const { mapLegacyUser, PROVENANCE } = require('./legacyMapping');
const { resolveInvestorScope } = require('./accessService');
const { syncFranchiseGrant } = require('../../controllers/franchiseController');
const registry = require('./policyRegistry');

const FACTS_SQL = `
  SELECT u.id, u.role::text AS role, u.default_mode,
         EXISTS (SELECT 1 FROM helper_profiles hp WHERE hp.user_id = u.id) AS helper_profile,
         COALESCE((SELECT json_agg(json_build_object('mode', a.mode, 'status', a.status))
                     FROM mode_platform_approvals a WHERE a.user_id = u.id), '[]'::json) AS mode_approvals,
         (SELECT COUNT(*)::int FROM businesses b WHERE b.user_id = u.id AND b.deleted_at IS NULL) AS owned_business_count,
         (SELECT COUNT(*)::int FROM business_members bm WHERE bm.member_id = u.id AND bm.status = 'active') AS active_membership_count,
         (SELECT COUNT(*)::int FROM tool_rentals t WHERE t.user_id = u.id) AS tool_listing_count,
         -- R-4: investor evidence is an existing active audience row, or a
         -- live position / commitment / participation application. The
         -- audience table and the investment tables exist on any database
         -- the access tables were migrated on.
         (EXISTS (SELECT 1 FROM investor_reporting_audiences a WHERE a.user_id = u.id AND a.status = 'active')
          OR EXISTS (SELECT 1 FROM investment_positions p WHERE p.user_id = u.id AND p.status = 'active')
          OR EXISTS (SELECT 1 FROM investment_commitments c WHERE c.user_id = u.id AND c.status IN ('reserved', 'completed'))
          OR EXISTS (SELECT 1 FROM investment_participation_applications pa
                      WHERE pa.user_id = u.id AND pa.status IN ('submitted', 'under_review', 'approved')))
           AS investor_audience,
         -- R-4: the newest launched application with a linked business is
         -- the territory assignment the franchise pipeline itself uses.
         (SELECT fa.id FROM franchise_applications fa
           WHERE fa.owner_user_id = u.id AND fa.status = 'launched' AND fa.linked_business_id IS NOT NULL
           ORDER BY fa.updated_at DESC, fa.id DESC LIMIT 1) AS franchise_application_id,
         (SELECT fa.linked_business_id FROM franchise_applications fa
           WHERE fa.owner_user_id = u.id AND fa.status = 'launched' AND fa.linked_business_id IS NOT NULL
           ORDER BY fa.updated_at DESC, fa.id DESC LIMIT 1) AS franchise_business_id
    FROM users u
   WHERE u.deleted_at IS NULL AND ($1::uuid IS NULL OR u.id > $1::uuid)
   ORDER BY u.id
   LIMIT $2`;

function bump(counts, key, n = 1) { counts[key] = (counts[key] || 0) + n; }

async function runBackfill({ mode = 'dry_run', batchSize = 500, resumeRunId = null, maxBatches = Infinity } = {}) {
  if (!['dry_run', 'apply'].includes(mode)) throw new Error('mode must be dry_run or apply');
  let run;
  if (resumeRunId) {
    const { rows } = await pool.query('SELECT * FROM access_backfill_runs WHERE id = $1', [resumeRunId]);
    if (!rows.length) throw new Error('run not found');
    run = rows[0];
    if (run.mode !== mode) throw new Error('resume mode mismatch');
    await pool.query("UPDATE access_backfill_runs SET status = 'running', last_error = NULL WHERE id = $1", [run.id]);
  } else {
    const { rows } = await pool.query('INSERT INTO access_backfill_runs (mode) VALUES ($1) RETURNING *', [mode]);
    run = rows[0];
  }
  const counts = { ...(run.counts || {}) };
  let checkpoint = run.checkpoint_user_id || null;
  let batches = 0;
  try {
    for (;;) {
      if (batches >= maxBatches) break;
      const client = await pool.connect();
      let done = false;
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(FACTS_SQL, [checkpoint, batchSize]);
        if (!rows.length) { done = true; await client.query('COMMIT'); break; }
        for (const r of rows) {
          bump(counts, 'users_scanned');
          const out = mapLegacyUser({
            user: { id: r.id, role: r.role, default_mode: r.default_mode },
            helperProfile: r.helper_profile,
            modeApprovals: r.mode_approvals,
            ownedBusinessCount: r.owned_business_count,
            activeMembershipCount: r.active_membership_count,
            toolListingCount: r.tool_listing_count,
            // R-4: investor evidence is an existing audience row or a live
            // position/commitment/application; franchise evidence is the
            // newest launched application with a linked business.
            investorAudience: r.investor_audience,
            franchiseTerritory: r.franchise_business_id != null,
          });
          for (const g of out.grants) {
            bump(counts, `grant:${g.capability}`);
            if (mode !== 'apply') continue;
            // R-4 franchise: reuse the pipeline's syncFranchiseGrant so the
            // grant shape matches, but only when no franchise.operate row
            // exists yet. syncFranchiseGrant reactivates a revoked grant,
            // which the backfill must never do (a replay never reactivates
            // a revoked/suspended grant).
            if (g.capability === 'franchise.operate' && r.franchise_business_id != null) {
              const { rows: existing } = await client.query(
                `SELECT 1 FROM access_grants
                  WHERE user_id = $1 AND capability = $2
                    AND subject_type = 'franchise_application' AND subject_id = $3
                  LIMIT 1`,
                [r.id, 'franchise.operate', String(r.franchise_application_id)],
              );
              if (!existing.length) {
                await syncFranchiseGrant(client, {
                  applicationId: r.franchise_application_id,
                  ownerUserId: r.id, status: 'launched', linkedBusinessId: r.franchise_business_id,
                });
                bump(counts, 'inserted:franchise.operate');
              } else {
                bump(counts, 'existing:franchise.operate');
              }
              continue;
            }
            const res = await client.query(
              `INSERT INTO access_grants (user_id, capability, subject_type, subject_id, subject_key, status, provenance, provenance_reason, policy_version)
               VALUES ($1, $2, 'self', NULL, 'self', 'active', $3, $4, $5)
               ON CONFLICT (user_id, capability, subject_key) DO NOTHING`,
              [r.id, g.capability, PROVENANCE, g.reason, registry.getCapability(g.capability).version],
            );
            bump(counts, res.rowCount ? `inserted:${g.capability}` : `existing:${g.capability}`);
            if (res.rowCount) {
              await client.query(
                `INSERT INTO access_projection_versions (user_id, version) VALUES ($1, 1)
                 ON CONFLICT (user_id) DO UPDATE SET version = access_projection_versions.version + 1, updated_at = NOW()`,
                [r.id],
              );
            }
            // R-4 investor: a granted investor.reporting needs its audience
            // row (least-privilege datasets, scope from live positions) or
            // the projection carries no datasets and the dataset gate
            // denies reads. Only for an active grant, and only once per
            // grant (ON CONFLICT DO NOTHING).
            if (g.capability === 'investor.reporting') {
              const { rows: [activeGrant] } = await client.query(
                `SELECT id FROM access_grants
                  WHERE user_id = $1 AND capability = 'investor.reporting'
                    AND subject_key = 'self' AND status = 'active' LIMIT 1`,
                [r.id],
              );
              if (activeGrant) {
                const scope = await resolveInvestorScope(r.id, client);
                const aud = await client.query(
                  `INSERT INTO investor_reporting_audiences (user_id, grant_id, audience_key, datasets, entity_ids, opportunity_ids)
                   VALUES ($1, $2, 'legacy-investor-mode', ARRAY['overview'], $3, $4)
                   ON CONFLICT (grant_id) DO NOTHING`,
                  [r.id, activeGrant.id, scope.entityIds, scope.opportunityIds],
                );
                if (aud.rowCount) bump(counts, 'audience_created:investor.reporting');
              }
            }
          }
          for (const d of out.drafts) {
            bump(counts, `draft:${d.capability}`);
            if (mode === 'apply') {
              const cap = registry.getCapability(d.capability);
              const subjectType = cap.subjectTypes[0];
              const { rows: existing } = await client.query(
                'SELECT 1 FROM access_requests WHERE applicant_id = $1 AND capability = $2 LIMIT 1', [r.id, d.capability]);
              if (!existing.length) {
                const subjectId = subjectType === 'self' ? null : require('crypto').randomUUID();
                const key = subjectType === 'self' ? 'self' : `${subjectType}:${subjectId}`;
                const { rows: req } = await client.query(
                  `INSERT INTO access_requests (applicant_id, capability, subject_type, subject_id, subject_key, status, policy_version, source)
                   VALUES ($1, $2, $3, $4, $5, 'draft', $6, 'legacy_backfill')
                   ON CONFLICT DO NOTHING RETURNING id`,
                  [r.id, d.capability, subjectType, subjectId, key, cap.version],
                );
                if (req.length) {
                  await client.query(
                    `INSERT INTO access_request_decisions (request_id, action, to_status, request_version, actor_type, policy_version, evidence_revision)
                     VALUES ($1, 'legacy_backfill', 'draft', 1, 'system', $2, 1)`,
                    [req[0].id, cap.version],
                  );
                  bump(counts, `draft_created:${d.capability}`);
                }
              }
            }
          }
          for (const e of out.exceptions) {
            bump(counts, `exception:${e.reason}`);
            if (mode === 'apply') {
              await client.query(
                `INSERT INTO access_backfill_exceptions (user_id, reason, run_id) VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, reason) DO NOTHING`,
                [r.id, e.reason, run.id],
              );
            }
          }
        }
        checkpoint = rows[rows.length - 1].id;
        await client.query('UPDATE access_backfill_runs SET checkpoint_user_id = $2, counts = $3 WHERE id = $1', [run.id, checkpoint, JSON.stringify(counts)]);
        await client.query('COMMIT');
        batches += 1;
        if (rows.length < batchSize) done = true;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        throw e;
      } finally {
        client.release();
      }
      if (done) break;
    }
    const finished = batches < maxBatches || maxBatches === Infinity;
    const { rows: [final] } = await pool.query(
      `UPDATE access_backfill_runs SET counts = $2,
              status = CASE WHEN $3::boolean THEN 'completed' ELSE 'running' END,
              finished_at = CASE WHEN $3::boolean THEN NOW() ELSE NULL END
        WHERE id = $1 RETURNING *`,
      [run.id, JSON.stringify(counts), finished],
    );
    return final;
  } catch (e) {
    await pool.query("UPDATE access_backfill_runs SET status = 'failed', last_error = $2 WHERE id = $1", [run.id, String(e.message).slice(0, 500)]);
    throw e;
  }
}

module.exports = { runBackfill };
