'use strict';

const db = require('../db');

async function cleanupExpiredChallenges({ limit = 1000 } = {}) {
  const tables = ['user_passkey_challenges', 'admin_passkey_challenges'];
  let total = 0;
  for (const table of tables) {
    const { rowCount } = await db.query(
      `DELETE FROM ${table} WHERE expires_at < NOW() LIMIT $1`,
      [limit]
    );
    total += rowCount || 0;
  }
  return { cleaned: total };
}

module.exports = { cleanupExpiredChallenges };
