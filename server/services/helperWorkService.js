'use strict';
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const access = require('./access/accessService');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { sendNotification } = require('./notificationService');
// Group 4 rest (179, 180): the customer hears about a new progress update or
// a changed completion handover. Best-effort, after commit, idempotent.
async function tellCustomer(job, type, key, data) {
  if (!job?.client_id) return;
  try {
    await sendNotification({ userId: job.client_id, type, data: { job_id: job.id, ...data },
      action_url: `/jobs/${job.id}`, idempotencyKey: key });
  } catch (error) {
    logger.warn('Helper work customer notification failed', { jobId: job.id, type, error: error.message });
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function invalid() { throw new AppError('Invalid work details', 400, 'validation_failed'); }
function text(value, max) {
  if (typeof value !== 'string' || value.length > max) invalid();
  return value.trim();
}
function checklist(value) {
  if (!Array.isArray(value) || value.length > 40) invalid();
  return value.map(item => {
    if (!item || typeof item.done !== 'boolean') invalid();
    const label = text(item.label, 200);
    if (!label) invalid();
    return { label, done: item.done };
  });
}
async function helper(db, userId) {
  const decision = await access.can(userId, 'helper.offer_services', undefined, db);
  if (!decision.allowed) throw new AppError('Effective helper access required', 403, 'access_required');
}
async function jobFor(db, jobId, userId, write = false) {
  if (!UUID.test(jobId || '')) invalid();
  const { rows: [job] } = await db.query(
    `SELECT id, client_id, assigned_helper_id, status FROM jobs WHERE id = $1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ''}`, [jobId]);
  if (!job || (String(job.client_id) !== String(userId) && String(job.assigned_helper_id) !== String(userId))) {
    throw new AppError('Job not found', 404, 'not_found');
  }
  if (write || String(job.assigned_helper_id) === String(userId)) {
    if (String(job.assigned_helper_id) !== String(userId)) throw new AppError('Job not found', 404, 'not_found');
    await helper(db, userId);
  }
  if (write && !['accepted', 'in_progress', 'completed', 'closed'].includes(job.status)) {
    throw new AppError('Work record is read only', 409, 'work_read_only');
  }
  return job;
}
async function read(jobId, userId) {
  return withTransaction(pool, async db => {
    const job = await jobFor(db, jobId, userId);
    const { rows: [saved] } = await db.query('SELECT * FROM helper_job_work WHERE job_id=$1 AND helper_id=$2', [job.id, job.assigned_helper_id]);
    const { rows: updates } = await db.query('SELECT id, body, created_at FROM helper_work_updates WHERE job_id=$1 AND helper_id=$2 ORDER BY created_at DESC, id DESC LIMIT 100', [job.id, job.assigned_helper_id]);
    const own = String(job.assigned_helper_id) === String(userId);
    return { work: {
      version: saved?.version || 0, handover: saved?.handover || '', aftercare: saved?.aftercare || '',
      ...(own ? { checklist: saved?.checklist || [], private_notes: saved?.private_notes || '' } : {}),
    }, updates, writable: own && ['accepted','in_progress','completed','closed'].includes(job.status) };
  }, 'helper_work_read');
}
async function save(jobId, userId, body) {
  if (!body || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) invalid();
  const items = checklist(body.checklist);
  const notes = text(body.private_notes, 4000);
  const handover = text(body.handover, 4000);
  const aftercare = text(body.aftercare, 4000);
  const outcome = await withTransaction(pool, async db => {
    const job = await jobFor(db, jobId, userId, true);
    await db.query('INSERT INTO helper_job_work (job_id,helper_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [jobId,userId]);
    const { rows: [before] } = await db.query('SELECT handover FROM helper_job_work WHERE job_id=$1 AND helper_id=$2 FOR UPDATE', [jobId,userId]);
    const { rows: [row] } = await db.query(`UPDATE helper_job_work SET checklist=$3,private_notes=$4,handover=$5,aftercare=$6,version=version+1,updated_at=NOW()
      WHERE job_id=$1 AND helper_id=$2 AND version=$7 RETURNING version`, [jobId,userId,JSON.stringify(items),notes,handover,aftercare,body.expectedVersion]);
    if (!row) throw new AppError('Work record changed; reload before saving',409,'work_version_conflict');
    return { row, job, handoverChanged: !!handover && handover !== (before?.handover || '') };
  }, 'helper_work_save');
  if (outcome.handoverChanged) {
    await tellCustomer(outcome.job, 'helper_handover_updated', `helper-handover:${jobId}:${outcome.row.version}`, {});
  }
  return outcome.row;
}
async function publish(jobId,userId,body) {
  const message = text(body?.body,2000);
  if (!message || !UUID.test(body?.requestId || '')) invalid();
  const outcome = await withTransaction(pool, async db => {
    const job = await jobFor(db,jobId,userId,true);
    const { rows: [row] } = await db.query(`INSERT INTO helper_work_updates(job_id,helper_id,body,request_id) VALUES ($1,$2,$3,$4)
      ON CONFLICT (helper_id,request_id) DO NOTHING RETURNING id,body,created_at`,[jobId,userId,message,body.requestId]);
    if (row) return { row, job };
    const { rows: [prior] } = await db.query('SELECT id,job_id,body,created_at FROM helper_work_updates WHERE helper_id=$1 AND request_id=$2',[userId,body.requestId]);
    if (String(prior?.job_id) !== String(jobId) || prior.body !== message) throw new AppError('Retry key already used',409,'idempotency_conflict');
    return { row: { id:prior.id,body:prior.body,created_at:prior.created_at }, job: null };
  },'helper_work_publish');
  // Only a newly stored update notifies; a retried request does not.
  if (outcome.job) await tellCustomer(outcome.job, 'helper_progress_update', `helper-progress:${outcome.row.id}`, { update_id: outcome.row.id });
  return outcome.row;
}
async function board(userId) {
  await helper(pool,userId);
  return (await pool.query(`SELECT id,title,status,scheduled_date FROM jobs
    WHERE assigned_helper_id=$1 AND deleted_at IS NULL AND status IN ('accepted','in_progress','completed','closed')
    ORDER BY updated_at DESC,id DESC LIMIT 100`,[userId])).rows;
}
async function templates(userId) {
  await helper(pool,userId);
  return (await pool.query('SELECT id,name,items FROM helper_checklist_templates WHERE helper_id=$1 ORDER BY created_at DESC LIMIT 50',[userId])).rows;
}
async function createTemplate(userId,body) {
  const name = text(body?.name,100);
  const items = checklist(body?.items).map(item=>({...item,done:false}));
  if (!name || !items.length) invalid();
  return withTransaction(pool,async db=>{
    await helper(db,userId);
    // Serialize the bounded collection per account, including concurrent creates.
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const {rows:[count]}=await db.query('SELECT COUNT(*)::int AS total FROM helper_checklist_templates WHERE helper_id=$1',[userId]);
    if (count.total >= 50) throw new AppError('Template limit reached',409,'template_limit');
    return (await db.query('INSERT INTO helper_checklist_templates(helper_id,name,items) VALUES ($1,$2,$3) RETURNING id,name,items',[userId,name,JSON.stringify(items)])).rows[0];
  },'helper_template_create');
}
async function removeTemplate(userId,id) {
  if (!UUID.test(id || '')) invalid();
  await helper(pool,userId);
  const result=await pool.query('DELETE FROM helper_checklist_templates WHERE id=$1 AND helper_id=$2',[id,userId]);
  if (!result.rowCount) throw new AppError('Template not found',404,'not_found');
}
module.exports={read,save,publish,board,templates,createTemplate,removeTemplate};
