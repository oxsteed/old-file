'use strict';

// Careers data in the privacy export and account erasure (careers spec
// §12.6, fixes C-11). Applications keep their de-identified stage history
// for statistics; anything still inside its retention period or under a
// legal hold is kept until retention_until and anonymized by the sweep.

const { decrypt } = require('../../utils/encryption');
const { anonymizeApplication, stampDecision } = require('./retention');
const { FINAL_STAGES } = require('../careerCatalog');

async function exportData(conn, userId) {
  const q = async (sql, params = [userId]) => (await conn.query(sql, params)).rows;
  const applications = await q(
    `SELECT a.id, a.opening_id, o.title AS opening_title, a.stage, a.source, a.created_at, a.updated_at, a.decided_at,
            a.retention_until, a.applicant_email, a.first_name, a.last_name, a.phone, a.city, a.country_code, a.languages,
            a.cover_letter, a.resume_url, a.authorized_to_work, a.needs_sponsorship, a.preferred_location_ids,
            a.profile_snapshot, a.rejection_reason_code, a.rejection_requirement, a.rejection_fact_type,
            a.accommodation_requested, a.ai_notice_shown, a.is_guest
       FROM career_applications a JOIN career_openings o ON o.id = a.opening_id
      WHERE a.user_id = $1 ORDER BY a.created_at`
  );
  const ids = applications.map((a) => a.id);
  const byApp = async (sql) => (ids.length ? (await conn.query(sql, [ids])).rows : []);
  const eeoRows = await byApp('SELECT application_id, ciphertext FROM careers_private.career_eeo_responses WHERE application_id = ANY($1::bigint[])');
  const eeo = eeoRows.map((r) => {
    try { return { application_id: r.application_id, answers: JSON.parse(decrypt(r.ciphertext)) }; } catch { return { application_id: r.application_id, answers: null }; }
  });
  return {
    careers: {
      profile: (await q('SELECT * FROM career_profiles WHERE user_id = $1'))[0] || null,
      share_settings: (await q('SELECT visibility, hidden_fact_types, career_offers_opt_in, updated_at FROM career_profile_share_current WHERE user_id = $1'))[0] || null,
      facts: await q('SELECT fact_type, category, value, sample_size, source, computed_at FROM career_profile_facts WHERE user_id = $1'),
      share_ledger: await q('SELECT action, audience, fact_types, policy_version, created_at FROM career_profile_share_events WHERE user_id = $1 ORDER BY id'),
      profile_views: await q(
        `SELECT l.context, l.business_id, b.business_name, l.application_id, l.fact_types, l.created_at
           FROM career_profile_access_log l LEFT JOIN businesses b ON b.id = l.business_id
          WHERE l.subject_user_id = $1 ORDER BY l.created_at`
      ),
      muted_businesses: await q('SELECT business_id, created_at FROM career_profile_mutes WHERE user_id = $1'),
      fact_disputes: await q('SELECT fact_type, reason, status, resolution_note, created_at, resolved_at FROM career_fact_disputes WHERE user_id = $1'),
      invitations: await q('SELECT business_id, opening_id, reason_code, message, status, created_at, expires_at FROM career_invitations WHERE user_id = $1'),
      applications,
      application_events: await byApp('SELECT application_id, from_stage, to_stage, reason_code, created_at FROM career_application_events WHERE application_id = ANY($1::bigint[]) ORDER BY id'),
      interviews: await byApp('SELECT application_id, scheduled_at, timezone, mode, location, status FROM career_interviews WHERE application_id = ANY($1::bigint[])'),
      offers: await byApp(
        `SELECT application_id, title, pay_cents, pay_period, currency_code, start_date, expires_at, status, conditions,
                employer_model, first_shift, accepted_terms_snapshot, created_at, decided_at
           FROM career_offers WHERE application_id = ANY($1::bigint[]) AND status <> 'awaiting_approval'`
      ),
      eeo_self_identification: eeo,
      background_checks: await q('SELECT application_id, provider, package, status, consent_at, completed_at, created_at FROM career_background_checks WHERE user_id = $1'),
      onboarding_runs: await q('SELECT id, application_id, business_id, status, created_at, finished_at FROM career_onboarding_runs WHERE user_id = $1'),
      employer_of_record: await q('SELECT business_id, partner, partner_worker_ref, status, started_at, ended_at FROM career_eor_assignments WHERE user_id = $1'),
    },
  };
}

/**
 * Erase a worker's careers data inside the caller's transaction.
 * Returns a summary and the storage keys to delete after commit.
 */
async function erase(conn, userId) {
  const summary = { anonymized: 0, withdrawn: 0, held: 0, storageKeys: [] };
  const { rows: apps } = await conn.query(
    `SELECT id, stage, retention_until, legal_hold, resume_storage_key FROM career_applications
      WHERE user_id = $1 AND anonymized_at IS NULL FOR UPDATE`,
    [userId]
  );
  for (const app of apps) {
    if (app.resume_storage_key) summary.storageKeys.push(app.resume_storage_key);
    if (!FINAL_STAGES.includes(app.stage)) {
      // Active applications are withdrawn and their offers closed (C-03).
      await conn.query(`UPDATE career_applications SET stage = 'withdrawn', updated_at = NOW() WHERE id = $1`, [app.id]);
      await conn.query(
        `UPDATE career_offers SET status = 'withdrawn', decided_at = NOW(), withdrawn_reason = 'account_deleted'
          WHERE application_id = $1 AND status IN ('pending','awaiting_approval')`,
        [app.id]
      );
      await conn.query(
        `INSERT INTO career_application_events (application_id, actor_user_id, from_stage, to_stage, reason_code, metadata)
         VALUES ($1, NULL, $2, 'withdrawn', 'withdrew_interest', '{"account_deleted":true}'::jsonb)`,
        [app.id, app.stage]
      );
      app.retention_until = await stampDecision(conn, app.id, {});
      summary.withdrawn += 1;
    }
    const stillHeld = app.legal_hold || (app.retention_until && new Date(app.retention_until) >= new Date(new Date().toISOString().slice(0, 10)));
    if (stillHeld) {
      // Kept for the legal minimum, but cut loose from the account now:
      // the retention sweep anonymizes it on retention_until.
      await conn.query('UPDATE career_applications SET user_id = NULL, profile_snapshot = NULL, updated_at = NOW() WHERE id = $1', [app.id]);
      summary.held += 1;
    } else {
      await anonymizeApplication(conn, app.id);
      summary.anonymized += 1;
    }
  }
  const { rows: [profile] } = await conn.query('SELECT resume_storage_key FROM career_profiles WHERE user_id = $1', [userId]);
  if (profile?.resume_storage_key) summary.storageKeys.push(profile.resume_storage_key);

  await conn.query("SELECT set_config('careers.erasure', 'on', true)");
  await conn.query('DELETE FROM career_profile_share_events WHERE user_id = $1', [userId]);
  await conn.query("SELECT set_config('careers.erasure', 'off', true)");
  await conn.query('DELETE FROM career_profile_share_current WHERE user_id = $1', [userId]);
  await conn.query('DELETE FROM career_profile_facts WHERE user_id = $1', [userId]);
  await conn.query('DELETE FROM career_profile_access_log WHERE subject_user_id = $1', [userId]);
  await conn.query('DELETE FROM career_profile_mutes WHERE user_id = $1', [userId]);
  await conn.query('DELETE FROM career_fact_disputes WHERE user_id = $1', [userId]);
  await conn.query('DELETE FROM career_invitations WHERE user_id = $1', [userId]);
  await conn.query('DELETE FROM career_profiles WHERE user_id = $1', [userId]);
  // Background-check rows follow the application's retention: status
  // only, unlinked from the account. The report itself stays at Checkr.
  await conn.query('UPDATE career_background_checks SET user_id = NULL, invitation_url = NULL WHERE user_id = $1', [userId]);
  await conn.query('UPDATE career_onboarding_runs SET user_id = NULL WHERE user_id = $1', [userId]);
  await conn.query('UPDATE career_eor_assignments SET user_id = NULL WHERE user_id = $1', [userId]);

  if (summary.storageKeys.length) {
    const { enqueueStorageDeletion } = require('../storageCleanupService');
    for (const key of summary.storageKeys) await enqueueStorageDeletion(key, 'careers_erasure', { client: conn });
  }
  return { careers: { anonymized: summary.anonymized, withdrawn: summary.withdrawn, held: summary.held, files: summary.storageKeys.length } };
}

module.exports = { exportData, erase };
