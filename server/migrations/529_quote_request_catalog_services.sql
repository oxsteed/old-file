-- Migration 529: retain catalog service selections as relational quote data.
-- The existing quote_requests.metadata remains backward-compatible, while this
-- join table makes one request-to-many catalog services queryable and stable.

CREATE TABLE IF NOT EXISTS quote_request_services (
  id BIGSERIAL PRIMARY KEY,
  quote_request_id BIGINT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES direct_catalog_services(id) ON DELETE RESTRICT,
  service_name VARCHAR(120) NOT NULL,
  category_slug VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (quote_request_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_request_services_request
  ON quote_request_services (quote_request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_quote_request_services_service
  ON quote_request_services (service_id, created_at);
