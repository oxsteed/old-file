'use strict';

const pool = require('../db');
const logger = require('../utils/logger');

const DEFAULT_TERMS = [
  'wire transfer only',
  'western union',
  'send gift card',
  'guaranteed income',
  '100% free money',
  'cash app only',
  'outside oxsteed',
];

function normalizedTerms() {
  const configured = String(process.env.MODERATION_BLOCKLIST || '')
    .split(',')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_TERMS, ...configured]));
}

exports.getBlocklist = async (_req, res) => {
  res.json({ terms: normalizedTerms() });
};

exports.flagContent = async (req, res) => {
  const userId = req.user?.id || null;
  const { text = '', context = 'unknown', locale = 'en' } = req.body || {};
  const content = String(text || '').trim();

  if (!content) return res.status(400).json({ ok: false, error: 'text is required' });

  try {
    await pool.query(
      `INSERT INTO moderation_queue
         (type, target_id, target_type, reported_by, reason, status, priority, created_at)
       VALUES ('content_flag', $1, $2, $3, $4, 'pending', $5, now())`,
      [
        `${context}:${Date.now()}`,
        String(context || 'content').slice(0, 50),
        userId,
        JSON.stringify({ text: content.slice(0, 5000), locale, source: 'ios' }),
        content.length > 1000 ? 'high' : 'normal',
      ]
    );
  } catch (err) {
    logger.warn('Mobile moderation flag could not be queued', {
      userId,
      context,
      error: err.message,
    });
  }

  res.json({ ok: true });
};
