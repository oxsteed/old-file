-- Migration 046: Support ticket system
-- Replaces email-only support with a full ticket/assignment workflow

CREATE SEQUENCE IF NOT EXISTS support_ticket_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS support_tickets (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number     INTEGER     UNIQUE DEFAULT nextval('support_ticket_number_seq'),
  user_id           UUID        REFERENCES users(id) ON DELETE SET NULL,
  name              VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  subject           VARCHAR(500) NOT NULL DEFAULT 'Support Request',
  category          VARCHAR(100) NOT NULL DEFAULT 'general',
  priority          VARCHAR(20)  NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  status            VARCHAR(30)  NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','assigned','in_progress','waiting_user','resolved','closed')),
  source            VARCHAR(30)  NOT NULL DEFAULT 'widget'
                      CHECK (source IN ('widget','escalation','direct','email')),
  assigned_to       UUID        REFERENCES users(id) ON DELETE SET NULL,
  assigned_at       TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  metadata          JSONB       NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  sender_name   VARCHAR(255),         -- populated for guest / system messages
  sender_email  VARCHAR(255),
  content       TEXT        NOT NULL,
  is_internal   BOOLEAN     NOT NULL DEFAULT false,   -- admin-only note
  is_from_admin BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status   ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id  ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created  ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket  ON support_messages(ticket_id, created_at);
