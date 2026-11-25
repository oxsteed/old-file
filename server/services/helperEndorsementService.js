'use strict';
// Group 4 rest, item 194: skill endorsement record.
// Rules (Emile, 2026-11-23): only the customer of a completed engagement
// with the helper may endorse, only a skill the helper actually lists, and
// at most once per client per skill (DB-unique). The endorser may withdraw
// their own endorsement. Nothing here affects ranking, pricing, or payouts.
const pool = require('../db');
const AppError = require('../utils/appError');
const { requireHelper } = require('./helperReputationService');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE = ['completed', 'closed'];

async function completedJobForClient(jobId, clientId) {
  if (!UUID.test(jobId || '')) throw new AppError('Invalid job', 400, 'validation_failed');
  const { rows: [job] } = await pool.query(
    `SELECT id, client_id, assigned_helper_id, status FROM jobs
      WHERE id = $1 AND client_id = $2 AND deleted_at IS NULL`, [jobId, clientId]);
  if (!job || !job.assigned_helper_id) throw new AppError('Job not found', 404, 'not_found');
  if (!DONE.includes(job.status)) throw new AppError('Endorsements open once the job is completed', 409, 'endorsement_job_not_completed');
  return job;
}

// For the customer on a completed job: the helper's skills and which ones
// this customer already endorsed (from any of their jobs with the helper).
async function optionsForJob(clientId, jobId) {
  const job = await completedJobForClient(jobId, clientId);
  const { rows } = await pool.query(
    `SELECT hs.id, hs.skill_name, e.id AS endorsement_id
       FROM helper_skills hs
       LEFT JOIN helper_skill_endorsements e ON e.helper_skill_id = hs.id AND e.endorser_id = $2
      WHERE hs.user_id = $1
      ORDER BY hs.skill_name`, [job.assigned_helper_id, clientId]);
  return rows.map((r) => ({ helperSkillId: r.id, skill: r.skill_name, endorsementId: r.endorsement_id || null }));
}

async function endorse(clientId, jobId, body) {
  const skillId = Number(body?.helperSkillId);
  if (!Number.isInteger(skillId) || skillId <= 0) throw new AppError('Validation failed', 400, 'validation_failed', { helperSkillId: 'required' });
  const job = await completedJobForClient(jobId, clientId);
  const { rows: [skill] } = await pool.query('SELECT id FROM helper_skills WHERE id = $1 AND user_id = $2', [skillId, job.assigned_helper_id]);
  if (!skill) throw new AppError('Skill not found for this helper', 404, 'not_found');
  const { rows: [row] } = await pool.query(
    `INSERT INTO helper_skill_endorsements (helper_id, helper_skill_id, endorser_id, job_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endorser_id, helper_skill_id) DO NOTHING
     RETURNING id, created_at`, [job.assigned_helper_id, skillId, clientId, job.id]);
  if (!row) throw new AppError('You already endorsed this skill', 409, 'endorsement_exists');
  return { id: row.id, helperSkillId: skillId, createdAt: row.created_at };
}

async function withdraw(clientId, endorsementId) {
  if (!UUID.test(endorsementId || '')) throw new AppError('Invalid endorsement', 400, 'validation_failed');
  const result = await pool.query('DELETE FROM helper_skill_endorsements WHERE id = $1 AND endorser_id = $2', [endorsementId, clientId]);
  if (!result.rowCount) throw new AppError('Endorsement not found', 404, 'not_found');
}

// For the helper: their record, per skill, with endorser first names only.
async function myRecord(helperId) {
  await requireHelper(pool, helperId);
  const { rows } = await pool.query(
    `SELECT hs.id, hs.skill_name, COUNT(e.id)::int AS count, MAX(e.created_at) AS latest
       FROM helper_skills hs
       LEFT JOIN helper_skill_endorsements e ON e.helper_skill_id = hs.id
      WHERE hs.user_id = $1
      GROUP BY hs.id, hs.skill_name
      ORDER BY count DESC, hs.skill_name`, [helperId]);
  return rows.map((r) => ({ helperSkillId: r.id, skill: r.skill_name, count: r.count, latest: r.latest }));
}

// Public: endorsement counts by skill name for a helper's profile.
async function publicCounts(helperId, db = pool) {
  const { rows } = await db.query(
    `SELECT hs.skill_name, COUNT(e.id)::int AS count
       FROM helper_skill_endorsements e
       JOIN helper_skills hs ON hs.id = e.helper_skill_id
      WHERE e.helper_id = $1
      GROUP BY hs.skill_name`, [helperId]);
  return Object.fromEntries(rows.map((r) => [r.skill_name, r.count]));
}

module.exports = { optionsForJob, endorse, withdraw, myRecord, publicCounts };
