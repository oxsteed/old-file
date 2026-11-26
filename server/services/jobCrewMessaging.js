'use strict';
// G5-14 (271): a business crew member may message the customer of a job
// they are crewing. Jobs carry no business id, so the job's business is
// the assigned helper's earliest active membership business (the D-459
// pattern from jobExceptionService). Admission additionally requires the
// caller to hold messages.reply on that business, so a member who can
// only view assigned threads cannot write into a customer's job thread.
const pool = require('../db');
const { getEffectivePermissions } = require('./permissionsService');

// The business a job belongs to, via its assigned helper. Null when the
// job has no helper or the helper belongs to no active business.
async function jobCrewBusinessId(job) {
  if (!job?.assigned_helper_id) return null;
  const { rows: [m] } = await pool.query(
    `SELECT b.id FROM business_members bm JOIN businesses b ON b.id = bm.business_id
      WHERE bm.member_id = $1 AND bm.status = 'active' AND b.deleted_at IS NULL AND b.is_active = TRUE
      ORDER BY bm.accepted_at ASC NULLS LAST, bm.id ASC LIMIT 1`,
    [job.assigned_helper_id]
  );
  return m ? Number(m.id) : null;
}

// True when userId may message on the job's thread: the client, the
// assigned helper, or an active member (or the owner) of the job's
// business holding messages.reply. Scoped to this job only: the caller
// gains no access to any other job or business thread.
async function canCrewMessageJob(job, userId) {
  if (!job || !userId) return false;
  if (String(job.client_id) === String(userId)) return true;
  if (job.assigned_helper_id && String(job.assigned_helper_id) === String(userId)) return true;
  const businessId = await jobCrewBusinessId(job);
  if (!businessId) return false;
  const { rows: [m] } = await pool.query(
    `SELECT 'owner' AS role, NULL::bigint AS membership_id FROM businesses
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND is_active = TRUE
     UNION ALL
     SELECT role, id FROM business_members
      WHERE business_id = $1 AND member_id = $2 AND status = 'active'
     LIMIT 1`,
    [businessId, userId]
  );
  if (!m) return false;
  const { permissions } = await getEffectivePermissions({
    businessId, userId: String(userId), role: m.role, membershipId: m.membership_id,
  });
  return permissions.has('messages.reply');
}

// True when userId may read/send in a job-keyed conversation they are not
// a direct party to. queryable is pool or a transaction client.
async function isCrewMessengerForJobConversation(queryable, conversationId, userId) {
  const { rows: [c] } = await queryable.query(
    'SELECT job_id FROM conversations WHERE id = $1', [conversationId]
  );
  if (!c?.job_id) return false;
  const { rows: [job] } = await queryable.query(
    'SELECT id, client_id, assigned_helper_id FROM jobs WHERE id = $1', [c.job_id]
  );
  if (!job) return false;
  return canCrewMessageJob(job, userId);
}

module.exports = { jobCrewBusinessId, canCrewMessageJob, isCrewMessengerForJobConversation };
