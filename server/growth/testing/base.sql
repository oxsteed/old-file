-- Synthetic predecessor-schema fixture; never applied by the migration runner.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE users(id UUID PRIMARY KEY,role TEXT,is_active BOOLEAN DEFAULT TRUE,is_banned BOOLEAN DEFAULT FALSE,
 deleted_at TIMESTAMPTZ,is_suspended BOOLEAN DEFAULT FALSE,country TEXT,country_confirmed BOOLEAN DEFAULT FALSE,
 city TEXT,state TEXT,zip_code TEXT,preferred_language TEXT DEFAULT 'en',created_at TIMESTAMPTZ DEFAULT NOW(),email TEXT);
CREATE TABLE user_consents(id BIGSERIAL PRIMARY KEY,user_id UUID,consent_type TEXT,version TEXT,accepted_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE platform_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,value_type TEXT,description TEXT);
CREATE TABLE discover_search_log(id BIGSERIAL PRIMARY KEY,query_normalized TEXT,result_count INTEGER,radius_miles INTEGER,
 lat FLOAT8,lng FLOAT8,ip_hash TEXT,user_id UUID,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE marketplace_products(id UUID PRIMARY KEY);
CREATE TABLE discount_codes(id BIGSERIAL PRIMARY KEY);
