// VULN #17 FIX: Detect and prevent bidding collusion

const pool = require('../db');
const logger = require('../utils/logger');

/**
 * Detect suspicious bidding patterns indicating collusion
 * Red flags:
 * - Bids from same IP address (shared network/VPN)
 * - Bids from accounts created at same time
 * - Alternating high/low bids from same accounts
 * - Bids from accounts with no history suddenly appearing
 */
async function detectBiddingCollusion(jobId, bidderId) {
  try {
    const suspiciousFlags = [];

    // Get bidder details
    const { rows: bidderRows } = await pool.query(
      `SELECT id, created_at FROM users WHERE id = $1`,
      [bidderId]
    );
    if (!bidderRows[0]) return null;

    const bidder = bidderRows[0];

    // RED FLAG #1: Multiple accounts from same IP bidding on same job
    const { rows: ipBids } = await pool.query(
      `SELECT DISTINCT(b.user_id) FROM bids b
       JOIN user_last_login_log ul ON b.user_id = ul.user_id
       WHERE b.job_id = $1
         AND ul.ip_address = (
           SELECT ip_address FROM user_last_login_log
           WHERE user_id = $2 LIMIT 1
         )`,
      [jobId, bidderId]
    );
    if (ipBids.length > 1) {
      suspiciousFlags.push({
        flag: 'same_ip_bidders',
        severity: 'high',
        count: ipBids.length
      });
    }

    // RED FLAG #2: Accounts created near same time bidding together
    const { rows: createdNear } = await pool.query(
      `SELECT DISTINCT(b.user_id) FROM bids b
       JOIN users u ON b.user_id = u.id
       WHERE b.job_id = $1
         AND ABS(EXTRACT(EPOCH FROM (u.created_at - $2::timestamp))) < 86400
         AND u.id != $3`,
      [jobId, bidder.created_at, bidderId]
    );
    if (createdNear.length > 2) {
      suspiciousFlags.push({
        flag: 'accounts_created_together',
        severity: 'medium',
        count: createdNear.length
      });
    }

    // RED FLAG #3: Pattern analysis - alternating bids
    const { rows: bidPatterns } = await pool.query(
      `SELECT b.user_id, COUNT(*) as bid_count,
              MAX(b.amount) - MIN(b.amount) as bid_range
       FROM bids b
       WHERE b.job_id = $1
       GROUP BY b.user_id
       HAVING COUNT(*) > 1`,
      [jobId]
    );
    if (bidPatterns.some(p => p.bid_range > 10000)) { // Large bid variance
      suspiciousFlags.push({
        flag: 'unusual_bid_range',
        severity: 'medium'
      });
    }

    return {
      job_id: jobId,
      bidder_id: bidderId,
      suspicious: suspiciousFlags.length > 0,
      flags: suspiciousFlags,
      should_investigate: suspiciousFlags.some(f => f.severity === 'high')
    };
  } catch (err) {
    logger.error('Bid collision detection error', { jobId, bidderId, error: err.message });
    return null;
  }
}

module.exports = {
  detectBiddingCollusion
};
