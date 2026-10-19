ALTER TABLE campaign_analytics_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_analytics_events_dedupe_key
  ON campaign_analytics_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_analytics_click_attribution
  ON campaign_analytics_events(campaign_id,actor_key,occurred_at) WHERE event_type='click';
