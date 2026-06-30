-- Migration 359: Link restaurant contact messages to the shared chat inbox.
-- Customer-to-restaurant messages should remain auditable in the food table
-- while also appearing as normal conversations for customers and restaurant teams.

ALTER TABLE food_restaurant_customer_messages
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chat_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_food_restaurant_customer_messages_conversation
  ON food_restaurant_customer_messages(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_food_restaurant_customer_messages_chat_message
  ON food_restaurant_customer_messages(chat_message_id)
  WHERE chat_message_id IS NOT NULL;
