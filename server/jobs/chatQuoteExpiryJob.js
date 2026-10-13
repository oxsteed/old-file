// server/jobs/chatQuoteExpiryJob.js
// Review P2-10-F04: accepted/approved quotes never expired, so a months-old
// accepted quote could be scheduled at a stale price.
//
// This job flips accepted/approved quotes whose valid_until has passed to
// 'expired'. It mirrors isQuoteExpired (server/services/chatQuotes.js):
// DATE-only values are inclusive through that calendar day, so the SQL
// compares valid_until::date < CURRENT_DATE.
//
// The enforcement point is scheduleFromQuote, which 409s on
// isQuoteExpired(quote) even for rows the sweeper has not visited yet; the
// sweeper keeps the stored status truthful for every other reader (quote
// cards, provider dashboards). No notifications: expiry is a quiet,
// deterministic lifecycle transition, and both parties see the expired
// state on the quote itself.

const pool = require('../db');
const logger = require('../utils/logger');

const JOB_NAME = 'chat-quote-expiry';
const CRON_EXPRESSION = '17 * * * *'; // hourly, offset from other jobs
const BATCH_SIZE = 500;

async function sweepChatQuoteExpiry(db) {
  const result = { business: 0, helper: 0 };

  // business_quotes: 'approved' is the accepted state; valid_until is DATE.
  const { rowCount: businessCount } = await db.query(
    `UPDATE business_quotes
        SET status = 'expired', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM business_quotes
         WHERE status = 'approved'
           AND valid_until IS NOT NULL
           AND valid_until < CURRENT_DATE
         ORDER BY id
         LIMIT $1
      )`,
    [BATCH_SIZE]
  );
  result.business = businessCount || 0;

  // helper_quotes: 'accepted' is the accepted state; valid_until is TIMESTAMPTZ.
  // The ::date comparison keeps DATE-midnight values inclusive through the day,
  // matching isQuoteExpired.
  const { rowCount: helperCount } = await db.query(
    `UPDATE helper_quotes
        SET status = 'expired', updated_at = NOW()
      WHERE id IN (
        SELECT id FROM helper_quotes
         WHERE status = 'accepted'
           AND valid_until IS NOT NULL
           AND valid_until::date < CURRENT_DATE
         ORDER BY id
         LIMIT $1
      )`,
    [BATCH_SIZE]
  );
  result.helper = helperCount || 0;

  return result;
}

async function runChatQuoteExpiryJob(dbClient) {
  const db = dbClient || pool;
  const result = await sweepChatQuoteExpiry(db);
  const total = result.business + result.helper;
  if (total > 0) {
    logger.info('Chat quote expiry sweep completed', { ...result, job: JOB_NAME });
  }
  return result;
}

function startChatQuoteExpiryJob() {
  const cron = require('node-cron');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await runChatQuoteExpiryJob();
    } catch (err) {
      logger.error('Chat quote expiry cron error', { error: err.message });
    }
  });
  logger.info('Chat quote expiry job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = {
  startChatQuoteExpiryJob,
  runChatQuoteExpiryJob,
  sweepChatQuoteExpiry,
  cronExpression: CRON_EXPRESSION,
};
