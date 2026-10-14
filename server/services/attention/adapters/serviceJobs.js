'use strict';

/**
 * service_jobs adapter — jobs assigned to the business owner as helper.
 * Sources: jobs, work_agreements, work_agreement_versions.
 * Unresolved only: matched (awaiting accept), negotiating, accepted-but-not-
 * started, in_progress past scheduled end. Completed/cancelled/closed are
 * terminal or await only the other party.
 */

const { buildItem, makeTracker } = require('../utils');

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const jobTrack = makeTracker(freshness, 'jobs');
  const verTrack = makeTracker(freshness, 'work_agreement_versions');

  const ownerUserId = business.user_id;

  if (await ctx.tableExists('jobs')) {
    const { rows } = await ctx.pool.query(
      `SELECT id, title, status, scheduled_start_at, scheduled_end_at,
              started_at, created_at, updated_at
         FROM jobs
        WHERE assigned_helper_id = $1
          AND status IN ('matched', 'negotiating', 'accepted', 'in_progress')`,
      [ownerUserId]
    );
    for (const j of rows) {
      jobTrack.touch(j.updated_at || j.created_at);
      const dest = {
        type: 'route',
        route: `/business/${business.id}/jobs`,
        params: { jobId: String(j.id) },
      };
      const base = {
        category: 'service_jobs',
        sourceType: 'job',
        sourceId: j.id,
        business,
        reasonParams: { title: j.title || '' },
        createdAt: j.created_at,
        taskDestination: dest,
      };
      const startAt = j.scheduled_start_at ? new Date(j.scheduled_start_at) : null;
      const endAt = j.scheduled_end_at ? new Date(j.scheduled_end_at) : null;

      if (j.status === 'matched') {
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.jobAssignment',
          urgency: 'high',
          deadlineAt: j.scheduled_start_at || null,
        }, ctx));
      } else if (j.status === 'negotiating') {
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.awaitingResponse',
          urgency: 'normal',
          deadlineAt: null,
        }, ctx));
      } else if (j.status === 'accepted' && !j.started_at) {
        const overdueStart = startAt && startAt < ctx.now;
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.jobAssignment',
          urgency: overdueStart ? 'high' : 'normal',
          deadlineAt: j.scheduled_start_at || null,
        }, ctx));
      } else if (j.status === 'in_progress' && endAt && endAt < ctx.now) {
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.overdueJob',
          reasonParams: { title: j.title || '', daysOverdue: Math.floor((ctx.now - endAt) / 86400000) },
          urgency: 'urgent',
          deadlineAt: j.scheduled_end_at,
        }, ctx));
      }
    }
    jobTrack.done(false);
  } else {
    jobTrack.done(true, 'table jobs is missing');
  }

  // Change requests: a newer agreement version drafted by the customer that
  // the business owner has not yet signed.
  if (await ctx.tableExists('work_agreement_versions')
      && await ctx.tableExists('work_agreements')
      && await ctx.tableExists('jobs')
      && await ctx.tableExists('work_agreement_signatures')) {
    const { rows } = await ctx.pool.query(
      `SELECT v.id, v.agreement_id, v.version_number, v.created_by, v.created_at
         FROM work_agreement_versions v
         JOIN work_agreements wa ON wa.id = v.agreement_id
         JOIN jobs j ON j.id = wa.job_id
        WHERE j.assigned_helper_id = $1
          AND wa.status IN ('pending_signatures', 'active')
          AND v.version_number > 1
          AND v.created_by IS DISTINCT FROM $1
          AND NOT EXISTS (
            SELECT 1 FROM work_agreement_signatures s
            WHERE s.version_id = v.id AND s.signer_id = $1
          )`,
      [ownerUserId]
    );
    for (const v of rows) {
      verTrack.touch(v.created_at);
      items.push(buildItem({
        category: 'service_jobs',
        sourceType: 'agreement_version',
        sourceId: v.id,
        business,
        reason: 'attention.reasons.jobChangeRequest',
        reasonParams: { versionNumber: v.version_number },
        urgency: 'high',
        createdAt: v.created_at,
        deadlineAt: null,
        taskDestination: {
          type: 'route',
          route: `/business/${business.id}/agreements`,
          params: { agreementId: String(v.agreement_id), versionId: String(v.id) },
        },
      }, ctx));
    }
    verTrack.done(false);
  } else {
    verTrack.done(true, 'work agreement version/signature tables are missing');
  }

  return { items, freshness };
}

module.exports = { collect };
