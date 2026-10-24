"use strict";

const AppError = require("../utils/appError");

function normalizeLocationId(value, field = "store") {
  if (
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw new AppError(`Invalid ${field}`, 400, "validation_failed");
  }
  return Number(value);
}

function normalizePublishRequest({ sourceLocationId, targetLocationIds }) {
  const source = normalizeLocationId(sourceLocationId, "source store");
  if (
    !Array.isArray(targetLocationIds) ||
    targetLocationIds.length < 1 ||
    targetLocationIds.length > 100
  ) {
    throw new AppError(
      "At least one and at most 100 target stores are required",
      400,
      "validation_failed",
    );
  }
  const targets = [
    ...new Set(targetLocationIds.map((value) => normalizeLocationId(value))),
  ];
  if (targets.length !== targetLocationIds.length)
    throw new AppError(
      "Target stores must be unique",
      400,
      "validation_failed",
    );
  if (targets.includes(source))
    throw new AppError(
      "The source store cannot be a target",
      400,
      "validation_failed",
    );
  return { sourceLocationId: source, targetLocationIds: targets };
}

function normalizeRegionCode(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(code)) {
    throw new AppError(
      "Region code must be 2-48 lowercase letters, numbers, hyphens, or underscores",
      400,
      "validation_failed",
    );
  }
  return code;
}

function normalizeRegionName(value) {
  const name = String(value || "").trim();
  if (name.length < 2 || name.length > 160) {
    throw new AppError(
      "Region name must be between 2 and 160 characters",
      400,
      "validation_failed",
    );
  }
  return name;
}

async function assertRegionParent(
  client,
  { restaurantId, regionId = null, parentRegionId = null },
) {
  if (parentRegionId == null) return;
  if (regionId != null && Number(regionId) === Number(parentRegionId)) {
    throw new AppError(
      "A region cannot be its own parent",
      400,
      "region_cycle",
    );
  }
  const {
    rows: [parent],
  } = await client.query(
    `SELECT id FROM restaurant_regions
      WHERE restaurant_id = $1 AND id = $2 AND status = 'active'`,
    [restaurantId, parentRegionId],
  );
  if (!parent)
    throw new AppError("Parent region not found", 404, "region_not_found");
  if (regionId != null) {
    const { rows: cycle } = await client.query(
      `WITH RECURSIVE descendants AS (
         SELECT id, parent_region_id
           FROM restaurant_regions
          WHERE restaurant_id = $1 AND id = $2
         UNION ALL
         SELECT child.id, child.parent_region_id
           FROM restaurant_regions child
           JOIN descendants parent ON parent.id = child.parent_region_id
          WHERE child.restaurant_id = $1
       )
       SELECT 1 FROM descendants WHERE id = $3 LIMIT 1`,
      [restaurantId, regionId, parentRegionId],
    );
    if (cycle.length)
      throw new AppError(
        "A region cannot be moved beneath one of its descendants",
        400,
        "region_cycle",
      );
  }
}

async function listRegions(client, restaurantId) {
  const { rows } = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT rr.id, rr.restaurant_id, rr.parent_region_id, rr.code, rr.name,
              rr.status, 0 AS depth, ARRAY[rr.id] AS path
         FROM restaurant_regions rr
        WHERE rr.restaurant_id = $1 AND rr.parent_region_id IS NULL
       UNION ALL
       SELECT child.id, child.restaurant_id, child.parent_region_id, child.code,
              child.name, child.status, tree.depth + 1, tree.path || child.id
         FROM restaurant_regions child
         JOIN tree ON tree.id = child.parent_region_id
        WHERE child.restaurant_id = $1
     )
     SELECT tree.*, COUNT(l.id)::int AS store_count
       FROM tree
       LEFT JOIN restaurant_locations l
         ON l.restaurant_id = tree.restaurant_id AND l.region_id = tree.id
      GROUP BY tree.id, tree.restaurant_id, tree.parent_region_id, tree.code,
               tree.name, tree.status, tree.depth, tree.path
      ORDER BY tree.path`,
    [restaurantId],
  );
  return rows;
}

async function createRegion(
  client,
  { restaurantId, code, name, parentRegionId = null, actorUserId = null },
) {
  const normalizedCode = normalizeRegionCode(code);
  const normalizedName = normalizeRegionName(name);
  await assertRegionParent(client, { restaurantId, parentRegionId });
  const {
    rows: [region],
  } = await client.query(
    `INSERT INTO restaurant_regions
       (restaurant_id, parent_region_id, code, name, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$5)
     RETURNING *`,
    [
      restaurantId,
      parentRegionId == null ? null : Number(parentRegionId),
      normalizedCode,
      normalizedName,
      actorUserId,
    ],
  );
  return region;
}

async function updateRegion(
  client,
  { restaurantId, regionId, patch, actorUserId = null },
) {
  const id = Number(regionId);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new AppError("A valid region is required", 400, "invalid_region_id");
  const {
    rows: [before],
  } = await client.query(
    `SELECT * FROM restaurant_regions WHERE restaurant_id = $1 AND id = $2 FOR UPDATE`,
    [restaurantId, id],
  );
  if (!before) throw new AppError("Region not found", 404, "region_not_found");
  const code =
    patch.code === undefined ? before.code : normalizeRegionCode(patch.code);
  const name =
    patch.name === undefined ? before.name : normalizeRegionName(patch.name);
  const parentRegionId =
    patch.parentRegionId === undefined
      ? before.parent_region_id
      : patch.parentRegionId;
  const status =
    patch.status === undefined
      ? before.status
      : String(patch.status).trim().toLowerCase();
  if (!["active", "archived"].includes(status))
    throw new AppError("Unsupported region status", 400, "validation_failed");
  if (
    String(before.code).toLowerCase() === "all-stores" &&
    (code !== before.code || parentRegionId != null || status === "archived")
  ) {
    throw new AppError(
      "The root region cannot be renamed, moved, or archived",
      409,
      "root_region_protected",
    );
  }
  await assertRegionParent(client, {
    restaurantId,
    regionId: id,
    parentRegionId,
  });
  const {
    rows: [after],
  } = await client.query(
    `UPDATE restaurant_regions
        SET code = $3, name = $4, parent_region_id = $5, status = $6,
            updated_by = $7, updated_at = NOW()
      WHERE restaurant_id = $1 AND id = $2
      RETURNING *`,
    [
      restaurantId,
      id,
      code,
      name,
      parentRegionId == null ? null : Number(parentRegionId),
      status,
      actorUserId,
    ],
  );
  return { before, after };
}

function storeShape(row, sales = [], health = {}) {
  return {
    id: Number(row.id),
    name: row.display_name,
    regionId: row.region_id == null ? null : Number(row.region_id),
    regionName: row.region_name || null,
    city: row.address_city || null,
    state: row.address_state || null,
    timezone: row.timezone,
    status: row.status,
    sales: sales.map((entry) => ({
      currencyCode: entry.currency_code,
      orderCount: Number(entry.order_count || 0),
      netCollectedCents: Number(entry.net_collected_cents || 0),
    })),
    health: {
      latestAuditScorePercent:
        health.latestAuditScorePercent == null
          ? null
          : Number(health.latestAuditScorePercent),
      openFindings: Number(health.openFindings || 0),
    },
    compliance: {
      checklistCompletionPercent:
        health.checklistCompletionPercent == null
          ? null
          : Number(health.checklistCompletionPercent),
      checklistRuns: Number(health.checklistRuns || 0),
      trainingCompletionPercent:
        health.trainingCompletionPercent == null
          ? null
          : Number(health.trainingCompletionPercent),
      trainingAssignments: Number(health.trainingAssignments || 0),
      overdueTraining: Number(health.overdueTraining || 0),
    },
  };
}

async function rollup(client, { businessId, restaurantIds, from, to }) {
  if (!Array.isArray(restaurantIds) || !restaurantIds.length)
    throw new AppError("No accessible stores found", 403, "hq_scope_empty");
  const salesParams = [businessId, restaurantIds, from, to];
  const { rows: salesRows } = await client.query(
    `SELECT restaurant_id, currency_code,
            COUNT(*) FILTER (WHERE payment_status = 'paid' AND status NOT IN ('cancelled','refunded'))::int AS order_count,
            COALESCE(SUM(total_cents) FILTER (WHERE payment_status = 'paid' AND status NOT IN ('cancelled','refunded')), 0)::bigint AS net_collected_cents
       FROM food_orders
      WHERE business_id = $1 AND restaurant_id = ANY($2::bigint[])
        AND created_at >= $3::timestamptz AND created_at < $4::timestamptz
      GROUP BY restaurant_id, currency_code
      ORDER BY restaurant_id, currency_code`,
    salesParams,
  );
  const { rows: healthRows } = await client.query(
    `SELECT r.id AS restaurant_id,
            (SELECT ROUND(100.0 * a.total_score / NULLIF(a.max_score, 0), 1)
               FROM restaurant_audits a
              WHERE a.restaurant_id = r.id AND a.status = 'completed'
              ORDER BY a.completed_at DESC NULLS LAST, a.id DESC LIMIT 1) AS latest_audit_score_percent,
            (SELECT COUNT(*)::int
               FROM restaurant_audit_findings f
               JOIN restaurant_audits a ON a.id = f.audit_id
              WHERE a.restaurant_id = r.id AND f.severity IN ('high','critical')) AS open_findings
       FROM food_restaurants r
      WHERE r.business_id = $1 AND r.id = ANY($2::bigint[])`,
    [businessId, restaurantIds],
  );
  const { rows: complianceRows } = await client.query(
    `WITH checklist AS (
       SELECT restaurant_id,
              COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs
         FROM restaurant_checklist_runs
        WHERE restaurant_id = ANY($1::bigint[])
          AND started_at >= $2::timestamptz AND started_at < $3::timestamptz
        GROUP BY restaurant_id
     ), training AS (
       SELECT a.restaurant_id,
              COUNT(*)::int AS assignments,
              COUNT(*) FILTER (
                WHERE a.status = 'completed'
                  AND EXISTS (
                    SELECT 1 FROM restaurant_training_completions c
                     WHERE c.assignment_id = a.id
                       AND c.passed = TRUE
                       AND (c.expires_at IS NULL OR c.expires_at >= NOW())
                  )
              )::int AS completed_assignments,
              COUNT(*) FILTER (WHERE a.status = 'overdue')::int AS overdue_assignments
         FROM restaurant_training_assignments a
        WHERE a.restaurant_id = ANY($1::bigint[])
        GROUP BY a.restaurant_id
     )
     SELECT r.id AS restaurant_id,
            COALESCE(checklist.runs, 0)::int AS checklist_runs,
            CASE WHEN COALESCE(checklist.runs, 0) = 0 THEN NULL
                 ELSE ROUND(100.0 * checklist.completed_runs / checklist.runs, 1) END AS checklist_completion_percent,
            COALESCE(training.assignments, 0)::int AS training_assignments,
            CASE WHEN COALESCE(training.assignments, 0) = 0 THEN NULL
                 ELSE ROUND(100.0 * training.completed_assignments / training.assignments, 1) END AS training_completion_percent,
            COALESCE(training.overdue_assignments, 0)::int AS overdue_training
       FROM food_restaurants r
       LEFT JOIN checklist ON checklist.restaurant_id = r.id
       LEFT JOIN training ON training.restaurant_id = r.id
      WHERE r.business_id = $4 AND r.id = ANY($1::bigint[])`,
    [restaurantIds, from, to, businessId],
  );
  return { salesRows, healthRows, complianceRows };
}

// Restaurant locations are the operational stores in the current rollout.
// Keep the legacy business/restaurant query above for callers that still use
// the pre-location contract, but make the HQ surface location-native.
async function rollupLocations(
  client,
  { restaurantId, locationIds, from, to, timezone = "UTC" },
) {
  if (!Array.isArray(locationIds) || !locationIds.length)
    throw new AppError("No accessible stores found", 403, "hq_scope_empty");
  const { orderFinancialsCte } = require("./restaurantSalesFacts");
  const inclusiveTo = new Date(
    Date.parse(String(to).slice(0, 10) + "T00:00:00Z") - 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const { rows: salesRows } = await client.query(
    orderFinancialsCte({ mode: "assigned" }) +
      `
    SELECT location_id,currency_code,COUNT(*) FILTER(WHERE net_collected_cents>0)::int AS order_count,
      COALESCE(SUM(net_collected_cents),0)::bigint AS net_collected_cents
    FROM order_financials GROUP BY location_id,currency_code ORDER BY location_id,currency_code`,
    [restaurantId, from, inclusiveTo, timezone, locationIds],
  );
  const { rows: healthRows } = await client.query(
    `SELECT l.id AS location_id, r.id AS restaurant_id,
            (SELECT ROUND(100.0 * a.total_score / NULLIF(a.max_score, 0), 1)
               FROM restaurant_audits a
              WHERE a.restaurant_id = r.id AND a.location_id=l.id AND a.status = 'completed'
              ORDER BY a.completed_at DESC NULLS LAST, a.id DESC LIMIT 1) AS latest_audit_score_percent,
            (SELECT COUNT(*)::int
               FROM restaurant_audit_findings f
               JOIN restaurant_audits a ON a.id = f.audit_id
              WHERE a.restaurant_id = r.id AND a.location_id=l.id AND f.severity IN ('high','critical')
                AND NOT EXISTS (SELECT 1 FROM restaurant_corrective_actions ca WHERE ca.finding_id=f.id GROUP BY ca.finding_id HAVING BOOL_AND(ca.status='verified'))) AS open_findings
       FROM restaurant_locations l
       JOIN food_restaurants r ON r.id = l.restaurant_id
      WHERE l.restaurant_id = $1 AND l.id = ANY($2::bigint[])`,
    [restaurantId, locationIds],
  );
  const { rows: complianceRows } = await client.query(
    `WITH checklist AS (
       SELECT restaurant_id,location_id,
              COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs
         FROM restaurant_checklist_runs
        WHERE restaurant_id = $1
          AND location_id=ANY($2::bigint[]) AND started_at >= ($3::timestamp AT TIME ZONE $5) AND started_at < ($4::timestamp AT TIME ZONE $5)
        GROUP BY restaurant_id,location_id
     ), training AS (
       SELECT a.restaurant_id,lm.location_id,
              COUNT(*)::int AS assignments,
              COUNT(*) FILTER (
                WHERE a.status = 'completed'
                  AND EXISTS (
                    SELECT 1 FROM restaurant_training_completions c
                     WHERE c.assignment_id = a.id
                       AND c.passed = TRUE
                       AND (c.expires_at IS NULL OR c.expires_at >= NOW())
                  )
              )::int AS completed_assignments,
              COUNT(*) FILTER (WHERE a.status = 'overdue')::int AS overdue_assignments
         FROM restaurant_training_assignments a
         JOIN restaurant_training_modules tm ON tm.id=a.module_id AND tm.is_active=TRUE AND tm.archived_at IS NULL
         JOIN food_restaurants fr ON fr.id=a.restaurant_id
         JOIN business_members bm ON bm.business_id=fr.business_id AND bm.member_id=a.user_id AND bm.status='active'
         JOIN restaurant_location_memberships lm ON lm.membership_id=bm.id AND lm.restaurant_id=a.restaurant_id AND lm.status='active'
        WHERE a.restaurant_id = $1 AND lm.location_id=ANY($2::bigint[])
        GROUP BY a.restaurant_id,lm.location_id
     )
     SELECT l.id AS location_id, r.id AS restaurant_id,
            COALESCE(checklist.runs, 0)::int AS checklist_runs,
            CASE WHEN COALESCE(checklist.runs, 0) = 0 THEN NULL
                 ELSE ROUND(100.0 * checklist.completed_runs / checklist.runs, 1) END AS checklist_completion_percent,
            COALESCE(training.assignments, 0)::int AS training_assignments,
            CASE WHEN COALESCE(training.assignments, 0) = 0 THEN NULL
                 ELSE ROUND(100.0 * training.completed_assignments / training.assignments, 1) END AS training_completion_percent,
            COALESCE(training.overdue_assignments, 0)::int AS overdue_training
       FROM restaurant_locations l
       JOIN food_restaurants r ON r.id = l.restaurant_id
       LEFT JOIN checklist ON checklist.restaurant_id = r.id AND checklist.location_id=l.id
       LEFT JOIN training ON training.restaurant_id = r.id AND training.location_id=l.id
      WHERE l.restaurant_id = $1 AND l.id = ANY($2::bigint[])`,
    [restaurantId, locationIds, from, to, timezone],
  );
  return { salesRows, healthRows, complianceRows };
}

async function publishMenuOverrides(
  client,
  {
    restaurantId,
    sourceLocationId,
    targetLocationIds,
    actorUserId,
    expectedRevision,
  },
) {
  const request = normalizePublishRequest({
    sourceLocationId,
    targetLocationIds,
  });
  const locationIds = [request.sourceLocationId, ...request.targetLocationIds];
  const { rows: locations } = await client.query(
    `SELECT id, name, status
       FROM restaurant_locations
      WHERE restaurant_id = $1 AND id = ANY($2::bigint[])
      ORDER BY id FOR UPDATE`,
    [restaurantId, locationIds],
  );
  if (locations.length !== locationIds.length)
    throw new AppError(
      "One or more stores were not found",
      404,
      "location_not_found",
    );
  if (
    expectedRevision &&
    (await previewMenuOverrides(client, { restaurantId, ...request }))
      .revision !== expectedRevision
  )
    throw new AppError(
      "Menu changed; review a new preview",
      409,
      "menu_preview_stale",
    );
  // Clear inherited rows as well as copying explicit rows; otherwise a reset at
  // the source leaves an old target price/86 override in place indefinitely.
  await client.query(
    `DELETE FROM restaurant_store_menu_overrides target WHERE target.restaurant_id=$1 AND target.location_id=ANY($3::bigint[]) AND NOT EXISTS(SELECT 1 FROM restaurant_store_menu_overrides source WHERE source.restaurant_id=$1 AND source.location_id=$2 AND source.menu_item_id=target.menu_item_id)`,
    [restaurantId, request.sourceLocationId, request.targetLocationIds],
  );
  const { rows: copied } = await client.query(
    `INSERT INTO restaurant_store_menu_overrides
       (restaurant_id, location_id, menu_item_id, price_cents, is_available, available_again_at, updated_by)
     SELECT $1, target.id, source.menu_item_id, source.price_cents, source.is_available,
            source.available_again_at, $4
       FROM restaurant_store_menu_overrides source
       CROSS JOIN UNNEST($3::bigint[]) AS target(id)
      WHERE source.restaurant_id = $1 AND source.location_id = $2
     ON CONFLICT (restaurant_id, location_id, menu_item_id)
     DO UPDATE SET price_cents = EXCLUDED.price_cents,
                   is_available = EXCLUDED.is_available,
                   available_again_at = EXCLUDED.available_again_at,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()
     RETURNING location_id, menu_item_id`,
    [
      restaurantId,
      request.sourceLocationId,
      request.targetLocationIds,
      actorUserId || null,
    ],
  );
  const counts = new Map(request.targetLocationIds.map((id) => [id, 0]));
  for (const row of copied)
    counts.set(
      Number(row.location_id),
      (counts.get(Number(row.location_id)) || 0) + 1,
    );
  return {
    sourceLocationId: request.sourceLocationId,
    targets: request.targetLocationIds.map((id) => ({
      locationId: id,
      copiedOverrides: counts.get(id) || 0,
    })),
  };
}

module.exports = {
  storeShape,
  rollup,
  rollupLocations,
  normalizePublishRequest,
  publishMenuOverrides,
  listRegions,
  createRegion,
  updateRegion,
  normalizeRegionCode,
  normalizeRegionName,
};

async function previewMenuOverrides(
  client,
  { restaurantId, sourceLocationId, targetLocationIds },
) {
  const request = normalizePublishRequest({
      sourceLocationId,
      targetLocationIds,
    }),
    ids = [request.sourceLocationId, ...request.targetLocationIds];
  const { rows: stores } = await client.query(
    "SELECT id,name FROM restaurant_locations WHERE restaurant_id=$1 AND id=ANY($2::bigint[]) ORDER BY id",
    [restaurantId, ids],
  );
  if (stores.length !== ids.length)
    throw new AppError("One or more stores were not found", 404, "location_not_found");
  const { rows } = await client.query(
    "SELECT ov.location_id,ov.menu_item_id,ov.price_cents,ov.is_available,ov.available_again_at,mi.name AS item_name FROM restaurant_store_menu_overrides ov JOIN food_menu_items mi ON mi.id=ov.menu_item_id WHERE ov.restaurant_id=$1 AND ov.location_id=ANY($2::bigint[]) ORDER BY ov.location_id,ov.menu_item_id",
    [restaurantId, ids],
  );
  const values = (row) =>
    row
      ? {
          priceCents: row.price_cents,
          available: row.is_available,
          returnAt: row.available_again_at,
        }
      : null;
  const source = new Map(
    rows
      .filter((row) => Number(row.location_id) === request.sourceLocationId)
      .map((row) => [Number(row.menu_item_id), row]),
  );
  const changes = [];
  for (const locationId of request.targetLocationIds) {
    const target = new Map(
      rows
        .filter((row) => Number(row.location_id) === locationId)
        .map((row) => [Number(row.menu_item_id), row]),
    );
    for (const itemId of new Set([...source.keys(), ...target.keys()])) {
      const before = values(target.get(itemId)),
        after = values(source.get(itemId));
      if (JSON.stringify(before) !== JSON.stringify(after))
        changes.push({
          locationId,
          itemId,
          itemName:
            source.get(itemId)?.item_name || target.get(itemId)?.item_name,
          before,
          after,
        });
    }
  }
  return {
    ...request,
    changes,
    revision: require("crypto")
      .createHash("sha256")
      .update(JSON.stringify([restaurantId, request, rows]))
      .digest("hex"),
  };
}
module.exports.previewMenuOverrides = previewMenuOverrides;
