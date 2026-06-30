-- Migration 360: Make reports, disputes, refunds, and guest inquiries visible/claimable.
-- These links keep specialized operational records while giving users a durable
-- support/history trail and a path back into normal conversations.

ALTER TABLE food_restaurant_reports
  ADD COLUMN IF NOT EXISTS support_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_food_restaurant_reports_support_ticket
  ON food_restaurant_reports(support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS support_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_disputes_support_ticket
  ON disputes(support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;

ALTER TABLE main_app_payment_disputes
  ADD COLUMN IF NOT EXISTS support_ticket_uuid UUID REFERENCES support_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_main_app_payment_disputes_support_ticket
  ON main_app_payment_disputes(support_ticket_uuid)
  WHERE support_ticket_uuid IS NOT NULL;

ALTER TABLE guest_profile_chat_inbound
  ADD COLUMN IF NOT EXISTS claimed_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_guest_chat_claimed_user
  ON guest_profile_chat_inbound(claimed_user_id, claimed_at DESC)
  WHERE claimed_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guest_chat_claimed_conversation
  ON guest_profile_chat_inbound(claimed_conversation_id)
  WHERE claimed_conversation_id IS NOT NULL;
