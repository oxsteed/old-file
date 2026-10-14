'use strict';

/**
 * customer_followup adapter — open support cases awaiting business response.
 * Source: restaurant_support_cases (restaurant → business).
 * Statuses awaiting the restaurant: new, awaiting_restaurant, reopened,
 * escalated. awaiting_customer / awaiting_oxsteed / resolved / closed await
 * only another party and are excluded.
 */

const { buildItem, makeTracker } = require('../utils');

const NEW_HIGH_AFTER_MS = 24 * 3600 * 1000;

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'restaurant_support_cases');

  if (!(await ctx.tableExists('restaurant_support_cases'))
      || !(await ctx.tableExists('food_restaurants'))) {
    track.done(true, 'restaurant_support_cases/food_restaurants tables are missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT sc.id, sc.public_case_number, sc.status, sc.issue_type, sc.title,
            sc.created_at, sc.updated_at,
            fr.id AS restaurant_id, fr.display_name AS restaurant_name
       FROM restaurant_support_cases sc
       JOIN food_restaurants fr ON fr.id = sc.restaurant_id
      WHERE fr.business_id = $1
        AND sc.status IN ('new', 'awaiting_restaurant', 'reopened', 'escalated')`,
    [business.id]
  );

  for (const c of rows) {
    track.touch(c.updated_at || c.created_at);
    const restaurant = {
      id: Number(c.restaurant_id),
      name: c.restaurant_name || `Restaurant ${c.restaurant_id}`,
    };
    let urgency = 'normal';
    if (c.status === 'escalated') urgency = 'urgent';
    else if (c.status === 'awaiting_restaurant' || c.status === 'reopened') urgency = 'high';
    else if (ctx.now - new Date(c.created_at) > NEW_HIGH_AFTER_MS) urgency = 'high';

    items.push(buildItem({
      category: 'customer_followup',
      sourceType: 'support_case',
      sourceId: c.id,
      business,
      restaurant,
      reason: 'attention.reasons.complaintAwaiting',
      reasonParams: {
        caseNumber: c.public_case_number || '',
        issueType: c.issue_type || '',
        title: c.title || '',
      },
      urgency,
      createdAt: c.created_at,
      deadlineAt: null,
      taskDestination: {
        type: 'route',
        route: `/business/${business.id}/support`,
        params: { caseId: String(c.id) },
      },
    }, ctx));
  }

  track.done(false);
  return { items, freshness };
}

module.exports = { collect };
