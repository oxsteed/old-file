-- Policy-notice wakeup (cost audit 2026-11-13 item 11): notify listeners
-- when a campaign starts sending, so the policy-notice delivery poller
-- can wake on the transition instead of polling every 30s. The 60s
-- interval remains as a slow safety sweep.
--
-- pg_notify is transactional: the notification is delivered only when the
-- transition commits, so a listener never wakes for a start that was
-- rolled back. The drain itself stays fenced and idempotent, so a
-- duplicate wakeup is harmless. Reuses oxsteed_outbox_notify from
-- migration 20261104125317; campaigns are created as 'scheduled' and the
-- only transition to 'sending' is the admin start endpoint, so the
-- trigger fires on the status change that creates pending work.
DROP TRIGGER IF EXISTS policy_notice_campaigns_notify ON policy_notice_campaigns;
CREATE TRIGGER policy_notice_campaigns_notify AFTER UPDATE OF status ON policy_notice_campaigns
  FOR EACH ROW WHEN (NEW.status = 'sending') EXECUTE FUNCTION oxsteed_outbox_notify('oxsteed_policy_notice');
