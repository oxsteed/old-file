'use strict';

/**
 * team_access adapter — pending membership approvals.
 * Source: business_members (status='pending'). Failed invites have no
 * recorded failure state in the schema, so only pending is actionable.
 */

const { buildItem, makeTracker } = require('../utils');

const STALE_INVITE_AFTER_MS = 7 * 24 * 3600 * 1000;

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'business_members');

  if (!(await ctx.tableExists('business_members'))) {
    track.done(true, 'table business_members is missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT id, invite_email, role, invited_at
       FROM business_members
      WHERE business_id = $1 AND status = 'pending'`,
    [business.id]
  );

  for (const m of rows) {
    track.touch(m.invited_at);
    const ageMs = ctx.now - new Date(m.invited_at);
    items.push(buildItem({
      category: 'team_access',
      sourceType: 'member_invite',
      sourceId: m.id,
      business,
      reason: 'attention.reasons.membershipApproval',
      reasonParams: { email: m.invite_email || '', role: m.role || '' },
      urgency: ageMs > STALE_INVITE_AFTER_MS ? 'high' : 'normal',
      createdAt: m.invited_at,
      deadlineAt: null,
      taskDestination: {
        type: 'route',
        route: `/business/${business.id}/team`,
        params: { inviteId: String(m.id) },
      },
    }, ctx));
  }

  track.done(false);
  return { items, freshness };
}

module.exports = { collect };
