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
