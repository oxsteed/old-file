ALTER TABLE main_app_payment_disputes
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_main_app_payment_disputes_client_request_id
  ON main_app_payment_disputes (client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE food_restaurant_reports
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_food_restaurant_reports_client_request_id
  ON food_restaurant_reports (client_request_id)
  WHERE client_request_id IS NOT NULL;
