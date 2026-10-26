"use strict";
// D16: switch regional analytics from the US-only direct geocode cache to the
// imported GeoNames postal centroids AT THE SAME TIME the centroids are
// loaded, with a dry-run diff, a coverage guard, an admin notice and a
// one-command rollback.
//
// - dryRun()  : coverage + aggregate diff, recorded in
//               region_geo_source_switches (mode dry_run). No setting changes.
// - switchToCentroids(): refuses when the centroid table is empty or covers
//               materially fewer users than today's source (unless forced),
//               then flips analytics.region_geo_source, remembers the previous
//               value in analytics.region_geo_source_previous, records the
//               diff, writes an admin_operational_notices row and notifies the
//               admins whose analytics are region-scoped (their numbers move).
// - rollback(): restores the previous source with its own notice.
// Everything runs in one transaction; counts only, never user or postal values.
function diffQuery(limit = 10000) {
  const n = Math.max(1, Math.min(100000, Number(limit) || 10000));
  return {
    text: `WITH sample AS (
      SELECT u.id,u.country,u.zip_code,d.lat AS direct_lat,d.lng AS direct_lng,
             g.lat AS centroid_lat,g.lng AS centroid_lng
        FROM users u
        LEFT JOIN LATERAL (
          SELECT lat,lng FROM direct_geocode_cache
           WHERE upper(btrim(COALESCE(u.country,'')))='US'
             AND zip_code=substring(btrim(COALESCE(u.zip_code,'')) FROM '^[0-9]{5}')
           ORDER BY updated_at DESC NULLS LAST LIMIT 1
        ) d ON TRUE
        LEFT JOIN LATERAL (
          SELECT z.lat,z.lng FROM geo_postal_centroids z
           WHERE upper(btrim(COALESCE(u.country,'')))=upper(btrim(COALESCE(z.country,'')))
             AND z.postal_code=substring(btrim(COALESCE(u.zip_code,'')) FROM '^[0-9]{3,10}')
           ORDER BY z.id LIMIT 1
        ) g ON TRUE
       WHERE d.lat IS NOT NULL OR g.lat IS NOT NULL
       LIMIT $1
    )
    SELECT COUNT(*)::int AS matched,
           COUNT(*) FILTER (WHERE direct_lat IS NULL OR centroid_lat IS NULL)::int AS one_sided,
           COUNT(*) FILTER (WHERE direct_lat IS NOT NULL AND centroid_lat IS NOT NULL
             AND abs(direct_lat-centroid_lat)>0.01)::int AS latitude_disagreements,
           COUNT(*) FILTER (WHERE direct_lng IS NOT NULL AND centroid_lng IS NOT NULL
             AND abs(direct_lng-centroid_lng)>0.01)::int AS longitude_disagreements
      FROM sample`,
    values: [n],
  };
}


const SOURCES = new Set(["direct_geocode_cache", "geo_postal_centroids"]);
const SETTING = "analytics.region_geo_source";
const PREVIOUS = "analytics.region_geo_source_previous";
// The centroid source must cover at least this share of the users the
// current source already places, or the switch is refused (fail safe).
const DEFAULT_MIN_RELATIVE_COVERAGE = 0.95;

async function currentSource(conn) {
  const { rows } = await conn.query("SELECT value FROM platform_settings WHERE key=$1", [SETTING]);
  return SOURCES.has(rows[0]?.value) ? rows[0].value : "direct_geocode_cache";
}

async function coverage(conn) {
  const {
    rows: [row],
  } = await conn.query(
    `SELECT
       (SELECT COUNT(*)::int FROM geo_postal_centroids) AS centroid_rows,
       (SELECT COUNT(DISTINCT country)::int FROM geo_postal_centroids) AS centroid_countries,
       (SELECT COUNT(*)::int FROM users u WHERE btrim(COALESCE(u.zip_code,'')) <> '') AS users_with_postal,
       (SELECT COUNT(*)::int FROM users u WHERE EXISTS (
          SELECT 1 FROM direct_geocode_cache d
           WHERE upper(btrim(COALESCE(u.country,'')))='US'
             AND d.zip_code=substring(btrim(COALESCE(u.zip_code,'')) FROM '^[0-9]{5}')
             AND d.lat IS NOT NULL)) AS users_located_direct,
       (SELECT COUNT(*)::int FROM users u WHERE EXISTS (
          SELECT 1 FROM geo_postal_centroids z
           WHERE upper(btrim(COALESCE(u.country,'')))=upper(btrim(COALESCE(z.country,'')))
             AND z.postal_code=substring(btrim(COALESCE(u.zip_code,'')) FROM '^[0-9]{3,10}'))) AS users_located_centroids`,
  );
  return {
    centroid_rows: Number(row?.centroid_rows || 0),
    centroid_countries: Number(row?.centroid_countries || 0),
    users_with_postal: Number(row?.users_with_postal || 0),
    users_located_direct: Number(row?.users_located_direct || 0),
    users_located_centroids: Number(row?.users_located_centroids || 0),
  };
}

function coverageAllowsSwitch(cov, minRelative = DEFAULT_MIN_RELATIVE_COVERAGE) {
  if (!cov.centroid_rows) return { ok: false, reason: "centroids_not_loaded" };
  if (cov.users_located_direct > 0 && cov.users_located_centroids < cov.users_located_direct * minRelative)
    return { ok: false, reason: "centroid_coverage_regression" };
  return { ok: true };
}

async function recordSwitch(conn, entry) {
  const {
    rows: [row],
  } = await conn.query(
    `INSERT INTO region_geo_source_switches(from_source,to_source,mode,diff,coverage,source_version,notice_id,performed_by)
     VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) RETURNING id`,
    [
      entry.from,
      entry.to,
      entry.mode,
      JSON.stringify(entry.diff || {}),
      JSON.stringify(entry.coverage || {}),
      entry.sourceVersion || null,
      entry.noticeId || null,
      entry.userId || null,
    ],
  );
  return row.id;
}

async function dryRun(conn, { userId = null, sourceVersion = null, limit } = {}) {
  const from = await currentSource(conn);
  const diff = (await conn.query(diffQuery(limit))).rows[0] || {};
  const cov = await coverage(conn);
  const guard = coverageAllowsSwitch(cov);
  const id = await recordSwitch(conn, {
    from,
    to: "geo_postal_centroids",
    mode: "dry_run",
    diff,
    coverage: { ...cov, guard },
    sourceVersion,
    userId,
  });
  return { id, from, diff, coverage: cov, guard };
}

async function regionScopedAdmins(conn) {
  const { rows } = await conn.query(
    `SELECT DISTINCT u.id FROM users u
      WHERE u.role='super_admin' AND COALESCE(u.is_active,TRUE)
      UNION
     SELECT DISTINCT g.grantee_id FROM admin_permission_grants g
      WHERE g.region_id IS NOT NULL AND g.revoked_at IS NULL AND g.expires_at > NOW()`,
  );
  return rows.map((r) => r.id).filter(Boolean);
}

async function createNotice(conn, { key, titleKey, bodyKey, params, userId }) {
  const {
    rows: [notice],
  } = await conn.query(
    `INSERT INTO admin_operational_notices(notice_key,category,title_key,body_key,params,audience_permission,created_by,expires_at)
     VALUES($1,'analytics',$2,$3,$4::jsonb,'any_admin',$5,NOW()+interval '30 days')
     ON CONFLICT(notice_key) DO UPDATE SET params=EXCLUDED.params
     RETURNING id`,
    [key, titleKey, bodyKey, JSON.stringify(params || {}), userId || null],
  );
  return notice.id;
}

async function notifyAdmins(conn, adminIds, { type, params, noticeId, title, body }) {
  // In-app only (the type is not in the email allow-list): an operational
  // note for staff, rendered in each admin's language from data.params.
  const notifications = require("../services/notificationService");
  if (!adminIds.length) return 0;
  await notifications.sendBulkNotification({
    userIds: adminIds.slice(0, 1000),
    type,
    title,
    body,
    data: { notice_id: noticeId, params, action_url: "/admin/analytics" },
    idempotencyKey: `admin-notice:${noticeId}`,
  });
  return Math.min(adminIds.length, 1000);
}

async function setSource(conn, to, previous) {
  await conn.query(
    `INSERT INTO platform_settings(key,value,value_type,description) VALUES($1,$2,'string',
       'Regional analytics geo source: direct_geocode_cache or geo_postal_centroids')
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [SETTING, to],
  );
  await conn.query(
    `INSERT INTO platform_settings(key,value,value_type,description) VALUES($1,$2,'string',
       'Previous regional analytics geo source, kept for one-step rollback (D16)')
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [PREVIOUS, previous],
  );
}

async function switchToCentroids(conn, { userId = null, sourceVersion = null, force = false, minRelativeCoverage, limit } = {}) {
  const from = await currentSource(conn);
  if (from === "geo_postal_centroids") return { switched: false, reason: "already_on_centroids" };
  const diff = (await conn.query(diffQuery(limit))).rows[0] || {};
  const cov = await coverage(conn);
  const guard = coverageAllowsSwitch(cov, minRelativeCoverage);
  if (!guard.ok && !(force && guard.reason !== "centroids_not_loaded")) {
    await recordSwitch(conn, { from, to: "geo_postal_centroids", mode: "dry_run", diff, coverage: { ...cov, guard }, sourceVersion, userId });
    return { switched: false, reason: guard.reason, diff, coverage: cov };
  }
  await setSource(conn, "geo_postal_centroids", from);
  const params = {
    from,
    to: "geo_postal_centroids",
    source_version: sourceVersion,
    matched: Number(diff.matched || 0),
    one_sided: Number(diff.one_sided || 0),
    latitude_disagreements: Number(diff.latitude_disagreements || 0),
    longitude_disagreements: Number(diff.longitude_disagreements || 0),
    users_located_before: cov.users_located_direct,
    users_located_after: cov.users_located_centroids,
  };
  const noticeId = await createNotice(conn, {
    key: `region-geo-source:${sourceVersion || "manual"}:${Date.now()}`,
    titleKey: "adminOperationalNotices.regionGeoSource.switchedTitle",
    bodyKey: "adminOperationalNotices.regionGeoSource.switchedBody",
    params,
    userId,
  });
  const id = await recordSwitch(conn, { from, to: "geo_postal_centroids", mode: "switch", diff, coverage: { ...cov, guard, forced: !guard.ok }, sourceVersion, noticeId, userId });
  const notice = {
    type: "admin_operational_notice_region_geo_switched",
    params: { ...params, usersBefore: cov.users_located_direct, usersAfter: cov.users_located_centroids },
    noticeId,
    title: "Regional analytics now use GeoNames postal centres",
    body: "Some regional numbers changed. Open Analytics for the diff and rollback.",
  };
  if (userId) {
    const { logAdminAction } = require("../services/auditService");
    await logAdminAction({ adminId: userId, action: "analytics_region_geo_source_switched", targetType: "platform_setting", targetKey: SETTING, before: { value: from }, after: { value: "geo_postal_centroids", switch_id: id }, client: conn });
  }
  return { switched: true, id, noticeId, notice, diff, coverage: cov };
}

async function rollback(conn, { userId = null } = {}) {
  const from = await currentSource(conn);
  const { rows } = await conn.query("SELECT value FROM platform_settings WHERE key=$1", [PREVIOUS]);
  const to = SOURCES.has(rows[0]?.value) && rows[0].value !== from ? rows[0].value : "direct_geocode_cache";
  if (from === to) return { rolledBack: false, reason: "nothing_to_roll_back" };
  await setSource(conn, to, from);
  const noticeId = await createNotice(conn, {
    key: `region-geo-source:rollback:${Date.now()}`,
    titleKey: "adminOperationalNotices.regionGeoSource.rolledBackTitle",
    bodyKey: "adminOperationalNotices.regionGeoSource.rolledBackBody",
    params: { from, to },
    userId,
  });
  const id = await recordSwitch(conn, { from, to, mode: "rollback", diff: {}, coverage: {}, noticeId, userId });
  const notice = {
    type: "admin_operational_notice_region_geo_rolled_back",
    params: { from, to },
    noticeId,
    title: "Regional analytics geo source rolled back",
    body: `Regional analytics are back on ${to}.`,
  };
  if (userId) {
    const { logAdminAction } = require("../services/auditService");
    await logAdminAction({ adminId: userId, action: "analytics_region_geo_source_rolled_back", targetType: "platform_setting", targetKey: SETTING, before: { value: from }, after: { value: to, switch_id: id }, client: conn });
  }
  return { rolledBack: true, id, noticeId, notice, from, to };
}

// Call AFTER the switch/rollback transaction commits so admins are never
// told about a change that rolled back. Failure is logged, not thrown.
async function notifyAdminsOfResult(conn, result) {
  if (!result?.notice) return 0;
  try {
    return await notifyAdmins(conn, await regionScopedAdmins(conn), result.notice);
  } catch {
    return 0;
  }
}

module.exports = {
  diffQuery,
  notifyAdminsOfResult,
  SETTING,
  PREVIOUS,
  currentSource,
  coverage,
  coverageAllowsSwitch,
  dryRun,
  switchToCentroids,
  rollback,
};
