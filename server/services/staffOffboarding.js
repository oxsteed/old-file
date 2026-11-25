'use strict';

/**
 * server/services/staffOffboarding.js
 *
 * Offboarding side effects for a removed team member (staff review S-11).
 * Runs inside the caller's transaction so the membership revoke, the
 * device/drawer cleanup, the work reassignment and the offboarding record
 * commit or roll back together:
 *
 *   - restaurant staff PINs for the user are deactivated at every
 *     restaurant owned by the business (previously a removed employee's
 *     PIN kept working at the POS);
 *   - open staff sub-sessions (restaurant_staff_sessions) for the user are
 *     ended at every restaurant owned by the business. Auth-audit item 3:
 *     a revoked employee's session used to keep stamping acting_staff_user_id
 *     on POS writes and tip attribution until idle expiry or the 12h cap;
 *     ending it here closes the gap. Fail closed: the UPDATE runs in the
 *     caller's transaction, so if it throws, the membership revoke and all
 *     sibling cleanup roll back with it.
 *   - POS drawers (restaurant_pos_shifts) the user left open are flagged
 *     for a manager close instead of silently staying open. They are NOT
 *     force-closed: the cash inside still has to be counted by a manager.
 *   - open crew tasks and corrective actions assigned to the user are
 *     REASSIGNED to a manager (never NULLed): the acting manager when
 *     they hold a manager/owner role on the business, else the business
 *     owner. Completed items keep their assignee: they are history.
 *   - G-37: open business bookings owned by the user (pending or
 *     accepted) are REASSIGNED to the same target, with their linked
 *     appointments and two-party conversations. The booking, its deposit
 *     and its appointment are preserved; only the provider moves. The
 *     user's personal (non-business) bookings are untouched.
 *   - a staff_offboarding_records row captures the whole outcome plus the
 *     retention deadline (businesses.staff_record_retention_years,
 *     default 7 years) before which the staff history must be kept.
 *   - G5-3 (Batch E, 294): in-progress OxSteed jobs the member held
 *     through this business move to the same reassignment target (see
 *     the jobs block below). jobs carry no business_id, so only
 *     business-attributed jobs move: jobs linked to a business booking
 *     (booking_requests.business_id -> appointments.job_id) or to one
 *     of the business's team tasks (business_team_tasks.job_id).
 *     Unattributed jobs are the member's own work and stay with them;
 *     finished jobs stay as history, and jobs with an open dispute
 *     (dispute_status 'open'/'under_review') stay put until the
 *     dispute resolves.
 *   - G5-32 (Batch E, 298): the member's workspace contexts for this
 *     business are deleted here, so every removal path (remove, legacy
 *     revoke, expiry, self-leave) clears them, not just self-leave.
 *
 * G5-32 forced-logout note (Batch E, 298): when revokeAccountSessions
 * is true (the remove/revoke paths; default), every refresh token for
 * the user is revoked in this transaction, so the member is signed out
 * on all devices once their access token expires (access tokens live
 * up to 15 minutes). That revocation is account-wide, not
 * business-scoped: sessions carry no business id, so there is no
 * business-scoped session to revoke. After re-login the member lands
 * on Personal Home: the workspace route redirects an unknown business
 * to `/` (G5-31) and the home route renders the workspaceUnavailable
 * notice there. The expiry and self-leave paths pass
 * revokeAccountSessions: false, so a member whose access simply ended
 * (or who left voluntarily) is NOT force-logged-out of their personal
 * account or their other businesses.
 *
 * Staff history is deliberately NOT deleted here. Schedules, time entries
 * and training records are wage-and-hour history; migrations 946 and 1202
 * switched their user foreign keys to ON DELETE SET NULL so they also
 * survive an account hard-delete.
 *
 * @param {object} client  pg client inside an open transaction
 * @param {object} args
 * @param {number} args.businessId
 * @param {string} args.userId    the removed member's user id
 * @param {string} [args.reason]  recorded on flagged drawers and the record
 * @param {number} [args.membershipId] the revoked business_members id
 * @param {string} [args.removedBy]    the acting user id
 * @param {string} [args.reassignToUserId] preferred manager for open work
 * @returns {Promise<object>} counts, the reassignment target and the record
 */
async function resolveReassignTarget(client, businessId, preferredUserId) {
  if (preferredUserId) {
    const { rows } = await client.query(
      `SELECT 1 FROM business_members
        WHERE business_id = $1 AND member_id = $2 AND status = 'active' AND role = 'manager'
       UNION
       SELECT 1 FROM businesses WHERE id = $1 AND user_id = $2`,
      [businessId, preferredUserId]
    );
    if (rows.length) return preferredUserId;
  }
  // The business always has an owner, so the chain never ends at NULL.
  const { rows: [biz] } = await client.query(
    'SELECT user_id FROM businesses WHERE id = $1',
    [businessId]
  );
  return (biz && biz.user_id) || null;
}

async function applyStaffOffboarding(client, {
  businessId,
  userId,
  reason = null,
  membershipId = null,
  removedBy = null,
  reassignToUserId = null,
  revokeAccountSessions = true,
} = {}) {
  const empty = {
    pinsDeactivated: 0,
    sessionsEnded: 0,
    drawersFlagged: 0,
    crewTasksReassigned: 0,
    correctiveActionsReassigned: 0,
    bookingsReassigned: 0,
    appointmentsReassigned: 0,
    jobsReassigned: 0,
    workspaceContextsCleared: 0,
    reassignedToUserId: null,
    offboardingRecord: null,
    refreshTokensRevoked: 0,
  };
  if (!client || !businessId || !userId) return empty;

  const pins = await client.query(
    `UPDATE restaurant_staff_pins p
        SET is_active = FALSE, updated_at = NOW()
      WHERE p.staff_user_id = $1
        AND p.is_active = TRUE
        AND p.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING p.id`,
    [userId, businessId]
  );

  // Auth-audit item 3: end every open staff sub-session for the user at
  // every restaurant owned by the business, inside the same transaction.
  // resolveStaffSession checks only token/restaurant/expiry, so without
  // this a revoked employee's session would keep stamping
  // acting_staff_user_id on POS writes (and tip attribution) until the
  // idle expiry or the 12h absolute cap. Any failure here throws and rolls
  // the whole offboarding transaction back (fail closed).
  const sessions = await client.query(
    `UPDATE restaurant_staff_sessions s
        SET ended_at = NOW(), end_reason = 'offboarded'
      WHERE s.staff_user_id = $1
        AND s.ended_at IS NULL
        AND s.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING s.id`,
    [userId, businessId]
  );

  const drawers = await client.query(
    `UPDATE restaurant_pos_shifts s
        SET flagged_for_close_at = NOW(),
            flagged_for_close_reason = $3
      WHERE s.staff_user_id = $1
        AND s.status = 'open'
        AND s.flagged_for_close_at IS NULL
        AND s.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING s.id`,
    [userId, businessId, reason ? `${reason}: staff member removed from the team` : 'Staff member removed from the team']
  );

  // S-11: open work is reassigned to a manager, never orphaned to NULL.
  const reassignTo = await resolveReassignTarget(client, businessId, reassignToUserId);
  const teamTasks=await client.query("UPDATE business_team_tasks SET assignee_id=$3,version=version+1 WHERE business_id=$1 AND assignee_id=$2 AND status='open' RETURNING id",[businessId,userId,reassignTo]);

  const crewTasks = await client.query(
    `UPDATE restaurant_crew_tasks t
        SET assigned_to = $3, updated_at = NOW()
      WHERE t.assigned_to = $1
        AND t.status IN ('not_started', 'in_progress', 'needs_approval')
        AND t.restaurant_id IN (
          SELECT id FROM food_restaurants WHERE business_id = $2
        )
      RETURNING t.id`,
    [userId, businessId, reassignTo]
  );

  const correctiveActions = await client.query(
    `UPDATE restaurant_corrective_actions a
        SET assignee_id = $3, updated_at = NOW()
      WHERE a.assignee_id = $1
        AND a.status IN ('open', 'in_progress')
        AND a.audit_id IN (
          SELECT au.id FROM restaurant_audits au
            JOIN food_restaurants r ON r.id = au.restaurant_id
           WHERE r.business_id = $2
        )
      RETURNING a.id`,
    [userId, businessId, reassignTo]
  );

  // G-37: open business bookings owned by the departing member move to
  // the reassignment target the same way crew tasks do: the booking, its
  // deposit, and its appointment are preserved, only the provider moves.
  // The departing member's personal (non-business) bookings are untouched;
  // they are not business work. A double-booked target fails the whole
  // offboarding closed on the appointment overlap guard, like every other
  // failure in this transaction.
  const { rows: bookingsToMove } = await client.query(
    `SELECT id, appointment_id, business_appointment_id, conversation_id FROM booking_requests
      WHERE helper_id = $1 AND business_id = $2 AND status IN ('pending', 'accepted')`,
    [userId, businessId]
  );
  const bookings = await client.query(
    `UPDATE booking_requests
        SET helper_id = $3, updated_at = NOW()
      WHERE helper_id = $1 AND business_id = $2 AND status IN ('pending', 'accepted')
      RETURNING id`,
    [userId, businessId, reassignTo]
  );
  let appointmentsReassigned = 0;
  for (const row of bookingsToMove) {
    if (!row.appointment_id) continue;
    const moved = await client.query(
      `UPDATE appointments SET helper_id = $2, updated_at = NOW()
        WHERE id = $1 AND helper_id = $3 AND status <> 'cancelled'`,
      [row.appointment_id, reassignTo, userId]
    );
    appointmentsReassigned += moved.rowCount || 0;
  }
  // Business bookings link their appointment through
  // business_appointment_id instead: the staff member on the live
  // business appointment moves the same way.
  for (const row of bookingsToMove) {
    if (!row.business_appointment_id) continue;
    const moved = await client.query(
      `UPDATE business_appointments SET staff_id = $2, updated_at = NOW()
        WHERE id = $1 AND staff_id = $3 AND status IN ('pending', 'confirmed', 'in_progress')`,
      [row.business_appointment_id, reassignTo, userId]
    );
    appointmentsReassigned += moved.rowCount || 0;
  }
  for (const row of bookingsToMove) {
    if (!row.conversation_id) continue;
    await client.query(
      'UPDATE conversations SET helper_id = $2, updated_at = NOW() WHERE id = $1 AND helper_id = $3',
      [row.conversation_id, reassignTo, userId]
    );
  }

  // G5-3 (294): business-attributed OxSteed jobs move to the same
  // reassignment target as bookings and tasks, in this transaction.
  // jobs carry no business_id, so attribution is by link only: a job
  // reached through one of this business's bookings
  // (booking_requests.business_id -> appointments.job_id) or through
  // one of this business's team tasks (business_team_tasks.job_id).
  // Only live assigned jobs move ('accepted'/'in_progress' in the
  // job_status enum) with no open dispute (dispute_status 'open' /
  // 'under_review');
  // finished jobs stay as history, and unattributed jobs are the
  // member's own work and stay with them. Moving the row also
  // blocks the member: every job endpoint keys on client_id /
  // assigned_helper_id, so a removed member is no longer the assignee
  // and can no longer view, message on, or complete the job. Each move
  // writes a job_revisions row (D-474 pattern, source 'system') so the
  // client sees who held the job and who it moved to.
  let jobsReassigned = 0;
  if (reassignTo) {
    const { rows: jobsToMove } = await client.query(
      `SELECT j.id FROM jobs j
        WHERE j.assigned_helper_id = $1 AND j.deleted_at IS NULL
          AND j.status IN ('accepted', 'in_progress') AND j.dispute_status NOT IN ('open', 'under_review')
          AND (EXISTS (SELECT 1 FROM appointments a JOIN booking_requests br ON br.appointment_id = a.id
                        WHERE a.job_id = j.id AND br.business_id = $2)
            OR EXISTS (SELECT 1 FROM business_team_tasks t WHERE t.job_id = j.id AND t.business_id = $2))`,
      [userId, businessId]
    );
    for (const job of jobsToMove) {
      const { rows: [updated] } = await client.query(
        `UPDATE jobs SET assigned_helper_id = $2, version = version + 1, updated_at = NOW()
          WHERE id = $1 AND assigned_helper_id = $3 AND status IN ('accepted', 'in_progress') AND dispute_status NOT IN ('open', 'under_review')
          RETURNING version, revision`,
        [job.id, reassignTo, userId]
      );
      if (!updated) continue;
      await client.query(
        `INSERT INTO job_revisions
           (job_id, version, revision, is_material, source, actor_id, actor_role, reason, changes, snapshot,
            request_id, idempotency_key)
         VALUES ($1, $2, $3, TRUE, 'system', $4, 'system', 'Staff offboarding: job reassigned to manager', $5::jsonb, NULL, NULL, NULL)`,
        [job.id, updated.version, updated.revision, removedBy,
          JSON.stringify({ assigned_helper_id: { from: userId, to: reassignTo } })]
      );
      jobsReassigned += 1;
    }
  }

  // G5-32 (298): clear this business's workspace contexts for the
  // removed member on every removal path, not just self-leave.
  const contexts = await client.query(
    'DELETE FROM user_workspace_contexts WHERE user_id = $1 AND business_id = $2 RETURNING business_id',
    [userId, businessId]
  );

  // Audit fix (finding 32): a refresh token is a long-lived credential, not
  // a membership row. Revoke every refresh token for the offboarded user
  // inside the same transaction, so a revoked member cannot silently mint
  // new access tokens. Any failure rolls the offboarding back (fail closed).
  // NOTE: refresh tokens live in the `sessions` table (migration 027 dropped
  // the legacy refresh_tokens table; authController uses sessions).
  const refreshTokens = revokeAccountSessions ? await client.query(
    `UPDATE sessions SET is_valid = FALSE, revoked_at = NOW()
      WHERE user_id = $1 AND is_valid = TRUE
      RETURNING id`,
    [userId]
  ) : {rowCount:0};

  const counts = {
    pinsDeactivated: pins.rowCount || 0,
    sessionsEnded: sessions.rowCount || 0,
    drawersFlagged: drawers.rowCount || 0,
    crewTasksReassigned: crewTasks.rowCount || 0,
    teamTasksReassigned: teamTasks.rowCount || 0,
    correctiveActionsReassigned: correctiveActions.rowCount || 0,
    bookingsReassigned: bookings.rowCount || 0,
    appointmentsReassigned,
    jobsReassigned,
    workspaceContextsCleared: contexts.rowCount || 0,
    reassignedToUserId: reassignTo,
    refreshTokensRevoked: refreshTokens.rowCount || 0,
  };

  // S-11: the offboarding record + retention deadline, written in the
  // same transaction as everything it describes.
  const { rows: [record] } = await client.query(
    `INSERT INTO staff_offboarding_records
       (business_id, membership_id, user_id, removed_by, reason,
        pins_deactivated, sessions_ended, drawers_flagged,
        crew_tasks_reassigned, corrective_actions_reassigned,
        bookings_reassigned, appointments_reassigned, jobs_reassigned,
        reassigned_to_user_id, retain_until, team_tasks_reassigned)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            (CURRENT_DATE + (COALESCE(b.staff_record_retention_years, 7) * INTERVAL '1 year'))::date,$15
       FROM businesses b
      WHERE b.id = $1
     RETURNING *`,
    [
      businessId, membershipId, userId, removedBy, reason,
      counts.pinsDeactivated, counts.sessionsEnded, counts.drawersFlagged,
      counts.crewTasksReassigned, counts.correctiveActionsReassigned,
      counts.bookingsReassigned, counts.appointmentsReassigned,
      counts.jobsReassigned,
      reassignTo,
      counts.teamTasksReassigned,
    ]
  );

  return { ...counts, offboardingRecord: record || null };
}

module.exports = { applyStaffOffboarding };
