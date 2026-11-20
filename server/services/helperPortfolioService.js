'use strict';
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const access = require('./access/accessService');
const crypto = require('crypto');
const storage = require('../utils/storage');
const AppError = require('../utils/appError');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status, code) => { throw new AppError(code, status, code); };
async function jobFor(db, jobId, userId, write = false) {
  if (!UUID.test(jobId || '')) fail(400, 'validation_failed');
  const { rows: [job] } = await db.query(`SELECT id,client_id,assigned_helper_id,status FROM jobs WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ''}`, [jobId]);
  const owner = job && String(job.client_id) === String(userId);
  if (!job || (!owner && String(job.assigned_helper_id) !== String(userId))) fail(404, 'not_found');
  if (!owner && !(await access.can(userId, 'helper.offer_services', undefined, db)).allowed) fail(403, 'access_required');
  return { job, owner };
}
async function list(jobId, userId) {
  const { job, owner } = await jobFor(pool, jobId, userId);
  const { rows } = await pool.query(`SELECT p.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('status',e.status,'created_at',e.created_at) ORDER BY e.id) FROM helper_portfolio_events e WHERE e.request_id=p.id),'[]'::jsonb) AS events FROM helper_portfolio_requests p WHERE p.job_id=$1 AND ($2::boolean OR p.helper_id=$3) ORDER BY p.created_at DESC LIMIT 20`, [jobId, owner, userId]);
  const requests = await Promise.all(rows.map(async ({storage_key, ...row}) => ({...row, media_url: storage_key ? await storage.getSignedDownloadUrl(storage_key, 300) : null})));
  return { requests, customer: owner, can_request: !owner && ['completed', 'closed'].includes(job.status) };
}
async function upload(jobId, userId, file) {
  const { job, owner } = await jobFor(pool, jobId, userId);
  if (owner || !['completed','closed'].includes(job.status)) fail(403, 'access_required');
  if (!file?.buffer || !String(file.mimetype).startsWith('image/')) fail(400, 'validation_failed');
  // Decode and re-encode: discard metadata and never serve SVG/HTML or caller
  // supplied MIME headers through the consent image endpoint.
  let buffer;
  try { buffer = await require('sharp')(file.buffer, {limitInputPixels:25000000}).rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer(); }
  catch { fail(400, 'validation_failed'); }
  const key = await storage.uploadFile(buffer, `portfolio-private/${userId}/${jobId}`, 'portfolio.jpg', 'image/jpeg');
  if (!key) fail(503, 'storage_unavailable');
  return { key };
}
async function create(jobId, userId, body) {
  if (!UUID.test(body?.requestId || '') || typeof body.caption !== 'string' || !body.caption.trim() || body.caption.length > 200) fail(400, 'validation_failed');
  const key = body.storage_key;
  const prefix = `portfolio-private/${userId}/${jobId}/`;
  if (typeof key !== 'string' || !key.startsWith(prefix) || !/^[a-zA-Z0-9_.-]+\.jpg$/.test(key.slice(prefix.length)) || key.length > 500) fail(400, 'validation_failed');
  return withTransaction(pool, async db => {
    const { job, owner } = await jobFor(db, jobId, userId, true);
    if (owner) fail(403, 'access_required');
    if (!['completed', 'closed'].includes(job.status)) fail(409, 'work_not_complete');
    const { rows: [prior] } = await db.query('SELECT * FROM helper_portfolio_requests WHERE helper_id=$1 AND request_id=$2', [userId, body.requestId]);
    if (prior) {
      if (prior.job_id !== jobId || prior.storage_key !== key || prior.caption !== body.caption.trim()) fail(409, 'idempotency_conflict');
      return prior;
    }
    const { rows: [count] } = await db.query('SELECT COUNT(*)::int AS n FROM helper_portfolio_requests WHERE job_id=$1', [jobId]);
    if (count.n >= 20) fail(409, 'request_limit');
    const stored = await storage.getObjectStream(key);
    if (!stored) fail(400, 'validation_failed');
    stored.destroy();
    const requestId = crypto.randomUUID();
    const url = `/api/helpers/portfolio/${requestId}/image`;
    const { rows: [row] } = await db.query(`INSERT INTO helper_portfolio_requests(id,job_id,helper_id,customer_id,media_url,caption,request_id,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [requestId, jobId, userId, job.client_id, url, body.caption.trim(), body.requestId, key]);
    await db.query("INSERT INTO helper_portfolio_events(request_id,actor_id,status) VALUES($1,$2,'pending')", [row.id, userId]);
    return row;
  }, 'portfolio_request_create');
}
async function image(requestId, userId = null, jobId = null) {
  if (!UUID.test(requestId || '')) fail(404, 'not_found');
  const {rows:[row]} = await pool.query('SELECT * FROM helper_portfolio_requests WHERE id=$1',[requestId]);
  if (!row || !row.storage_key) fail(404, 'not_found');
  if (userId) {
    if (row.job_id !== jobId) fail(404, 'not_found');
    const {owner} = await jobFor(pool, row.job_id, userId);
    if (!owner && row.helper_id !== userId) fail(404, 'not_found');
  } else {
    if (row.status !== 'approved' || !(await access.can(row.helper_id, 'helper.offer_services')).allowed) fail(404, 'not_found');
  }
  const stream = await storage.getObjectStream(row.storage_key);
  if (!stream) fail(404, 'not_found');
  return stream;
}
async function decide(jobId, requestId, userId, body) {
  if (!UUID.test(requestId || '') || !Number.isInteger(body?.expectedVersion) || !['approved','declined','revoked','withdrawn'].includes(body.status)) fail(400, 'validation_failed');
  return withTransaction(pool, async db => {
    const { owner } = await jobFor(db, jobId, userId, true);
    const { rows: [row] } = await db.query('SELECT * FROM helper_portfolio_requests WHERE id=$1 AND job_id=$2 FOR UPDATE', [requestId, jobId]);
    if (!row || (!owner && String(row.helper_id) !== String(userId))) fail(404, 'not_found');
    if (owner ? body.status === 'withdrawn' : body.status !== 'withdrawn') fail(403, 'access_required');
    if (row.version !== body.expectedVersion) fail(409, 'portfolio_version_conflict');
    const allowed = row.status === 'pending' ? ['approved','declined','withdrawn'] : row.status === 'approved' ? ['revoked','withdrawn'] : [];
    if (!allowed.includes(body.status)) fail(409, 'portfolio_locked');
    // A customer may revoke even after helper authority ends. A new approval
    // never publishes on behalf of a helper whose access has been removed.
    if (body.status === 'approved') {
      if (!(await access.can(row.helper_id, 'helper.offer_services', undefined, db)).allowed) fail(403, 'access_required');
      await db.query('INSERT INTO helper_gallery(user_id,url,caption,permission_request_id) VALUES($1,$2,$3,$4)', [row.helper_id, row.media_url, row.caption, row.id]);
    } else {
      await db.query('DELETE FROM helper_gallery WHERE permission_request_id=$1', [row.id]);
    }
    const { rows: [updated] } = await db.query('UPDATE helper_portfolio_requests SET status=$2,version=version+1,updated_at=NOW() WHERE id=$1 RETURNING *', [row.id, body.status]);
    await db.query('INSERT INTO helper_portfolio_events(request_id,actor_id,status) VALUES($1,$2,$3)', [row.id, userId, body.status]);
    return updated;
  }, 'portfolio_request_decide');
}
module.exports = { list, create, decide, upload, image };
