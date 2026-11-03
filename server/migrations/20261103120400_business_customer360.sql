-- Customer 360 upgrade 6: business-scoped Customer 360 for business and
-- restaurant owners. Read-only over existing relationship tables; these
-- indexes keep the per-business customer list and profile bounded at scale.

CREATE INDEX IF NOT EXISTS idx_food_orders_business_customer
  ON food_orders (business_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_appointments_business_customer
  ON business_appointments (business_id, customer_id, start_time DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_invoices_business_client_email
  ON business_invoices (business_id, lower(client_email))
  WHERE client_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_clients_business_customer
  ON business_clients (business_id, customer_id)
  WHERE customer_id IS NOT NULL AND deleted_at IS NULL;
