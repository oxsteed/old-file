-- Migration 290: Learn product link overrides
-- Allows admin to manage affiliate / own-inventory links shown in the Learn tab
-- without shipping a new app version. The iOS app fetches GET /api/learn/product-links
-- and overlays these rows on top of the hardcoded catalog.
--
-- link_type values:
--   amazon_affiliate  — Amazon Associates link (FTC + Amazon disclosure required)
--   own_inventory     — OxSteed's own store (no disclosure; app shows "Shop OxSteed")
--   partner           — other affiliate program (disclosure required)
--   rental            — internal /tool-rentals path

CREATE TABLE IF NOT EXISTS learn_product_links (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = applies to every guide that has a tool matching tool_name (case-insensitive).
  -- Non-null = scoped to a single guide; takes priority over a global row.
  guide_id       TEXT,
  tool_name      TEXT         NOT NULL,
  link_type      TEXT         NOT NULL
                   CHECK (link_type IN ('amazon_affiliate','own_inventory','partner','rental')),
  buy_url        TEXT,
  rent_url       TEXT,
  -- Affiliate tag used for commission tracking / compliance audits (e.g. 'oxsteed-20').
  affiliate_tag  TEXT,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_by     UUID         REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lpl_tool_name
  ON learn_product_links (LOWER(tool_name));

CREATE INDEX IF NOT EXISTS idx_lpl_guide_id
  ON learn_product_links (guide_id)
  WHERE guide_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lpl_active
  ON learn_product_links (is_active)
  WHERE is_active = TRUE;

-- Auto-update updated_at on any row change.
CREATE OR REPLACE FUNCTION set_lpl_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lpl_updated_at ON learn_product_links;
CREATE TRIGGER trg_lpl_updated_at
  BEFORE UPDATE ON learn_product_links
  FOR EACH ROW EXECUTE FUNCTION set_lpl_updated_at();
