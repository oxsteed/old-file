'use strict';

const crypto = require('crypto');
const pool = require('../db');
const logger = require('../utils/logger');
const WebSocketService = require('../services/websocketService');
const { withTransaction } = require('../utils/transaction');

const CHANNELS = new Set(['email', 'sms', 'phone', 'social']);
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;

function normalize(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function configuredBusinessId() {
  const value = Number.parseInt(process.env.SUPPORT_CHANNEL_WEBHOOK_BUSINESS_ID, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function getWebhookSecret(channel) {
  const channelEnv = `SUPPORT_${channel.toUpperCase()}_WEBHOOK_SECRET`;
  return process.env[channelEnv] || process.env.SUPPORT_CHANNEL_WEBHOOK_SECRET || '';
}

function rawRequestBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  return Buffer.from(JSON.stringify(req.body || {}));
}

function validSignature(rawBody, signature, secret) {
  const supplied = String(signature || '').trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]{64}$/i.test(supplied) || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function parsePayload(req) {
  const rawBody = rawRequestBody(req);
  if (rawBody.length > MAX_PAYLOAD_BYTES) return { error: 'Webhook payload is too large' };
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { error: 'Webhook payload must be valid JSON' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'Webhook payload must be an object' };

  const channel = normalize(req.params.channel, 20).toLowerCase();
  const payloadChannel = normalize(payload.channel, 20).toLowerCase();
  if (!CHANNELS.has(channel) || (payloadChannel && payloadChannel !== channel)) return { error: 'Unsupported or mismatched support channel' };

  const eventId = normalize(payload.eventId || payload.event_id || req.get?.('x-event-id'), 255);
  const externalThreadId = normalize(payload.externalThreadId || payload.external_thread_id || payload.threadId, 255);
  const externalMessageId = normalize(payload.externalMessageId || payload.external_message_id || payload.messageId, 255) || null;
  const customerEmail = normalize(payload.customerEmail || payload.customer_email || payload.from, 320).toLowerCase();
  const content = normalize(payload.content || payload.message || payload.text, 5000);
  const subject = normalize(payload.subject, 200) || `${channel} support request`;
  const customerName = normalize(payload.customerName || payload.customer_name || payload.fromName, 255) || 'Customer';
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? payload.metadata : {};

  if (!eventId || !externalThreadId || !customerEmail || !EMAIL_PATTERN.test(customerEmail) || !content) {
    return { error: 'eventId, externalThreadId, customerEmail, and content are required' };
  }
  if (JSON.stringify(metadata).length > 10000) return { error: 'Channel metadata is too large' };

  return {
    rawBody,
    channel,
    eventId,
    externalThreadId,
    externalMessageId,
    customerEmail,
    customerName,
    subject,
    content,
    metadata,
  };
}

async function ingestChannelWebhook(req, res) {
  const payload = parsePayload(req);
  if (payload.error) return res.status(400).json({ error: payload.error });

  const secret = getWebhookSecret(payload.channel);
  if (!secret) return res.status(503).json({ error: 'Support channel webhook is not configured' });
  const signature = req.get?.('x-oxsteed-signature') || req.get?.('x-hub-signature-256');
  if (!validSignature(payload.rawBody, signature, secret)) return res.status(401).json({ error: 'Invalid webhook signature' });

  const businessId = configuredBusinessId();
  if (!businessId) return res.status(503).json({ error: 'Support channel webhook business is not configured' });
  const payloadHash = crypto.createHash('sha256').update(payload.rawBody).digest('hex');

  try {
    const result = await withTransaction(pool, async (client) => {
      const event = await client.query(
        `INSERT INTO support_channel_events
           (channel, event_id, external_thread_id, external_message_id, business_id, payload_hash, status, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'processed', NOW())
         ON CONFLICT (channel, event_id) DO NOTHING
         RETURNING id`,
        [payload.channel, payload.eventId, payload.externalThreadId, payload.externalMessageId, businessId, payloadHash]
      );
      if (!event.rows.length) {
        const existing = await client.query(
          `SELECT conversation_id FROM support_channel_events WHERE channel = $1 AND event_id = $2`,
          [payload.channel, payload.eventId]
        );
        return { duplicate: true, conversationId: existing.rows[0]?.conversation_id || null };
      }

      const conversationResult = await client.query(
        `INSERT INTO support_conversations
           (business_id, customer_id, guest_name, guest_email, guest_verified_at,
            subject, description, category, priority, channel, external_thread_id,
            channel_metadata, status, last_channel_message_at)
         VALUES ($1, NULL, $2, $3, NOW(), $4, $5, 'general', 'normal', $6, $7, $8, 'open', NOW())
         ON CONFLICT (business_id, channel, external_thread_id)
           WHERE external_thread_id IS NOT NULL
         DO UPDATE SET
           guest_name = COALESCE(NULLIF(EXCLUDED.guest_name, ''), support_conversations.guest_name),
           guest_email = EXCLUDED.guest_email,
           channel_metadata = support_conversations.channel_metadata || EXCLUDED.channel_metadata,
           status = CASE WHEN support_conversations.status IN ('resolved', 'closed') THEN 'open' ELSE support_conversations.status END,
           resolved_at = CASE WHEN support_conversations.status IN ('resolved', 'closed') THEN NULL ELSE support_conversations.resolved_at END,
           closed_at = CASE WHEN support_conversations.status IN ('resolved', 'closed') THEN NULL ELSE support_conversations.closed_at END,
           updated_at = NOW(),
           last_channel_message_at = NOW()
         RETURNING id, status`,
        [businessId, payload.customerName, payload.customerEmail, payload.subject, payload.content, payload.channel, payload.externalThreadId, JSON.stringify(payload.metadata)]
      );
      const conversation = conversationResult.rows[0];

      const message = await client.query(
        `INSERT INTO support_conversation_messages
           (conversation_id, sender_id, message_type, content, is_agent, status, channel, external_message_id)
         VALUES ($1, NULL, 'text', $2, FALSE, 'sent', $3, $4)
         ON CONFLICT (channel, external_message_id)
           WHERE external_message_id IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [conversation.id, payload.content, payload.channel, payload.externalMessageId]
      );

      if (message.rows.length) {
        await client.query(
          `UPDATE support_conversations
           SET message_count = message_count + 1,
               customer_message_count = customer_message_count + 1,
               updated_at = NOW(),
               last_channel_message_at = NOW()
           WHERE id = $1`,
          [conversation.id]
        );
      }

      const existingQueue = await client.query(
        `UPDATE support_queue
         SET status = 'waiting', removed_at = NULL, reason_removed = NULL, queued_at = NOW()
         WHERE conversation_id = $1 AND status = 'removed'
         RETURNING id`,
        [conversation.id]
      );
      if (!existingQueue.rows.length) {
        const activeQueue = await client.query(
          `SELECT id FROM support_queue WHERE conversation_id = $1 AND status <> 'removed' LIMIT 1`,
          [conversation.id]
        );
        if (!activeQueue.rows.length) {
          await client.query(
            `INSERT INTO support_queue (business_id, conversation_id, priority, status)
             VALUES ($1, $2, 'normal', 'waiting')`,
            [businessId, conversation.id]
          );
        }
      }

      await client.query(
        `UPDATE support_channel_events SET conversation_id = $1 WHERE channel = $2 AND event_id = $3`,
        [conversation.id, payload.channel, payload.eventId]
      );
      return { duplicate: false, conversationId: conversation.id, messageId: message.rows[0]?.id || null };
    }, 'ingest_support_channel_webhook');

    if (!result.duplicate) {
      WebSocketService.broadcastToAdmins('support:conversation-updated', {
        conversationId: result.conversationId,
        channel: payload.channel,
        messageId: result.messageId,
        source: 'channel_webhook',
      });
    }
    return res.status(result.duplicate ? 200 : 202).json({
      success: true,
      idempotent: result.duplicate,
      conversationId: result.conversationId,
      messageId: result.messageId || null,
    });
  } catch (error) {
    logger.error('Support channel webhook ingestion failed', {
      channel: payload.channel,
      eventId: payload.eventId,
      error: error.message,
    });
    return res.status(500).json({ error: 'Failed to ingest support channel event' });
  }
}

module.exports = { ingestChannelWebhook, parsePayload, validSignature };
