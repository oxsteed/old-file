"use strict";
const { hasGlobalGrant } = require("../middleware/adminAuth");
const { regionalTerritory } = require("../analytics/metricAccess");
const { locationInRegionsSql } = require("../analytics/regionScope");
async function scope(user, permission) {
  const {
    rows: [current],
  } = await require("../db").query(
    "SELECT role,is_active FROM users WHERE id=$1",
    [user?.id],
  );
  if (!current?.is_active || !["admin", "super_admin"].includes(current.role))
    throw Object.assign(new Error("growth_permission_required"), {
      status: 403,
    });
  if (
    current.role === "super_admin" ||
    (await hasGlobalGrant(user.id, permission))
  )
    return { global: true };
  const territory = await regionalTerritory(user.id, permission);
  if (!territory.regions.length)
    throw Object.assign(new Error("region_unknown"), { status: 403 });
  return { global: false, regions: territory.regions };
}
function predicate(boundary, alias, params) {
  if (boundary.global) return "TRUE";
  params.push(JSON.stringify(boundary.regions));
  return locationInRegionsSql(
    {
      zip: `${alias}.postal_code`,
      city: `${alias}.place_name`,
      state: `${alias}.admin1`,
      country: `${alias}.country`,
      lat: `${alias}.lat`,
      lng: `${alias}.lng`,
    },
    `$${params.length}::jsonb`,
  );
}
module.exports = { scope, predicate };
