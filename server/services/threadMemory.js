/**
 * threadMemory.js
 *
 * Server-side conversation history for AI profile chat sessions.
 * Stores the last MAX_TURNS message pairs (user + assistant) in Redis,
 * keyed by a randomly generated threadId. TTL is refreshed on every append.
 *
 * Cache key: chat:{threadId}
 * TTL: 1 hour (THREAD_TTL), sliding - reset on every message so active
 *      conversations don't expire mid-session.
 *
 * When Redis is unavailable the functions degrade gracefully:
 *   - generateThreadId()  still returns a usable ID string
 *   - getThread()         returns []
 *   - appendToThread()    silently no-ops
 *
 * The controller falls back to the client-supplied messages array in
 * that case, so the chat remains fully functional without Redis.
 */

const crypto = require('crypto');
const redis  = require('../utils/redis');
const logger = require('../utils/logger');

const THREAD_TTL = 60 * 60;   // seconds - 1 hour sliding window
const MAX_MESSAGES = 20;       // 10 user + 10 assistant = 10 "turns"
const THREAD_ID_PREFIX = 'th_';

// ── Internal ─────────────────────────────────────────────────────────────────

function threadKey(threadId) {
  return `chat:${threadId}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a new random thread ID.
 * Format: th_{24 hex chars}  (12 bytes of randomness)
 */
function generateThreadId() {
  return `${THREAD_ID_PREFIX}${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Validate that a threadId looks like one we issued (prevents Redis key injection).
 * Accepts only: th_ followed by 24 lowercase hex chars.
 */
function isValidThreadId(id) {
  return typeof id === 'string' && /^th_[0-9a-f]{24}$/.test(id);
}

/**
 * Retrieve stored message history for a thread.
 * Returns an array of { role, content } objects, oldest first.
 * Returns [] when the thread is unknown, expired, or Redis is down.
 */
async function getThread(threadId) {
  if (!redis || !isValidThreadId(threadId)) return [];
  try {
    const raw = await redis.get(threadKey(threadId));
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    logger.warn('[ThreadMemory] Get failed', { threadId, message: err.message });
    return [];
  }
}

/**
 * Append new messages to a thread and slide the TTL window.
 * Trims the stored array to the last MAX_MESSAGES entries after appending.
 *
 * @param {string} threadId
 * @param {Array<{role: string, content: string}>} newMessages
 */
async function appendToThread(threadId, newMessages) {
  if (!redis || !isValidThreadId(threadId) || !newMessages.length) return;
  try {
    const existing = await getThread(threadId);
    const updated  = [...existing, ...newMessages].slice(-MAX_MESSAGES);
    // SETEX resets the TTL (sliding window - active sessions stay alive)
    await redis.setex(threadKey(threadId), THREAD_TTL, JSON.stringify(updated));
  } catch (err) {
    logger.warn('[ThreadMemory] Append failed', { threadId, message: err.message });
  }
}

module.exports = { generateThreadId, isValidThreadId, getThread, appendToThread };
