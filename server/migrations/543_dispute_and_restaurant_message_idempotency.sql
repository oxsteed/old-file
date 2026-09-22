-- Make the remaining customer communication entry points safe to retry after
-- a lost response or a reconnect. Existing rows remain unchanged.
ALTER TABLE dispute_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dispute_messages_client_id
  ON dispute_messages (dispute_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE food_restaurant_customer_messages
  ADD COLUMN IF NOT EXISTS client_message_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_food_restaurant_customer_messages_client_id
  ON food_restaurant_customer_messages (restaurant_id, customer_user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
