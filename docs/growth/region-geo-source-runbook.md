# Regional geo-source switch

`analytics.region_geo_source` is a reviewed settings value with two accepted
values:

- `direct_geocode_cache` (the compatibility default)
- `geo_postal_centroids` (the imported GeoNames postal-centroid source)

Before switching, an administrator runs `node scripts/regionGeoDiff.js` against
the same database and records the aggregate result in the settings change note.
The diff script prints counts only and does not expose user or postal values.

Rollback is the same settings change back to `direct_geocode_cache`. Regional
queries read the setting when the grant scope is built; an absent or invalid
value keeps the compatibility source and never broadens a regional result.

The switch remains a release gate until the diff, regional query smoke test,
and rollback are recorded by an authorized administrator.

## D16: load and switch together (decision: switch at the same time as the load)

The owner decided regional filters flip to GeoNames at the same time the
centroids are loaded. The tooling for that:

1. Dry run (no setting change, recorded in `region_geo_source_switches`):

   ```
   node server/scripts/regionGeoSourceSwitch.js --dry-run --version=geonames-YYYY-MM
   ```

   or `POST /api/admin/operational-notices/region-geo-source/dry-run`
   (`manage_settings`). `GET .../region-geo-source` shows the current and
   previous source and the last ten dry runs / switches / rollbacks.

2. Load and switch in one operator run:

   ```
   node server/scripts/importPostalCentroids.js postal-and-switch allCountries.txt geonames-YYYY-MM
   ```

   The load commits first (idempotent). The switch then runs in its own
   transaction and is **refused** when the centroid table is empty or when
   the centroids place fewer than 95% of the users the current source
   already places (`centroid_coverage_regression`). `--force` on the switch
   CLI overrides only the regression guard, never an empty table.

3. On a switch the job writes `analytics.region_geo_source_previous` (the
   rollback setting), the aggregate diff and coverage, an
   `admin_operational_notices` row (banner at the top of the admin console
   until each admin dismisses it, in en/es/fr/ht/ar), an in-app notification
   to super-admins and regionally scoped admins (in-app only, not email),
   and an admin audit entry when run by a named admin.

4. Rollback in one step:

   ```
   node server/scripts/regionGeoSourceSwitch.js --rollback
   ```

   It restores the previous value, records the rollback, and posts its own
   notice.

Switch and rollback are operator actions run with the data load; the admin
API is read-only plus dry run so it never bypasses the two-admin settings
change workflow for platform settings.
