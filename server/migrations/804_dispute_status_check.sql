-- P3-2-F17: disputes.status was unconstrained. Migration 015's comment
-- lists open, under_review, resolved_poster, resolved_helper, escalated,
-- closed, but the code only ever writes 'open', 'under_review' and
-- 'resolved', and reads 'in_progress' as a live state. The resolution-flavored
-- values (resolved_poster, resolved_helper, escalated) belong to
-- resolution_type, not status. Constrain status to the live vocabulary so a
-- typo can never park a dispute in an unread state.
--
-- Fail closed on unexpected legacy data: the constraint is added only when
-- no row violates it, so a deploy never breaks on historical rows. Any
-- skipped constraint is reported via NOTICE for an operator to reconcile.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM disputes
    WHERE status NOT IN ('open', 'under_review', 'in_progress', 'resolved', 'closed')
  ) THEN
    RAISE NOTICE 'P3-2-F17: skipping disputes_status_check; unexpected statuses present in disputes';
  ELSE
    ALTER TABLE disputes
      ADD CONSTRAINT disputes_status_check
      CHECK (status IN ('open', 'under_review', 'in_progress', 'resolved', 'closed'));
  END IF;
END
$$;
