'use strict';
const pool = require('../db');
const { withTransaction } = require('../utils/transaction');
const { lockVideoIdentity, normalizeSubmittedVideoUrl } = require('../utils/learnVideoIdentity');
const { logAdminAction } = require('./auditService');
const { enqueueLearnReviewNotice } = require('./learnVideoReviewAlerts');

async function lockGuides(client, guideIds) {
  return (await client.query('SELECT id,status FROM learn_guides WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE', [guideIds])).rows;
}
async function isBlocked(client, guideId, identity) {
  return (await client.query('SELECT 1 FROM learn_guide_video_moderation_blocks WHERE guide_id=$1 AND video_identity=$2', [guideId,identity])).rows.length > 0;
}
async function isPublished(client, guideId, identity, exceptId = null) {
  return (await client.query(`SELECT 1 FROM learn_guide_videos
    WHERE guide_id=$1 AND learn_video_identity(video_url)=$2 AND ($3::uuid IS NULL OR id<>$3::uuid)
    UNION SELECT 1 FROM learn_guides WHERE id=$1 AND learn_video_identity(video_url)=$2 LIMIT 1`, [guideId,identity,exceptId])).rows.length > 0;
}
async function recordBlock(client, sub, identity, reason, adminId) {
  await client.query(`INSERT INTO learn_guide_video_moderation_blocks(guide_id,video_identity,video_url,reason,decided_by)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(guide_id,video_identity) DO NOTHING`, [sub.guide_id,identity,sub.video_url,reason,adminId]);
}

// Caller has locked identity, guide and submission, in that order.
async function publishReviewedVideo(client, sub) {
  const normalized = normalizeSubmittedVideoUrl(sub.video_url);
  if (!normalized || await isBlocked(client, sub.guide_id, normalized.identity)) return 'blocked';
  if (await isPublished(client, sub.guide_id, normalized.identity)) return 'superseded';
  const inserted = await client.query(`INSERT INTO learn_guide_videos(guide_id,video_url,video_provider,source,submitted_by)
    VALUES($1,$2,$3,'community',$4) ON CONFLICT(guide_id,video_url) DO NOTHING RETURNING id`,
    [sub.guide_id,normalized.url,normalized.provider,sub.submitted_by]);
  return inserted.rowCount > 0 ? 'live' : 'superseded';
}

async function reviewVideoSubmission(id, decision, adminId, req) {
  return withTransaction(pool, async client => {
    const preview = (await client.query('SELECT * FROM learn_guide_video_submissions WHERE id=$1', [id])).rows[0];
    if (!preview) return { error: 'not_found' };
    const { identity } = await lockVideoIdentity(client, preview.video_url);
    await lockGuides(client, [preview.guide_id]);
    const sub = (await client.query('SELECT * FROM learn_guide_video_submissions WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!sub) return { error: 'not_found' };
    if (sub.status !== 'pending') return { error: 'already_decided' };
    let status;
    if (decision === 'approve') status = await publishReviewedVideo(client, sub);
    else { status = 'blocked'; await recordBlock(client, sub, identity, 'blocked', adminId); }
    await client.query(`UPDATE learn_guide_video_submissions SET status=$1,decided_at=NOW(),decided_by=$2 WHERE id=$3 AND status='pending'`, [status,adminId,id]);
    await logAdminAction({ client, adminId, action: `learn_video_${decision}`, targetType: 'learn_video_submission', targetId: id,
      before: { status: sub.status }, after: { status }, req, throwOnError: true });
    return status === 'blocked' && decision === 'approve' ? { error: 'moderated' } : { ok: true, status };
  }, 'learn_video_review');
}

async function reviewVideoFlag(flagId, adminId, action, targetGuideId, req) {
  return withTransaction(pool, async client => {
    const preview = (await client.query(`SELECT v.video_url FROM learn_guide_video_flags f
      JOIN learn_guide_videos v ON v.id=f.video_id WHERE f.id=$1`, [flagId])).rows[0];
    if (!preview) return { error: 'not_found' };
    const { identity } = await lockVideoIdentity(client, preview.video_url);
    const flag = (await client.query(`SELECT f.id,f.video_id,f.status,v.guide_id,v.video_url FROM learn_guide_video_flags f
      JOIN learn_guide_videos v ON v.id=f.video_id WHERE f.id=$1 FOR UPDATE OF f,v`, [flagId])).rows[0];
    if (!flag) return { error: 'not_found' };
    if (flag.status !== 'open') return { error: 'already_decided' };
    const guides = await lockGuides(client, action === 'move' ? [flag.guide_id,targetGuideId] : [flag.guide_id]);
    if (action === 'dismiss') {
      await client.query("UPDATE learn_guide_video_flags SET status='dismissed',decided_at=NOW(),decided_by=$1 WHERE id=$2", [adminId,flagId]);
    } else if (action === 'move') {
      if (!guides.some(g => g.id === targetGuideId && g.status === 'published')) return { error: 'bad_guide' };
      if (await isBlocked(client,targetGuideId,identity)) return { error: 'moderated' };
      if (await isPublished(client,targetGuideId,identity,flag.video_id)) return { error: 'duplicate' };
      await client.query('UPDATE learn_guide_videos SET guide_id=$1 WHERE id=$2', [targetGuideId,flag.video_id]);
      await client.query("UPDATE learn_guide_video_flags SET status='resolved',decided_at=NOW(),decided_by=$1 WHERE video_id=$2 AND status='open'", [adminId,flag.video_id]);
    } else if (action === 'delete') {
      await recordBlock(client,flag,identity,'flag_deleted',adminId);
      // Retain the moderation identity before FK cascades remove flags/votes.
      await client.query(`UPDATE learn_guide_video_submissions SET status='blocked',decided_at=NOW(),decided_by=$1
        WHERE guide_id=$2 AND learn_video_identity(video_url)=$3 AND status='pending'`, [adminId,flag.guide_id,identity]);
      await client.query('DELETE FROM learn_guide_videos WHERE id=$1', [flag.video_id]);
    }
    await logAdminAction({ client, adminId, action: `learn_video_flag_${action}`, targetType: 'learn_video_flag', targetId: flagId,
      before: { status: flag.status, guide_id: flag.guide_id, video_id: flag.video_id },
      after: { status: action === 'delete' ? 'deleted' : action === 'dismiss' ? 'dismissed' : 'resolved', guide_id: targetGuideId || flag.guide_id }, req, throwOnError: true });
    return { ok: true };
  }, 'learn_video_flag_review');
}

module.exports = { lockGuides, isBlocked, publishReviewedVideo, reviewVideoSubmission, reviewVideoFlag, enqueueLearnReviewNotice };
