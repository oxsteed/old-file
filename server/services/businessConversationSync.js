'use strict';

/**
 * server/services/businessConversationSync.js
 *
 * Bridges legacy `conversations`/`messages` to the per-business
 * `business_conversations`/`business_messages` tables (migration 219).
 *
 * Why dual-write? The legacy table powers the customer's personal
 * MessagesPage (where they see every thread they're part of, regardless
 * of business). The business_conversations table powers the per-business
 * workspace inbox shared by all team members. Both need the message.
 *
 * This service is intentionally lightweight and tolerant. All operations
 * try-catch internally; if the business-side write fails the legacy flow
 * is unaffected.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const socketService = require('./socketService');
const { withTransaction } = require('../utils/transaction');

/**
 * Find or create a `business_conversations` row of type 'customer' for the
 * (business_id, customer_id|customer_email, legacy_conversation_id) tuple.
 *
 * @param {object} args
 * @param {number} args.businessId            REQUIRED integer business id
 * @param {string|null} args.legacyConversationId  Existing conversations.id (UUID)
 * @param {string|null} args.customerId       users.id or null for guests
 * @param {string|null} args.customerName
 * @param {string|null} args.customerEmail    REQUIRED for customer conversations
 * @param {string|null} args.customerPhone
 * @param {string|null} args.subject
 * @param {string|null} args.createdById      Who created the row (defaults to business owner)
 * @returns {Promise<string|null>}            business_conversations.id (UUID) or null on failure
 */
async function ensureBusinessConversation(args) {
  const {
    businessId,
    legacyConversationId = null,
    customerId = null,
    customerName = null,
    customerEmail,
    customerPhone = null,
    subject = null,
    createdById = null,
  } = args || {};

  if (!businessId) return null;
  if (!customerEmail && !customerId) return null;

  try {
    const lockScope = `customer:${businessId}:${customerId || String(customerEmail).trim().toLowerCase()}`;

    return await withTransaction(pool, async (client) => {
      // The lookup and insert must share one connection. Otherwise two app
      // replicas can both observe no row and create duplicate Business Hub
      // threads for the same customer or legacy conversation.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
        [`business-conversation-sync:${lockScope}`]
      );

      // 1) If we have a legacy conversation id, prefer matching on that.
      if (legacyConversationId) {
        const existing = await client.query(
          `SELECT id FROM business_conversations
           WHERE business_id = $1 AND legacy_conversation_id = $2
           LIMIT 1`,
          [businessId, legacyConversationId]
        ).catch(() => ({ rows: [] }));
        if (existing.rows[0]) return existing.rows[0].id;
      }

      // 2) Fall back to matching by (business_id, customer_id) or (business_id, customer_email)
      const byCustomer = await client.query(
        customerId
          ? `SELECT id FROM business_conversations
              WHERE business_id = $1 AND conversation_type = 'customer' AND customer_id = $2
              ORDER BY last_message_at DESC NULLS LAST LIMIT 1`
          : `SELECT id FROM business_conversations
              WHERE business_id = $1 AND conversation_type = 'customer' AND customer_email = $2
              ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
        [businessId, customerId || customerEmail]
      );
      if (byCustomer.rows[0]) {
        // Backfill legacy id if missing
        if (legacyConversationId) {
          await client.query(
            `UPDATE business_conversations
               SET legacy_conversation_id = COALESCE(legacy_conversation_id, $1)
             WHERE id = $2`,
            [legacyConversationId, byCustomer.rows[0].id]
          ).catch(() => {});
        }
        return byCustomer.rows[0].id;
      }

      // 3) Resolve a creator for the row (business_conversations.created_by_id is NOT NULL).
      let creatorId = createdById;
      if (!creatorId) {
        const owner = await client.query(
          'SELECT user_id FROM businesses WHERE id = $1',
          [businessId]
        );
        creatorId = owner.rows[0] ? owner.rows[0].user_id : customerId;
      }
      if (!creatorId) return null;

      // 4) Insert. customer_email is required by the CHECK constraint when type='customer'.
      const inserted = await client.query(
        `INSERT INTO business_conversations
           (business_id, conversation_type, customer_id, customer_name, customer_email, customer_phone,
            created_by_id, subject, status, last_message_at, legacy_conversation_id)
         VALUES ($1, 'customer', $2, $3, $4, $5, $6, $7, 'active', NOW(), $8)
         RETURNING id`,
        [
          businessId,
          customerId,
          customerName,
          customerEmail || 'unknown@guest.local',
          customerPhone,
          creatorId,
          subject,
          legacyConversationId,
        ]
      );
      return inserted.rows[0] ? inserted.rows[0].id : null;
    }, 'ensure_business_conversation');
  } catch (err) {
    logger.warn('ensureBusinessConversation failed', {
      err: err && err.message,
      businessId,
      legacyConversationId,
    });
    return null;
  }
}

/**
 * Mirror a single message into business_messages.
 * Caller has already inserted the original into `messages`.
 *
 * @param {object} args
 * @param {string} args.businessConversationId
 * @param {string|null} args.senderId       users.id or null for guest
 * @param {string|null} args.senderName
 * @param {string|null} args.senderEmail
 * @param {'team_member'|'customer'} args.senderType
 * @param {string} args.content
 * @param {'text'|'system'|'action'} [args.messageType='text']
 * @param {string|null} [args.legacyMessageId]
 * @param {string|null} [args.clientMessageId]
 * @returns {Promise<string|null>}
 */
async function mirrorMessage(args) {
  const {
    businessConversationId,
    senderId = null,
    senderName = null,
    senderEmail = null,
    senderType,
    content,
    messageType = 'text',
    legacyMessageId = null,
    clientMessageId = null,
  } = args || {};

  if (!businessConversationId) return null;
  if (!senderType || !content) return null;

  try {
    const inserted = await pool.query(
      `INSERT INTO business_messages
         (conversation_id, sender_id, sender_name, sender_email, sender_type,
          content, message_type, legacy_message_id, client_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (conversation_id, client_message_id)
       WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        businessConversationId,
        senderId,
        senderName,
        senderEmail,
        senderType,
        String(content).slice(0, 10000),
        messageType,
        legacyMessageId,
        clientMessageId,
      ]
    );
    let messageId = inserted.rows[0] && inserted.rows[0].id;
    let replayed = false;
    if (!messageId && clientMessageId) {
      const existing = await pool.query(
        `SELECT id FROM business_messages
          WHERE conversation_id = $1 AND client_message_id = $2
          LIMIT 1`,
        [businessConversationId, clientMessageId],
      );
      messageId = existing.rows[0] && existing.rows[0].id;
      replayed = Boolean(messageId);
    }
    if (!messageId) return null;

    if (replayed) return messageId;

    await pool.query(
      `UPDATE business_conversations
         SET last_message_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [businessConversationId]
    ).catch(() => {});

    // Broadcast to the business inbox so all online team members see it in real time.
    try {
      const { rows: bizRows } = await pool.query(
        'SELECT business_id FROM business_conversations WHERE id = $1',
        [businessConversationId]
      );
      const businessId = bizRows[0] && bizRows[0].business_id;
      if (businessId) {
        socketService.broadcastToBusinessInbox(businessId, 'business_inbox:message', {
          conversation_id: businessConversationId,
          message_id: messageId,
          sender_type: senderType,
          sender_name: senderName,
          content: String(content).slice(0, 280),
          created_at: new Date().toISOString(),
        });
      }
    } catch (broadcastErr) {
      logger.warn('inbox broadcast failed', { err: broadcastErr && broadcastErr.message });
    }
    return messageId;
  } catch (err) {
    logger.warn('mirrorMessage failed', {
      err: err && err.message,
      businessConversationId,
    });
    return null;
  }
}

module.exports = { ensureBusinessConversation, mirrorMessage };
