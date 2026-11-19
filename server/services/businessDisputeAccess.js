'use strict';

// PR804 Track C — G-21: the owning business's owner/manager may read a
// dispute about one of the business's jobs and submit evidence.
// Jobs carry no business_id, so the business resolves via the job's client:
// the caller must be an active manager (or owner) member of a business
// owned by the job's client. Resolution stays admin-only, and dispute
// messages stay party-only (the business answers with evidence).

const db = require('../db');

async function isBusinessDisputeParty(userId, jobClientId) {
  if (!userId || !jobClientId) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM businesses b
       JOIN business_members bm ON bm.business_id = b.id
      WHERE b.user_id = $1
        AND bm.member_id = $2
        AND bm.status = 'active'
        AND bm.role IN ('manager', 'owner')
      LIMIT 1`,
    [String(jobClientId), String(userId)]);
  return rows.length > 0;
}

module.exports = { isBusinessDisputeParty };
