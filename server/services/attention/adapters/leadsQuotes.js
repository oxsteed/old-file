'use strict';

/**
 * leads_quotes adapter.
 * Source: business_quotes. Unresolved only: excludes declined/converted.
 * draft → awaiting estimate; sent → awaiting client approval; sent near
 * valid_until → follow-up due; expired (recent) → follow-up to renew.
 */

const { buildItem, makeTracker } = require('../utils');

const FOLLOWUP_WINDOW_MS = 3 * 24 * 3600 * 1000;
const SENT_HIGH_AFTER_MS = 7 * 24 * 3600 * 1000;
const EXPIRED_RECENT_MS = 30 * 24 * 3600 * 1000;

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'business_quotes');

  if (!(await ctx.tableExists('business_quotes'))) {
    track.done(true, 'table business_quotes is missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT id, client_name, title, status, total_cents, valid_until,
            created_at, updated_at
       FROM business_quotes
      WHERE business_id = $1
        AND status IN ('draft', 'sent', 'approved', 'expired')`,
    [business.id]
  );

  for (const q of rows) {
    track.touch(q.updated_at || q.created_at);
    const dest = {
      type: 'route',
      route: `/business/${business.id}/quotes`,
      params: { quoteId: String(q.id) },
    };
    const base = {
      category: 'leads_quotes',
      sourceType: 'business_quote',
      sourceId: q.id,
      business,
      reasonParams: { clientName: q.client_name || '', title: q.title || '' },
      createdAt: q.created_at,
      amountCents: q.total_cents,
      currencyCode: 'USD', // business_quotes stores dollar amounts; USD ledger
      taskDestination: dest,
    };
    const validUntil = q.valid_until ? new Date(q.valid_until) : null;

    if (q.status === 'draft') {
      items.push(buildItem({ ...base, reason: 'attention.reasons.quoteRequest', urgency: 'normal' }, ctx));
    } else if (q.status === 'sent') {
      const ageMs = ctx.now - new Date(q.created_at);
      const dueSoon = validUntil && (validUntil - ctx.now) < FOLLOWUP_WINDOW_MS;
      items.push(buildItem({
        ...base,
        reason: dueSoon ? 'attention.reasons.followupDeadline' : 'attention.reasons.quoteApproval',
        urgency: dueSoon || ageMs > SENT_HIGH_AFTER_MS ? 'high' : 'normal',
        deadlineAt: q.valid_until || null,
      }, ctx));
    } else if (q.status === 'approved') {
      items.push(buildItem({ ...base, reason: 'attention.reasons.quoteApproval', urgency: 'normal' }, ctx));
    } else if (q.status === 'expired') {
      const expiredMs = validUntil ? ctx.now - validUntil : null;
      if (expiredMs == null || expiredMs < EXPIRED_RECENT_MS) {
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.followupDeadline',
          urgency: 'low',
          deadlineAt: null,
        }, ctx));
      }
    }
  }

  track.done(false);
  return { items, freshness };
}

module.exports = { collect };
