-- D16: keep the existing direct-geocode path as the reversible default. The
-- settings approval workflow may switch regional analytics to the imported
-- GeoNames postal-centroid table after a diff and admin note are recorded.
INSERT INTO platform_settings(key,value,value_type,description)
VALUES (
  'analytics.region_geo_source',
  'direct_geocode_cache',
  'string',
  'Regional analytics geo source: direct_geocode_cache or geo_postal_centroids'
)
ON CONFLICT(key) DO NOTHING;
