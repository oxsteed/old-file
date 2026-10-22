CREATE TABLE geo_postal_centroids (
 id SERIAL PRIMARY KEY, country CHAR(2) NOT NULL, postal_code TEXT NOT NULL,
 place_name TEXT NOT NULL, admin1 TEXT, admin2 TEXT,
 lat DOUBLE PRECISION NOT NULL CHECK(lat BETWEEN -90 AND 90),
 lng DOUBLE PRECISION NOT NULL CHECK(lng BETWEEN -180 AND 180),
 geog GEOGRAPHY(POINT,4326) NOT NULL,
 h3_r5 TEXT NOT NULL, h3_r7 TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'GeoNames CC BY 4.0', source_version TEXT NOT NULL,
 UNIQUE(country,postal_code,place_name)
);
CREATE INDEX ON geo_postal_centroids USING GIST(geog);
CREATE INDEX ON geo_postal_centroids(country,postal_code);
