'use strict';

/**
 * messages adapter.
 * Sources: business_conversations + business_messages.
 * A customer conversation needs attention when the latest non-deleted message
 * is from the customer (awaiting business response). unread_count = customer
 * messages posted after the last team reply.
 */

const { buildItem, makeTracker } = require('../utils');

const HIGH_AFTER_MS = 24 * 3600 * 1000;
const URGENT_AFTER_MS = 48 * 3600 * 1000;

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const convTrack = makeTracker(freshness, 'business_conversations');
  const msgTrack = makeTracker(freshness, 'business_messages');

  if (!(await ctx.tableExists('business_conversations'))
      || !(await ctx.tableExists('business_messages'))) {
    convTrack.done(true, 'business_conversations/business_messages tables are missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT c.id, c.customer_name, c.customer_email, c.last_message_at,
            c.created_at, c.updated_at,
            (SELECT m.sender_type FROM business_messages m
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC LIMIT 1) AS last_sender_type,
            (SELECT m.created_at FROM business_messages m
              WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
              ORDER BY m.created_at DESC LIMIT 1) AS last_message_created,
            (SELECT COUNT(*) FROM business_messages m
              WHERE m.conversation_id = c.id
                AND m.deleted_at IS NULL
                AND m.sender_type = 'customer'
                AND m.created_at > COALESCE((
                  SELECT MAX(m2.created_at) FROM business_messages m2
                  WHERE m2.conversation_id = c.id
                    AND m2.deleted_at IS NULL
                    AND m2.sender_type = 'team_member'
                ), '1970-01-01'::timestamptz)) AS unread_count
       FROM business_conversations c
      WHERE c.business_id = $1
        AND c.conversation_type = 'customer'
        AND c.status = 'active'`,
    [business.id]
  );

  for (const c of rows) {
    convTrack.touch(c.updated_at || c.last_message_at || c.created_at);
    msgTrack.touch(c.last_message_at);
    if (c.last_sender_type !== 'customer') continue; // team already replied
    const unread = Number(c.unread_count) || 0;
    if (unread <= 0) continue;

    const lastAt = c.last_message_created ? new Date(c.last_message_created) : null;
    const waitingMs = lastAt ? ctx.now - lastAt : 0;
    const urgency = waitingMs > URGENT_AFTER_MS ? 'urgent'
      : waitingMs > HIGH_AFTER_MS ? 'high' : 'normal';

    items.push(buildItem({
      category: 'messages',
      sourceType: 'business_conversation',
      sourceId: c.id,
      business,
      reason: 'attention.reasons.unreadMessages',
      reasonParams: {
        count: unread,
        customerName: c.customer_name || c.customer_email || '',
      },
      urgency,
      createdAt: c.last_message_created || c.created_at,
      deadlineAt: null,
      taskDestination: {
        type: 'route',
        route: `/business/${business.id}/messages`,
        params: { conversationId: String(c.id) },
      },
    }, ctx));
  }

  convTrack.done(false);
  msgTrack.done(false);
  return { items, freshness };
}

module.exports = { collect };
