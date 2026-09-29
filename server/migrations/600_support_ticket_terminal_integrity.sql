-- Migration 600: keep support-ticket terminal states recoverable but explicit.
-- Reopening is an intentional workflow transition to open; direct SQL or a
-- stale worker must not jump a resolved/closed case into active work.

CREATE OR REPLACE FUNCTION enforce_support_ticket_terminal_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status NOT IN ('closed', 'open') THEN
    RAISE EXCEPTION 'Closed support tickets may only remain closed or be reopened to open'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'resolved' AND NEW.status NOT IN ('resolved', 'closed', 'open') THEN
    RAISE EXCEPTION 'Resolved support tickets may only remain resolved, close, or reopen to open'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'resolved' AND NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'Resolved support tickets require a resolution timestamp'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'closed' AND NEW.closed_at IS NULL THEN
    RAISE EXCEPTION 'Closed support tickets require a closure timestamp'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_terminal_integrity_guard ON support_tickets;
CREATE TRIGGER support_ticket_terminal_integrity_guard
  BEFORE UPDATE OF status, resolved_at, closed_at ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION enforce_support_ticket_terminal_integrity();
