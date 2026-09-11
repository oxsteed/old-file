-- Preserve an append-only lifecycle timeline for every support conversation.
-- The trigger covers changes made by HTTP, realtime, workers, and channel ingress.

CREATE TABLE IF NOT EXISTS support_conversation_lifecycle_events (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  status_from VARCHAR(40),
  status_to VARCHAR(40) NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  change_reason VARCHAR(255),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_lifecycle_conversation
  ON support_conversation_lifecycle_events (conversation_id, changed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION record_support_conversation_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO support_conversation_lifecycle_events (
      conversation_id, status_from, status_to, changed_at
    ) VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
      NEW.status,
      CURRENT_TIMESTAMP
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_conversation_lifecycle_history
  ON support_conversations;

CREATE TRIGGER trg_support_conversation_lifecycle_history
AFTER INSERT OR UPDATE OF status ON support_conversations
FOR EACH ROW
EXECUTE FUNCTION record_support_conversation_lifecycle_event();

-- Lifecycle rows are evidence, not mutable application state.
CREATE OR REPLACE FUNCTION prevent_support_conversation_lifecycle_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Support conversation lifecycle events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_support_lifecycle_events_immutable
  ON support_conversation_lifecycle_events;

CREATE TRIGGER trg_support_lifecycle_events_immutable
BEFORE UPDATE OR DELETE ON support_conversation_lifecycle_events
FOR EACH ROW
EXECUTE FUNCTION prevent_support_conversation_lifecycle_mutation();
