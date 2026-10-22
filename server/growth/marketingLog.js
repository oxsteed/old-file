"use strict";
// Legacy marketing sends (customer re-engagement, Discover digest) remain
// auditable in marketing_contact_log, but do not consume the growth offer
// campaign caps. Offer delivery queries source='growth_offer' explicitly.
//
// Fail-open by design: these legacy jobs predate the engine and must never
// break because a growth table is unavailable. The insert is a plain row
// with campaign_id NULL (the UNIQUE key treats NULL campaigns as distinct,
// so repeat sends each record their own contact).
async function recordMarketingContact(runner, { userId, source, channel }) {
  try {
    await runner.query(
      `INSERT INTO marketing_contact_log(user_id,campaign_id,source,channel)
       VALUES($1,NULL,$2,$3)`,
      [userId, source, channel],
    );
  } catch {
    /* legacy send path: logging must never break the send */
  }
}

module.exports = { recordMarketingContact };
