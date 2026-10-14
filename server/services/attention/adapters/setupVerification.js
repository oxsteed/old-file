'use strict';

/**
 * setup_verification adapter — incomplete launch steps.
 * Source: business_setup_progress. One task naming the current incomplete
 * step (or "not started" when no progress row exists).
 * Rejected submissions / expired verification have no authoritative table;
 * reported as a stale source rather than invented.
 */

const { buildItem, makeTracker } = require('../utils');
const { loadBusinessSetupReadiness, isBusinessPublished } = require('../../businessSetupReadiness');

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'business_setup_progress');
  const verTrack = makeTracker(freshness, 'verification_reviews');

  // Match the actual setup permissions; employees cannot edit or publish.
  if (!['owner', 'manager'].includes(business.role)) return { items, freshness };
  const readiness = await loadBusinessSetupReadiness(ctx.pool, business.id);
  if (!readiness) throw new Error('Business readiness unavailable');

  if (!(await ctx.tableExists('business_setup_progress'))) {
    track.done(true, 'table business_setup_progress is missing');
  } else {
    const { rows } = await ctx.pool.query(
      `SELECT business_id, current_step, completed_steps, updated_at, created_at
         FROM business_setup_progress
        WHERE business_id = $1`,
      [business.id]
    );
    const progress = rows[0] || null;
    if (progress) track.touch(progress.updated_at || progress.created_at);

    // Saved navigation markers are not evidence of readiness. Published
    // businesses historically save "complete" without adding it to the array.
    const current = readiness.checks.find(check => !check.complete)?.id || 'publish';
    const isComplete = readiness.readyToPublish && isBusinessPublished(readiness.business);

    if (!isComplete) {
      items.push(buildItem({
        category: 'setup_verification',
        sourceType: 'setup_progress',
        sourceId: business.id,
        business,
        reason: 'attention.reasons.launchStep',
        reasonParams: { currentStep: current || 'identity', started: !!progress },
        urgency: 'normal',
        createdAt: (progress && (progress.updated_at || progress.created_at)) || new Date().toISOString(),
        deadlineAt: null,
        taskDestination: {
          type: 'component',
          component: 'BusinessOnboarding',
          route: `/business/${business.id}/onboarding`,
          params: {},
        },
      }, ctx));
    }
    track.done(false);
  }

  verTrack.done(true, 'no authoritative verification-review table; rejected/expired verifications cannot be determined');
  return { items, freshness };
}

module.exports = { collect };
