'use strict';

/**
 * supportChatThreads.js
 *
 * Server-side memory for the AI support chat (gap #5: no memory across
 * sessions). Stores recent turns per signed-in user in Redis so the
 * assistant keeps context across devices and browser clears.
 *
 * Key: supportchat:user:{userId} | TTL: 30 days, sliding | Cap: 20 messages.
 * Degrades gracefully when Redis is unavailable (returns [], no-ops).
 */

const redis = require('../utils/redis');
const logger = require('../utils/logger');

const THREAD_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_MESSAGES = 20;

function threadKey(userId) {
  return `supportchat:user:${String(userId)}`;
}

/**
 * Loads the user's recent support-chat turns, oldest first.
 * Returns [] when Redis is unavailable or the thread is empty.
 */
async function getSupportThread(userId) {
  if (!userId || !redis) return [];
  try {
    const raw = await redis.get(threadKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_MESSAGES);
  } catch (err) {
    logger.warn('[supportChatThreads] read failed', { error: err.message });
    return [];
  }
}

/**
 * Appends one user+assistant turn and refreshes the TTL. Fire-and-forget
 * safe: never throws.
 */
async function appendSupportThread(userId, userContent, assistantReply) {
  if (!userId || !redis) return;
  try {
    const key = threadKey(userId);
    const existing = await getSupportThread(userId);
    const next = [
      ...existing,
      { role: 'user', content: String(userContent || '').slice(0, 1500), ts: new Date().toISOString() },
      { role: 'assistant', content: String(assistantReply || '').slice(0, 1500), ts: new Date().toISOString() },
    ].slice(-MAX_MESSAGES);
    await redis.set(key, JSON.stringify(next), 'EX', THREAD_TTL_SECONDS);
  } catch (err) {
    logger.warn('[supportChatThreads] append failed', { error: err.message });
  }
}

module.exports = { getSupportThread, appendSupportThread };
