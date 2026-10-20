"use strict";
const { key, ipHash, consentLock } = require("./identity");
const PURPOSES = new Set([
  "activity",
  "activity_offers",
  "offer_push",
  "offer_email",
  "sale_share_optout",
]);
const SOURCES = new Set([
  "banner",
  "settings",
  "signup",
  "gpc",
  "do_not_sell_page",
  "unsubscribe_link",
]);
async function record(
  conn,
  { userId, purpose, granted, source, jurisdiction, version, ip },
) {
  if (
    !PURPOSES.has(purpose) ||
    !SOURCES.has(source) ||
    typeof granted !== "boolean" ||
    (purpose === "offer_email" && granted)
  )
    throw Object.assign(new Error("invalid_consent"), { status: 400 });
  const subject = key("subject", userId);
  await conn.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    consentLock(subject),
  ]);
  const { rows } = await conn.query(
    `INSERT INTO tracking_consents(subject_key,purpose,granted,jurisdiction,source,consent_text_version,ip_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [subject, purpose, granted, jurisdiction, source, version, ipHash(ip)],
  );
  await conn.query(
    `INSERT INTO tracking_consent_current(subject_key,purpose,consent_id,granted) VALUES($1,$2,$3,$4)
    ON CONFLICT(subject_key,purpose) DO UPDATE SET consent_id=EXCLUDED.consent_id,granted=EXCLUDED.granted`,
    [subject, purpose, rows[0].id, granted],
  );
  if ((purpose === "activity" || purpose === "activity_offers") && !granted) {
    await require("./rights").erase(conn, userId, `withdraw_${purpose}`);
  }
  if (purpose === "sale_share_optout" && granted) {
    // Conservatively discard person-level profiles, including shared profiles.
    await conn.query("DELETE FROM user_interest_profiles WHERE user_id=$1", [
      userId,
    ]);
    await conn.query("DELETE FROM propensity_scores WHERE user_id=$1", [
      userId,
    ]);
  }
  if (purpose === "offer_push")
    await conn.query(
      `INSERT INTO offer_preferences(user_id,offer_push) VALUES($1,$2)
    ON CONFLICT(user_id) DO UPDATE SET offer_push=EXCLUDED.offer_push,updated_at=NOW()`,
      [userId, granted],
    );
  return rows[0];
}
module.exports = { record };
