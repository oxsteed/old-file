'use strict';

/**
 * Shared conversation / guest-session membership checks for chat artifacts
 * (quotes, POP, agreements). Telegram cloud-chat analogue: server-side ACL.
 */

const pool = require('../db');
const guestProfileVerify = require('./guestProfileChatVerification');

async function assertConversationParticipant(userId, conversationId) {
  if (!userId || !conversationId) return null;
  const { rows } = await pool.query(
    `SELECT c.id, c.customer_id, c.helper_id, c.business_id, c.job_id
       FROM conversations c
      WHERE c.id = $1 AND (
        c.customer_id = $2 OR c.helper_id = $2
        OR (c.business_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
        ))
        OR (c.business_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM businesses b
           WHERE b.id = c.business_id AND b.user_id = $2 AND b.is_active = TRUE
        ))
      )`,
    [conversationId, userId],
  );
  return rows[0] || null;
}

async function assertGuestInquiryAccess(userId, guestSessionId) {
  if (!userId || !guestSessionId) return null;
  const { rows } = await pool
    .query(
      `SELECT g.* FROM guest_profile_chat_inbound g
        WHERE g.id = $1
          AND (
            g.helper_id = $2
            OR (g.business_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM businesses b WHERE b.id = g.business_id AND b.user_id = $2
            ))
            OR (g.business_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = g.business_id AND bm.member_id = $2 AND bm.status = 'active'
            ))
          )`,
      [guestSessionId, userId],
    )
    .catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function assertBusinessAccess(userId, businessId) {
  if (!userId || !businessId) return null;
  const { rows } = await pool
    .query(
      `SELECT b.id, b.user_id, b.business_name
         FROM businesses b
        WHERE b.id = $1 AND b.is_active = TRUE
          AND (
            b.user_id = $2
            OR EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
            )
          )`,
      [businessId, userId],
    )
    .catch(() => ({ rows: [] }));
  return rows[0] || null;
}

async function resolveGuestFromRequest(req) {
  if (req.guestSession) return req.guestSession;
  const extracted = guestProfileVerify.extractGuestAuth(req);
  if (extracted.token && extracted.sessionId) {
    return guestProfileVerify.loadVerifiedGuestSession(extracted.token, extracted.sessionId);
  }
  return null;
}

function isProviderOnConversation(userId, conv) {
  if (!userId || !conv) return false;
  if (String(conv.helper_id) === String(userId)) return true;
  return false;
}

function isCustomerOnConversation(userId, conv) {
  if (!userId || !conv) return false;
  return String(conv.customer_id) === String(userId);
}

/** Min reason length for admin break-glass. */
const BREAK_GLASS_REASON_MIN = 10;

function normalizeBreakGlassReason(raw) {
  const reason = String(raw || '').trim();
  if (reason.length < BREAK_GLASS_REASON_MIN) {
    return {
      ok: false,
      error: `Break-glass reason must be at least ${BREAK_GLASS_REASON_MIN} characters`,
    };
  }
  if (reason.length > 2000) {
    return { ok: false, error: 'Break-glass reason is too long' };
  }
  return { ok: true, reason };
}

module.exports = {
  assertConversationParticipant,
  assertGuestInquiryAccess,
  assertBusinessAccess,
  resolveGuestFromRequest,
  isProviderOnConversation,
  isCustomerOnConversation,
  BREAK_GLASS_REASON_MIN,
  normalizeBreakGlassReason,
};
