"use strict";
// These stores predate Growth. Account-derived Promote keys retain their existing
// seven-day attribution semantics; no export or deletion extends that window.
// Export sections are capped explicitly: exceeding the cap fails the export
// instead of silently truncating a subject's archive.
const EXPORT_ROW_CAP = 100000;
function capped(section, rows) {
  if (rows.length > EXPORT_ROW_CAP)
    throw Object.assign(new Error("privacy_export_result_limit_exceeded"), {
      code: "EXPORT_RESULT_LIMIT_EXCEEDED",
      section,
    });
  return rows;
}
const ownVisit = `account_key IS NOT NULL AND account_key=encode(sha256(convert_to(
  'promotion-account:'||owner_type||':'||COALESCE(owner_user_id::text,business_id::text)||':'||$1::text,'UTF8')),'hex')`;
async function exportData(conn, userId) {
  const site_visits = capped(
    "site_visits",
    (
      await conn.query(
        `SELECT visited_at,path,referrer,country_code,region_name,city,device_type FROM site_visits WHERE user_id=$1 ORDER BY visited_at LIMIT ${EXPORT_ROW_CAP + 1}`,
        [userId],
      )
    ).rows,
  );
  const discover_search_log = capped(
    "discover_search_log",
    (
      await conn.query(
        `SELECT created_at,query_normalized,result_count,radius_miles FROM discover_search_log WHERE user_id=$1 ORDER BY created_at LIMIT ${EXPORT_ROW_CAP + 1}`,
        [userId],
      )
    ).rows,
  );
  const promotion_link_events = capped(
    "promotion_link_events",
    (
      await conn.query(
        `SELECT event_type,source,medium,campaign,content,occurred_at FROM promotion_link_events WHERE ${ownVisit} OR (event_type='share' AND owner_user_id=$1) ORDER BY occurred_at LIMIT ${EXPORT_ROW_CAP + 1}`,
        [userId],
      )
    ).rows,
  );
  return { site_visits, discover_search_log, promotion_link_events };
}
async function erase(conn, userId) {
  const summary = {};
  for (const table of ["site_visits", "discover_search_log"])
    summary[table] = (
      await conn.query(`DELETE FROM ${table} WHERE user_id=$1`, [userId])
    ).rowCount;
  summary.promotion_link_events = (
    await conn.query(
      `DELETE FROM promotion_link_events WHERE ${ownVisit} OR (event_type='share' AND owner_user_id=$1)`,
      [userId],
    )
  ).rowCount;
  return summary;
}
module.exports = { exportData, erase, EXPORT_ROW_CAP };
