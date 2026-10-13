-- Review W2 (P3-821): refund/payment disputes filed through the main app sat
-- 'open' forever. Admins now decide them through an API; in addition, closing
-- the linked support ticket closes the dispute so nothing is stranded.

CREATE OR REPLACE FUNCTION main_app_payment_dispute_sync_ticket()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('resolved', 'closed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE main_app_payment_disputes
       SET status = 'resolved',
           resolved_at = COALESCE(resolved_at, NOW()),
           metadata = metadata || jsonb_build_object('resolved_via', 'support_ticket', 'ticket_status', NEW.status),
           updated_at = NOW()
     WHERE support_ticket_uuid = NEW.id
       AND status IN ('open', 'under_review');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_main_app_payment_dispute_sync_ticket ON support_tickets;
CREATE TRIGGER trg_main_app_payment_dispute_sync_ticket
  AFTER UPDATE OF status ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION main_app_payment_dispute_sync_ticket();

-- Backfill: disputes whose ticket is already closed.
UPDATE main_app_payment_disputes d
   SET status = 'resolved',
       resolved_at = COALESCE(d.resolved_at, NOW()),
       metadata = d.metadata || jsonb_build_object('resolved_via', 'support_ticket_backfill'),
       updated_at = NOW()
  FROM support_tickets t
 WHERE t.id = d.support_ticket_uuid
   AND t.status IN ('resolved', 'closed')
   AND d.status IN ('open', 'under_review');

CREATE INDEX IF NOT EXISTS idx_main_app_payment_disputes_status_opened
  ON main_app_payment_disputes (status, opened_at DESC);
