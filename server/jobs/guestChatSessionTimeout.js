const cron = require('node-cron');
const db = require('../db');
const { withChatTransaction } = require('../services/chatTransactionService');
const logger = require('../utils/logger');

// P1-264: the AI fallback promised to verified guests whose helper misses the
// 5-minute deadline. The fallback is a deterministic system_ai holding reply
// (no model call, so it cannot fail or hallucinate), the session moves to
// ai_support_active so a helper can claim it, and the helper is notified.
const FALLBACK_MESSAGES = Object.freeze({
  en: "{{name}} hasn't replied yet. We've let them know you're waiting, and their reply will appear right here. You can keep adding details in the meantime.",
  es: '{{name}} aún no ha respondido. Le avisamos que estás esperando y su respuesta aparecerá aquí mismo. Mientras tanto, puedes seguir agregando detalles.',
  fr: "{{name}} n'a pas encore répondu. Nous l'avons prévenu(e) que vous attendez, et sa réponse s'affichera ici. Vous pouvez ajouter des détails en attendant.",
  ht: '{{name}} poko reponn. Nou fè li konnen w ap tann, epi repons li ap parèt la a. Pandan w ap tann, ou ka kontinye ajoute detay.',
  ar: 'لم يرد {{name}} بعد. أبلغناه بأنك في الانتظار، وسيظهر رده هنا. يمكنك متابعة إضافة التفاصيل في هذه الأثناء.',
});
const FALLBACK_NAME = Object.freeze({ en: 'The helper', es: 'El profesional', fr: 'Le prestataire', ht: 'Moun nan', ar: 'مقدم الخدمة' });

function fallbackMessage(language, helperFirstName) {
  const lang = Object.prototype.hasOwnProperty.call(FALLBACK_MESSAGES, language) ? language : 'en';
  const name = String(helperFirstName || '').trim().slice(0, 80) || FALLBACK_NAME[lang];
  return FALLBACK_MESSAGES[lang].replace('{{name}}', name);
}

async function activateAiFallback(client, sessionId) {
  const { rows: [ctx] } = await client.query(
    `SELECT gi.helper_id, h.first_name AS helper_first_name,
            COALESCE(g.preferred_language, 'en') AS guest_language
       FROM guest_profile_chat_inbound gi
       LEFT JOIN users h ON h.id = gi.helper_id
       LEFT JOIN users g ON g.id = gi.guest_id
      WHERE gi.id = $1`,
    [sessionId]
  );
  const text = fallbackMessage(ctx?.guest_language, ctx?.helper_first_name);
  const { rows: [msg] } = await client.query(
    `INSERT INTO guest_profile_chat_messages (session_id, sender_type, sender_name, message, created_at)
     VALUES ($1, 'system_ai', 'OxSteed', $2, CURRENT_TIMESTAMP)
     RETURNING id, created_at`,
    [sessionId, text]
  );
  await client.query(
    `UPDATE guest_profile_chat_inbound
        SET session_status = 'ai_support_active', last_activity_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND session_status = 'ai_fallback_pending'`,
    [sessionId]
  );
  return { helperId: ctx?.helper_id || null, messageId: msg?.id || null, createdAt: msg?.created_at || null, text };
}

function announceFallback(sessionId, fallback) {
  try {
    const { broadcastGuestChatMessage } = require('../services/socketService');
    broadcastGuestChatMessage(sessionId, {
      messageId: fallback.messageId,
      senderType: 'system_ai',
      senderName: 'OxSteed',
      message: fallback.text,
      createdAt: new Date(fallback.createdAt || Date.now()).toISOString(),
    });
  } catch (err) {
    logger.warn('Guest chat fallback broadcast failed', { sessionId, error: err.message });
  }
  if (!fallback.helperId) return;
  const { sendNotification } = require('../services/notificationService');
  void sendNotification({
    userId: fallback.helperId,
    type: 'new_message',
    title: 'A guest is waiting for your reply',
    body: 'A verified guest has been waiting more than 5 minutes. Reply from Messages to take over.',
    data: { guestSessionId: String(sessionId) },
    action_url: '/helper/messages',
    idempotencyKey: `guest-chat-fallback:${sessionId}`,
  }).catch((err) => logger.warn('Guest chat fallback notification failed', { sessionId, error: err.message }));
}

/**
 * Every 1 minute (offset to the :05 second)
 * Check for guest chat sessions in "waiting_for_helper" state that have exceeded their 5-minute response deadline.
 * Transition them through "ai_fallback_pending" to "ai_support_active": post a
 * localized system_ai holding reply to the guest and notify the profile owner.
 *
 * This cron job ensures reliability across server restarts - timeouts are database-driven, not in-memory.
 */
async function runGuestChatSessionTimeoutPass() {
    try {
      // Find all sessions waiting for helper whose deadline has passed
      const { rows: staleSessions } = await db.query(
        `SELECT id, guest_id, guest_name, last_activity_at
         FROM guest_profile_chat_inbound
         WHERE session_status = 'waiting_for_helper'
           AND verification_status = 'verified'
           AND helper_response_deadline IS NOT NULL
           AND helper_response_deadline < CURRENT_TIMESTAMP
         LIMIT 100`
      );

      if (staleSessions.length === 0) {
        return; // No sessions to timeout
      }

      logger.info('Guest chat sessions timing out', {
        sessionCount: staleSessions.length
      });

      let succeeded = 0;
      let failed = 0;

      for (const session of staleSessions) {
        try {
          // Transition session to ai_fallback_pending within a transaction
          const fallback = await withChatTransaction(async (client) => {
            // Get current session state with lock
            const current = await client.query(
              `SELECT session_status, helper_response_deadline, verification_status FROM guest_profile_chat_inbound
               WHERE id = $1 FOR UPDATE`,
              [session.id]
            );

            // Double-check the session is still waiting and deadline has passed
            // (another process might have claimed it)
            if (current.rows[0].verification_status !== 'verified' ||
                current.rows[0].session_status !== 'waiting_for_helper' ||
                new Date(current.rows[0].helper_response_deadline) > new Date()) {
              return null; // Session was claimed or deadline was updated, skip
            }

            // Update session status
            await client.query(
              `UPDATE guest_profile_chat_inbound
               SET session_status = $1,
                   helper_response_deadline = NULL,
                   ai_fallback_triggered_at = CURRENT_TIMESTAMP,
                   last_activity_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              ['ai_fallback_pending', session.id]
            );

            // Log the timeout event
            await client.query(
              `INSERT INTO chat_monitoring_log (session_id, event_type, metadata)
               VALUES ($1, $2, $3)`,
              [session.id, 'ai_fallback_triggered_timeout', JSON.stringify({
                guest_name: session.guest_name,
                deadline_elapsed: true,
                triggered_by: 'cron'
              })]
            );
            return activateAiFallback(client, session.id);
          }, 'guest_chat_session_timeout');

          if (fallback) announceFallback(session.id, fallback);
          succeeded++;
        } catch (err) {
          failed++;
          logger.error('Failed to timeout guest chat session', {
            sessionId: session.id,
            guestName: session.guest_name,
            error: err.message
          });
        }
      }

      logger.info('Guest chat session timeout job complete', {
        succeeded,
        failed,
        total: staleSessions.length
      });
    } catch (err) {
      logger.error('Guest chat session timeout job failed', {
        error: err.message
      });
    }
}

const startGuestChatSessionTimeoutJob = () => {
  cron.schedule('5 * * * * *', runGuestChatSessionTimeoutPass);
};

module.exports = { startGuestChatSessionTimeoutJob, runGuestChatSessionTimeoutPass, fallbackMessage };
