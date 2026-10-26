"use strict";
// D16: admin operational notices (e.g. "regional analytics now use GeoNames
// postal centres") and a read-only view of the region geo source switch.
// Switching and rollback stay operator actions (server/scripts/
// regionGeoSourceSwitch.js) run with the GeoNames load, so this API never
// bypasses the two-admin settings-change workflow.
const router = require("express").Router();
const db = require("../db");
const { requireAdmin, requirePermission, lookupGrants } = require("../middleware/adminAuth");
const geoSwitch = require("../analytics/regionGeoSourceSwitch");

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(requireAdmin);

async function canSee(req, permission) {
  if (!permission || permission === "any_admin" || req.isSuper) return true;
  const rows = await lookupGrants(req.user.id, permission);
  return rows.length > 0;
}

router.get(
  "/notices",
  wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT n.id,n.notice_key,n.category,n.title_key,n.body_key,n.params,n.audience_permission,n.created_at,n.expires_at
         FROM admin_operational_notices n
        WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
          AND NOT EXISTS (SELECT 1 FROM admin_operational_notice_acks a WHERE a.notice_id=n.id AND a.user_id=$1)
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 20`,
      [req.user.id],
    );
    const visible = [];
    for (const row of rows) {
      if (await canSee(req, row.audience_permission)) {
        const { audience_permission, ...notice } = row;
        visible.push(notice);
      }
    }
    res.json({ notices: visible });
  }),
);

router.post(
  "/notices/:id/ack",
  wrap(async (req, res) => {
    if (!/^[1-9]\d{0,15}$/.test(String(req.params.id))) return res.status(400).json({ error: "invalid_notice_id" });
    const { rowCount } = await db.query(
      `INSERT INTO admin_operational_notice_acks(notice_id,user_id)
       SELECT id,$2 FROM admin_operational_notices WHERE id=$1
       ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.id],
    );
    res.json({ acknowledged: true, inserted: rowCount > 0 });
  }),
);

router.get(
  "/region-geo-source",
  requirePermission("manage_settings"),
  wrap(async (req, res) => {
    const current = await geoSwitch.currentSource(db);
    const { rows: prev } = await db.query("SELECT value FROM platform_settings WHERE key=$1", [geoSwitch.PREVIOUS]);
    const { rows: history } = await db.query(
      `SELECT id,from_source,to_source,mode,diff,coverage,source_version,performed_at
         FROM region_geo_source_switches ORDER BY performed_at DESC, id DESC LIMIT 10`,
    );
    res.json({ current, previous: prev[0]?.value || null, history });
  }),
);

router.post(
  "/region-geo-source/dry-run",
  requirePermission("manage_settings"),
  wrap(async (req, res) => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await geoSwitch.dryRun(client, { userId: req.user.id });
      await client.query("COMMIT");
      res.json(result);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }),
);

module.exports = router;
