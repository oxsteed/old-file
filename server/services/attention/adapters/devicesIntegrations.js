'use strict';

/**
 * devices_integrations adapter — disconnected integrations.
 * Source: business_integrations, using ONLY recorded state:
 * is_connected=false, or a recorded last_error. A stale last_sync_at is
 * never treated as a disconnect (spec: never infer from missing feeds).
 */

const { buildItem, makeTracker } = require('../utils');

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'business_integrations');

  if (!(await ctx.tableExists('business_integrations'))) {
    track.done(true, 'table business_integrations is missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT id, integration_type, integration_name, is_connected,
            is_enabled, last_error, updated_at, created_at
       FROM business_integrations
      WHERE business_id = $1
        AND (is_connected = FALSE OR last_error IS NOT NULL)`,
    [business.id]
  );

  for (const g of rows) {
    track.touch(g.updated_at || g.created_at);
    const hasError = g.last_error != null && String(g.last_error).trim() !== '';
    items.push(buildItem({
      category: 'devices_integrations',
      sourceType: 'business_integration',
      sourceId: g.id,
      business,
      reason: hasError
        ? 'attention.reasons.syncFailed'
        : 'attention.reasons.integrationDisconnected',
      reasonParams: {
        integrationName: g.integration_name || g.integration_type || '',
        integrationType: g.integration_type || '',
      },
      urgency: hasError ? 'high' : 'normal',
      createdAt: g.updated_at || g.created_at,
      deadlineAt: null,
      taskDestination: {
        type: 'route',
        route: `/business/${business.id}/integrations`,
        params: { integrationId: String(g.id) },
      },
    }, ctx));
  }

  track.done(false);
  return { items, freshness };
}

module.exports = { collect };
