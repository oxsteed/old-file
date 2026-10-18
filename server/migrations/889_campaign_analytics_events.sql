-- Campaign analytics events (analytics platform, Phase 2, Item 10).
-- Lightweight, append-only event log for campaign funnels:
--   impression  — a featured placement rendered in a discovery/search response
--   click       — a visitor clicked the featured card (client beacon)
--   conversion  — an order was placed at the featured restaurant while the
--                 placement was live (campaign-window attribution, not proven
--                 click-through causality)
-- Campaigns are business_featured_placement_requests rows (one per business);
-- campaign_id is the request id. Additive only: no existing tables touched.
CREATE TABLE IF NOT EXISTS campaign_analytics_events (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL,
  campaign_type TEXT NOT NULL DEFAULT 'featured_placement',
  event_type TEXT NOT NULL
    CHECK (event_type IN ('impression', 'click', 'conversion')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cae_campaign_event
  ON campaign_analytics_events (campaign_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cae_occurred
  ON campaign_analytics_events (occurred_at DESC);
