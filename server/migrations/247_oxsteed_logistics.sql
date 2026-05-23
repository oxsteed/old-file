-- ============================================================
-- Migration 247: OxSteed Logistics — Full branch schema
-- A complete logistics operating system inside OxSteed.
-- ============================================================

-- ─── ENUMS / DOMAINS ─────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE logistics_risk_tier AS ENUM ('low','managed','restricted','prohibited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE logistics_fulfillment_model AS ENUM (
    'direct','pooled','freight_forward','distributor','recurring','private_label'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE logistics_user_role AS ENUM (
    'individual_buyer','business_buyer','organizer','reseller','franchise_buyer',
    'sourcing_operator','logistics_coordinator','warehouse_operator',
    'compliance_reviewer','admin','super_admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sourcing_request_status AS ENUM (
    'draft','open','quoting','quoted','converting','direct_order',
    'pooled','procurement','private_label','cancelled','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE purchase_order_status AS ENUM (
    'draft','quoted','approved','awaiting_deposit','deposit_collected',
    'placed_with_supplier','in_production','production_complete',
    'ready_for_pickup','in_transit','customs_review','cleared',
    'warehoused','allocated','fulfilled','closed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status AS ENUM (
    'planned','booked','origin_received','consolidating','departed_origin',
    'transshipment','arrived_destination','customs_hold','customs_cleared',
    'delivered_to_warehouse','receiving','allocation_ready','distributed',
    'completed','exception'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pooled_order_status AS ENUM (
    'draft','open','pledging','deposit_phase','locked','placed',
    'in_transit','receiving','distributing','completed','cancelled','refunding'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE participant_status AS ENUM (
    'invited','pledged','deposit_paid','confirmed','locked',
    'final_paid','fulfilled','refunded','disputed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_receipt_status AS ENUM (
    'expected','receiving','reconciled','discrepancy','closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE delivery_order_status AS ENUM (
    'pending','assigned','in_transit','delivered','failed','cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE claim_status AS ENUM (
    'open','under_review','approved','rejected','resolved','escalated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE freight_option AS ENUM (
    'air','sea_fcl','sea_lcl','road','rail','multimodal','courier','express'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 1. LOGISTICS LANES ───────────────────────────────────────
-- The backbone: every product, order, shipment belongs to a lane.

CREATE TABLE IF NOT EXISTS logistics_lanes (
  id                      SERIAL PRIMARY KEY,
  code                    VARCHAR(80) UNIQUE NOT NULL,       -- e.g. 'cn_us_wholesale'
  name                    VARCHAR(200) NOT NULL,
  description             TEXT,
  origin_country          CHAR(2) NOT NULL,                  -- ISO 3166-1 alpha-2
  destination_country     CHAR(2) NOT NULL,
  allowed_buyer_countries CHAR(2)[] DEFAULT '{}',            -- empty = all
  allowed_buyer_roles     logistics_user_role[] DEFAULT '{}',-- empty = all
  restricted_categories   TEXT[] DEFAULT '{}',
  doc_requirements        JSONB DEFAULT '[]',                -- [{doc, required, notes}]
  freight_options         freight_option[] DEFAULT '{}',
  customs_complexity      SMALLINT DEFAULT 1 CHECK (customs_complexity BETWEEN 1 AND 5),
  risk_tier               logistics_risk_tier DEFAULT 'low',
  fulfillment_model       logistics_fulfillment_model DEFAULT 'direct',
  default_markup_pct      NUMERIC(6,4) DEFAULT 0.15,         -- 15%
  default_sourcing_fee_cents  INTEGER DEFAULT 0,
  default_freight_est_cents   INTEGER DEFAULT 0,
  default_customs_fee_cents   INTEGER DEFAULT 0,
  default_warehouse_fee_cents INTEGER DEFAULT 0,
  default_last_mile_cents     INTEGER DEFAULT 0,
  min_order_value_cents   INTEGER DEFAULT 0,
  max_order_value_cents   INTEGER,
  requires_business_verification BOOLEAN DEFAULT FALSE,
  requires_manual_approval BOOLEAN DEFAULT FALSE,
  requires_reseller_approval BOOLEAN DEFAULT FALSE,
  is_active               BOOLEAN DEFAULT TRUE,
  notes                   TEXT,
  created_by              UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logistics_lanes_origin     ON logistics_lanes(origin_country);
CREATE INDEX IF NOT EXISTS idx_logistics_lanes_dest       ON logistics_lanes(destination_country);
CREATE INDEX IF NOT EXISTS idx_logistics_lanes_active     ON logistics_lanes(is_active);
CREATE INDEX IF NOT EXISTS idx_logistics_lanes_risk       ON logistics_lanes(risk_tier);

-- Seed core lanes
INSERT INTO logistics_lanes
  (code, name, origin_country, destination_country, freight_options, customs_complexity, risk_tier, default_markup_pct, requires_business_verification)
VALUES
  ('cn_us_wholesale',         'China → US Wholesale',              'CN','US', ARRAY['sea_fcl','sea_lcl','air']::freight_option[], 3, 'managed',    0.20, true),
  ('cn_ht_pooled',            'China → Haiti Pooled Import',       'CN','HT', ARRAY['sea_lcl','sea_fcl']::freight_option[],       4, 'managed',    0.25, false),
  ('us_ht_diaspora',          'US → Haiti Diaspora Distribution',  'US','HT', ARRAY['air','courier','sea_lcl']::freight_option[],  3, 'managed',    0.18, false),
  ('us_domestic_wholesale',   'US Domestic Pooled Wholesale',      'US','US', ARRAY['road','courier']::freight_option[],           1, 'low',        0.12, false),
  ('cn_ca_business',          'China → Canada Business',           'CN','CA', ARRAY['sea_fcl','sea_lcl']::freight_option[],        3, 'managed',    0.20, true),
  ('us_mx_wholesale',         'US → Mexico Wholesale',             'US','MX', ARRAY['road','sea_lcl']::freight_option[],           2, 'managed',    0.15, true),
  ('cn_uk_wholesale',         'China → UK Wholesale',              'CN','GB', ARRAY['sea_fcl','sea_lcl','air']::freight_option[],  3, 'managed',    0.20, true),
  ('us_caribbean_distribution','US → Caribbean Distribution',      'US','*',  ARRAY['sea_lcl','air','courier']::freight_option[],  3, 'managed',    0.18, false)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. TRADE RULES ───────────────────────────────────────────
-- Country-level and category-level restrictions that feed compliance.

CREATE TABLE IF NOT EXISTS trade_rules (
  id              SERIAL PRIMARY KEY,
  lane_id         INTEGER REFERENCES logistics_lanes(id),
  rule_type       VARCHAR(40) NOT NULL, -- 'import_restriction','category_ban','country_ban','doc_required','business_only','diaspora_only','manual_review'
  country_code    CHAR(2),              -- NULL = global
  category        VARCHAR(120),
  description     TEXT,
  severity        logistics_risk_tier DEFAULT 'managed',
  doc_required    TEXT,
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_rules_lane     ON trade_rules(lane_id);
CREATE INDEX IF NOT EXISTS idx_trade_rules_country  ON trade_rules(country_code);
CREATE INDEX IF NOT EXISTS idx_trade_rules_category ON trade_rules(category);

-- ─── 3. COUNTRY ACCESS RULES ──────────────────────────────────
-- Per-product-category per-country visibility and purchase rules.

CREATE TABLE IF NOT EXISTS country_access_rules (
  id                  SERIAL PRIMARY KEY,
  category            VARCHAR(120) NOT NULL,
  country_code        CHAR(2) NOT NULL,
  is_visible          BOOLEAN DEFAULT TRUE,
  is_purchasable      BOOLEAN DEFAULT TRUE,
  allowed_buyer_types logistics_user_role[] DEFAULT '{}',
  requires_approval   BOOLEAN DEFAULT FALSE,
  risk_tier           logistics_risk_tier DEFAULT 'low',
  notes               TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, country_code)
);

-- ─── 4. SUPPLIER PROFILES ────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_profiles (
  id                    SERIAL PRIMARY KEY,
  code                  VARCHAR(80) UNIQUE NOT NULL,
  company_name          VARCHAR(200) NOT NULL,
  legal_name            VARCHAR(200),
  country               CHAR(2) NOT NULL,
  city                  VARCHAR(100),
  address               TEXT,
  website               VARCHAR(300),
  contact_name          VARCHAR(120),
  contact_email         VARCHAR(200),
  contact_phone         VARCHAR(40),
  approved_categories   TEXT[] DEFAULT '{}',
  moq_profile           JSONB DEFAULT '{}',  -- {category: moq_units}
  lead_time_profile     JSONB DEFAULT '{}',  -- {category: days}
  freight_terms         TEXT[],              -- ['EXW','FOB','CIF',...]
  quality_score         NUMERIC(3,2) DEFAULT 0 CHECK (quality_score BETWEEN 0 AND 5),
  communication_score   NUMERIC(3,2) DEFAULT 0 CHECK (communication_score BETWEEN 0 AND 5),
  on_time_rate          NUMERIC(5,4) DEFAULT 0 CHECK (on_time_rate BETWEEN 0 AND 1),
  dispute_count         INTEGER DEFAULT 0,
  dispute_notes         TEXT,
  compliance_notes      TEXT,
  internal_trust_rating SMALLINT DEFAULT 3 CHECK (internal_trust_rating BETWEEN 1 AND 5),
  payment_terms         VARCHAR(100),
  bank_details_on_file  BOOLEAN DEFAULT FALSE,
  kyb_verified          BOOLEAN DEFAULT FALSE,
  kyb_verified_at       TIMESTAMPTZ,
  kyb_doc_urls          TEXT[] DEFAULT '{}',
  is_active             BOOLEAN DEFAULT TRUE,
  approved_by           UUID REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  notes                 TEXT,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_profiles_country  ON supplier_profiles(country);
CREATE INDEX IF NOT EXISTS idx_supplier_profiles_active   ON supplier_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_supplier_profiles_trust    ON supplier_profiles(internal_trust_rating);

-- ─── 5. SUPPLIER PRODUCTS ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_products (
  id                      SERIAL PRIMARY KEY,
  supplier_id             INTEGER NOT NULL REFERENCES supplier_profiles(id),
  internal_sku            VARCHAR(100) UNIQUE NOT NULL,
  supplier_sku            VARCHAR(100),
  title                   VARCHAR(300) NOT NULL,
  category                VARCHAR(120) NOT NULL,
  subcategory             VARCHAR(120),
  description             TEXT,
  specs                   JSONB DEFAULT '{}',       -- {material, dimensions, weight_kg, ...}
  unit_of_measure         VARCHAR(40) DEFAULT 'unit',
  units_per_carton        INTEGER DEFAULT 1,
  cartons_per_pallet      INTEGER,
  pallets_per_container   INTEGER,
  container_type          VARCHAR(20),              -- '20ft','40ft','40hc'
  estimated_weight_kg     NUMERIC(10,3),
  freight_class           VARCHAR(20),
  moq                     INTEGER DEFAULT 1,
  moq_unit                VARCHAR(40) DEFAULT 'unit',
  estimated_production_days INTEGER DEFAULT 0,
  price_tiers             JSONB DEFAULT '[]',       -- [{min_qty, unit_price_usd}]
  sample_price_usd        NUMERIC(12,2),
  private_label_available BOOLEAN DEFAULT FALSE,
  custom_manufacturing    BOOLEAN DEFAULT FALSE,
  restricted_markets      CHAR(2)[] DEFAULT '{}',  -- country codes where banned
  compliance_flags        TEXT[] DEFAULT '{}',      -- ['fda_required','ce_required',...]
  image_urls              TEXT[] DEFAULT '{}',
  sample_urls             TEXT[] DEFAULT '{}',
  is_active               BOOLEAN DEFAULT TRUE,
  is_approved             BOOLEAN DEFAULT FALSE,
  approved_by             UUID REFERENCES users(id),
  approved_at             TIMESTAMPTZ,
  created_by              UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier  ON supplier_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_category  ON supplier_products(category);
CREATE INDEX IF NOT EXISTS idx_supplier_products_active    ON supplier_products(is_active, is_approved);
CREATE INDEX IF NOT EXISTS idx_supplier_products_sku       ON supplier_products(internal_sku);

-- ─── 6. SOURCING REQUESTS ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS sourcing_requests (
  id              SERIAL PRIMARY KEY,
  reference       VARCHAR(40) UNIQUE NOT NULL,  -- SR-2026-00001
  user_id         UUID NOT NULL REFERENCES users(id),
  business_id     INTEGER REFERENCES businesses(id),
  lane_id         INTEGER REFERENCES logistics_lanes(id),
  title           VARCHAR(300) NOT NULL,
  category        VARCHAR(120),
  description     TEXT,
  specs           JSONB DEFAULT '{}',
  target_qty      INTEGER,
  target_unit     VARCHAR(40) DEFAULT 'unit',
  target_price_usd NUMERIC(12,2),
  budget_max_usd  NUMERIC(12,2),
  destination_country CHAR(2),
  destination_city    VARCHAR(100),
  preferred_freight   freight_option,
  private_label   BOOLEAN DEFAULT FALSE,
  custom_mfg      BOOLEAN DEFAULT FALSE,
  deadline        DATE,
  status          sourcing_request_status DEFAULT 'draft',
  assigned_operator UUID REFERENCES users(id),
  converted_to    VARCHAR(20),  -- 'direct_order','pooled_order','procurement'
  converted_ref   VARCHAR(40),  -- reference of the converted entity
  notes           TEXT,
  internal_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_requests_user     ON sourcing_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_sourcing_requests_status   ON sourcing_requests(status);
CREATE INDEX IF NOT EXISTS idx_sourcing_requests_lane     ON sourcing_requests(lane_id);
CREATE INDEX IF NOT EXISTS idx_sourcing_requests_ref      ON sourcing_requests(reference);

-- Reference sequence
CREATE SEQUENCE IF NOT EXISTS sourcing_request_seq START 1;

-- ─── 7. SUPPLIER QUOTES ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier_quotes (
  id                  SERIAL PRIMARY KEY,
  reference           VARCHAR(40) UNIQUE NOT NULL,
  sourcing_request_id INTEGER REFERENCES sourcing_requests(id),
  supplier_id         INTEGER NOT NULL REFERENCES supplier_profiles(id),
  supplier_product_id INTEGER REFERENCES supplier_products(id),
  lane_id             INTEGER REFERENCES logistics_lanes(id),
  qty_quoted          INTEGER NOT NULL,
  unit_price_usd      NUMERIC(12,4) NOT NULL,
  total_product_usd   NUMERIC(14,2),
  freight_est_usd     NUMERIC(12,2),
  lead_time_days      INTEGER,
  valid_until         DATE,
  payment_terms       VARCHAR(100),
  freight_terms       VARCHAR(40),
  sample_available    BOOLEAN DEFAULT FALSE,
  sample_price_usd    NUMERIC(10,2),
  notes               TEXT,
  doc_urls            TEXT[] DEFAULT '{}',
  status              VARCHAR(30) DEFAULT 'submitted', -- submitted,under_review,accepted,rejected,expired
  reviewed_by         UUID REFERENCES users(id),
  reviewed_at         TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_request   ON supplier_quotes(sourcing_request_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier  ON supplier_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_status    ON supplier_quotes(status);

-- ─── 8. MARKUP RULES ──────────────────────────────────────────
-- Stackable, layered markup engine.

CREATE TABLE IF NOT EXISTS markup_rules (
  id              SERIAL PRIMARY KEY,
  scope           VARCHAR(30) NOT NULL, -- 'global','lane','category','supplier','campaign','admin_override','super_override'
  scope_id        INTEGER,              -- references lane_id / supplier_id / campaign id etc.
  category        VARCHAR(120),
  markup_pct      NUMERIC(6,4),
  markup_fixed_cents INTEGER,
  priority        SMALLINT DEFAULT 0,   -- higher = applied later (overrides lower)
  description     TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markup_rules_scope ON markup_rules(scope, scope_id);

-- ─── 9. FEE RULES ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fee_rules (
  id              SERIAL PRIMARY KEY,
  fee_type        VARCHAR(60) NOT NULL, -- 'origin_handling','sourcing','oxsteed_markup','freight_est','customs_admin','warehouse','split_fulfillment','last_mile','risk_surcharge'
  scope           VARCHAR(30) NOT NULL,
  scope_id        INTEGER,
  lane_id         INTEGER REFERENCES logistics_lanes(id),
  category        VARCHAR(120),
  amount_cents    INTEGER DEFAULT 0,
  pct_of_product  NUMERIC(6,4) DEFAULT 0,
  min_cents       INTEGER DEFAULT 0,
  max_cents       INTEGER,
  priority        SMALLINT DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_type  ON fee_rules(fee_type);
CREATE INDEX IF NOT EXISTS idx_fee_rules_scope ON fee_rules(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_fee_rules_lane  ON fee_rules(lane_id);

-- Seed global default fees
INSERT INTO fee_rules (fee_type, scope, pct_of_product, priority, is_active)
VALUES
  ('origin_handling',   'global', 0.005, 0, true),
  ('sourcing',          'global', 0.025, 0, true),
  ('oxsteed_markup',    'global', 0.150, 0, true),
  ('customs_admin',     'global', 0.010, 0, true),
  ('warehouse',         'global', 0.008, 0, true),
  ('risk_surcharge',    'global', 0.000, 0, true)
ON CONFLICT DO NOTHING;

-- ─── 10. POOLED ORDERS ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pooled_orders (
  id                        SERIAL PRIMARY KEY,
  reference                 VARCHAR(40) UNIQUE NOT NULL,
  title                     VARCHAR(300) NOT NULL,
  description               TEXT,
  lane_id                   INTEGER NOT NULL REFERENCES logistics_lanes(id),
  supplier_product_id       INTEGER REFERENCES supplier_products(id),
  supplier_quote_id         INTEGER REFERENCES supplier_quotes(id),
  organizer_user_id         UUID NOT NULL REFERENCES users(id),
  organizer_business_id     INTEGER REFERENCES businesses(id),
  status                    pooled_order_status DEFAULT 'draft',
  target_moq                INTEGER NOT NULL,
  current_committed_qty     INTEGER DEFAULT 0,
  unit_product_cost_usd     NUMERIC(12,4),
  unit_freight_est_usd      NUMERIC(10,4),
  unit_markup_usd           NUMERIC(10,4),
  unit_fees_usd             NUMERIC(10,4),
  unit_landed_cost_usd      NUMERIC(12,4),  -- buyer pays this
  deposit_pct               NUMERIC(5,4) DEFAULT 0.30,
  final_payment_pct         NUMERIC(5,4) DEFAULT 0.70,
  open_date                 TIMESTAMPTZ DEFAULT NOW(),
  close_date                TIMESTAMPTZ,
  lock_date                 TIMESTAMPTZ,
  expected_ship_date        DATE,
  expected_arrival_date     DATE,
  cancellation_policy       TEXT,
  product_spec_version      VARCHAR(40),
  max_participants          INTEGER,
  destination_warehouse_id  INTEGER,  -- FK added after warehouses table
  notes                     TEXT,
  internal_notes            TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pooled_orders_lane       ON pooled_orders(lane_id);
CREATE INDEX IF NOT EXISTS idx_pooled_orders_organizer  ON pooled_orders(organizer_user_id);
CREATE INDEX IF NOT EXISTS idx_pooled_orders_status     ON pooled_orders(status);
CREATE INDEX IF NOT EXISTS idx_pooled_orders_ref        ON pooled_orders(reference);

-- ─── 11. POOLED ORDER PARTICIPANTS ────────────────────────────

CREATE TABLE IF NOT EXISTS pooled_order_participants (
  id                  SERIAL PRIMARY KEY,
  pooled_order_id     INTEGER NOT NULL REFERENCES pooled_orders(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  business_id         INTEGER REFERENCES businesses(id),
  status              participant_status DEFAULT 'invited',
  committed_qty       INTEGER DEFAULT 0,
  unit_price_usd      NUMERIC(12,4),
  subtotal_usd        NUMERIC(14,2),
  deposit_amount_usd  NUMERIC(12,2),
  deposit_paid_at     TIMESTAMPTZ,
  final_payment_usd   NUMERIC(12,2),
  final_paid_at       TIMESTAMPTZ,
  destination_country CHAR(2),
  destination_address TEXT,
  delivery_preference VARCHAR(40) DEFAULT 'warehouse_pickup', -- warehouse_pickup, ship_to_buyer, freight_forward
  notes               TEXT,
  invited_at          TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at        TIMESTAMPTZ,
  fulfilled_at        TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pooled_order_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pop_order   ON pooled_order_participants(pooled_order_id);
CREATE INDEX IF NOT EXISTS idx_pop_user    ON pooled_order_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_pop_status  ON pooled_order_participants(status);

-- ─── 12. PURCHASE ORDERS ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                    SERIAL PRIMARY KEY,
  reference             VARCHAR(40) UNIQUE NOT NULL,
  sourcing_request_id   INTEGER REFERENCES sourcing_requests(id),
  pooled_order_id       INTEGER REFERENCES pooled_orders(id),
  supplier_id           INTEGER NOT NULL REFERENCES supplier_profiles(id),
  supplier_product_id   INTEGER REFERENCES supplier_products(id),
  supplier_quote_id     INTEGER REFERENCES supplier_quotes(id),
  lane_id               INTEGER NOT NULL REFERENCES logistics_lanes(id),
  buyer_user_id         UUID REFERENCES users(id),
  buyer_business_id     INTEGER REFERENCES businesses(id),
  status                purchase_order_status DEFAULT 'draft',
  qty_ordered           INTEGER NOT NULL,
  unit_cost_usd         NUMERIC(12,4) NOT NULL,
  total_product_usd     NUMERIC(14,2),
  origin_handling_usd   NUMERIC(10,2) DEFAULT 0,
  sourcing_fee_usd      NUMERIC(10,2) DEFAULT 0,
  oxsteed_markup_usd    NUMERIC(10,2) DEFAULT 0,
  freight_est_usd       NUMERIC(10,2) DEFAULT 0,
  customs_admin_usd     NUMERIC(10,2) DEFAULT 0,
  warehouse_fee_usd     NUMERIC(10,2) DEFAULT 0,
  last_mile_usd         NUMERIC(10,2) DEFAULT 0,
  risk_surcharge_usd    NUMERIC(10,2) DEFAULT 0,
  total_landed_usd      NUMERIC(14,2),
  deposit_due_usd       NUMERIC(12,2),
  deposit_paid_usd      NUMERIC(12,2) DEFAULT 0,
  deposit_paid_at       TIMESTAMPTZ,
  final_due_usd         NUMERIC(12,2),
  final_paid_usd        NUMERIC(12,2) DEFAULT 0,
  final_paid_at         TIMESTAMPTZ,
  currency              CHAR(3) DEFAULT 'USD',
  freight_option        freight_option,
  incoterms             VARCHAR(10),
  payment_terms         VARCHAR(100),
  production_notes      TEXT,
  shipping_notes        TEXT,
  expected_production_complete DATE,
  expected_ship_date    DATE,
  expected_arrival_date DATE,
  destination_country   CHAR(2),
  destination_address   TEXT,
  assigned_coordinator  UUID REFERENCES users(id),
  approved_by           UUID REFERENCES users(id),
  approved_at           TIMESTAMPTZ,
  placed_with_supplier_at TIMESTAMPTZ,
  notes                 TEXT,
  internal_notes        TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_status      ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier    ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_lane        ON purchase_orders(lane_id);
CREATE INDEX IF NOT EXISTS idx_po_buyer       ON purchase_orders(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_po_pooled      ON purchase_orders(pooled_order_id);
CREATE INDEX IF NOT EXISTS idx_po_reference   ON purchase_orders(reference);

-- ─── 13. SHIPMENT RECORDS ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS shipment_records (
  id                      SERIAL PRIMARY KEY,
  reference               VARCHAR(40) UNIQUE NOT NULL,
  purchase_order_id       INTEGER REFERENCES purchase_orders(id),
  pooled_order_id         INTEGER REFERENCES pooled_orders(id),
  lane_id                 INTEGER NOT NULL REFERENCES logistics_lanes(id),
  status                  shipment_status DEFAULT 'planned',
  freight_option          freight_option NOT NULL,
  carrier                 VARCHAR(120),
  carrier_booking_ref     VARCHAR(100),
  tracking_number         VARCHAR(150),
  container_number        VARCHAR(60),
  vessel_name             VARCHAR(120),
  voyage_number           VARCHAR(60),
  bl_number               VARCHAR(80),     -- Bill of Lading
  awb_number              VARCHAR(80),     -- Air Waybill
  origin_port             VARCHAR(100),
  destination_port        VARCHAR(100),
  origin_country          CHAR(2),
  destination_country     CHAR(2),
  total_cartons           INTEGER,
  total_weight_kg         NUMERIC(10,3),
  total_cbm               NUMERIC(10,4),   -- cubic meters
  estimated_value_usd     NUMERIC(14,2),
  freight_cost_usd        NUMERIC(12,2),
  customs_duty_usd        NUMERIC(12,2),
  insurance_usd           NUMERIC(10,2),
  booked_at               TIMESTAMPTZ,
  departed_at             TIMESTAMPTZ,
  arrived_at              TIMESTAMPTZ,
  customs_filed_at        TIMESTAMPTZ,
  customs_cleared_at      TIMESTAMPTZ,
  delivered_to_wh_at      TIMESTAMPTZ,
  eta                     TIMESTAMPTZ,
  exception_reason        TEXT,
  assigned_coordinator    UUID REFERENCES users(id),
  notes                   TEXT,
  internal_notes          TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_status   ON shipment_records(status);
CREATE INDEX IF NOT EXISTS idx_shipments_lane     ON shipment_records(lane_id);
CREATE INDEX IF NOT EXISTS idx_shipments_po       ON shipment_records(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipment_records(tracking_number);

-- ─── 14. SHIPMENT MILESTONES ──────────────────────────────────

CREATE TABLE IF NOT EXISTS shipment_milestones (
  id              SERIAL PRIMARY KEY,
  shipment_id     INTEGER NOT NULL REFERENCES shipment_records(id),
  milestone       shipment_status NOT NULL,
  occurred_at     TIMESTAMPTZ DEFAULT NOW(),
  location        VARCHAR(200),
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_milestones_shipment ON shipment_milestones(shipment_id);

-- ─── 15. SHIPMENT DOCUMENTS ───────────────────────────────────

CREATE TABLE IF NOT EXISTS shipment_documents (
  id              SERIAL PRIMARY KEY,
  shipment_id     INTEGER NOT NULL REFERENCES shipment_records(id),
  purchase_order_id INTEGER REFERENCES purchase_orders(id),
  doc_type        VARCHAR(60) NOT NULL, -- 'bl','awb','commercial_invoice','packing_list','certificate_of_origin','phytosanitary','customs_entry','inspection_report','insurance_cert','other'
  file_url        TEXT NOT NULL,
  filename        VARCHAR(300),
  notes           TEXT,
  uploaded_by     UUID REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_docs_shipment ON shipment_documents(shipment_id);

-- ─── 16. WAREHOUSES ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS warehouses (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(40) UNIQUE NOT NULL,
  name            VARCHAR(200) NOT NULL,
  country         CHAR(2) NOT NULL,
  city            VARCHAR(100),
  address         TEXT,
  contact_name    VARCHAR(120),
  contact_email   VARCHAR(200),
  contact_phone   VARCHAR(40),
  total_sqft      NUMERIC(10,2),
  available_sqft  NUMERIC(10,2),
  is_bonded       BOOLEAN DEFAULT FALSE,  -- bonded warehouse for customs
  is_cold_storage BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouses_country ON warehouses(country);
CREATE INDEX IF NOT EXISTS idx_warehouses_active  ON warehouses(is_active);

-- Now wire destination_warehouse_id FK on pooled_orders
ALTER TABLE pooled_orders
  ADD COLUMN IF NOT EXISTS destination_warehouse_id INTEGER REFERENCES warehouses(id);

-- ─── 17. INVENTORY RECEIPTS ───────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_receipts (
  id                    SERIAL PRIMARY KEY,
  reference             VARCHAR(40) UNIQUE NOT NULL,
  shipment_id           INTEGER REFERENCES shipment_records(id),
  purchase_order_id     INTEGER REFERENCES purchase_orders(id),
  pooled_order_id       INTEGER REFERENCES pooled_orders(id),
  warehouse_id          INTEGER NOT NULL REFERENCES warehouses(id),
  status                inventory_receipt_status DEFAULT 'expected',
  expected_qty          INTEGER,
  received_qty          INTEGER DEFAULT 0,
  shortage_qty          INTEGER DEFAULT 0,
  damaged_qty           INTEGER DEFAULT 0,
  storage_location      VARCHAR(100),
  received_by           UUID REFERENCES users(id),
  received_at           TIMESTAMPTZ,
  reconciled_at         TIMESTAMPTZ,
  discrepancy_notes     TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_receipts_warehouse ON inventory_receipts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_receipts_po        ON inventory_receipts(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_inv_receipts_status    ON inventory_receipts(status);

-- ─── 18. INVENTORY ALLOCATIONS ────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_allocations (
  id                    SERIAL PRIMARY KEY,
  inventory_receipt_id  INTEGER NOT NULL REFERENCES inventory_receipts(id),
  pooled_order_id       INTEGER REFERENCES pooled_orders(id),
  participant_id        INTEGER REFERENCES pooled_order_participants(id),
  buyer_user_id         UUID REFERENCES users(id),
  buyer_business_id     INTEGER REFERENCES businesses(id),
  allocated_qty         INTEGER NOT NULL,
  status                VARCHAR(30) DEFAULT 'pending', -- pending, ready, released, delivered, disputed
  release_method        VARCHAR(40) DEFAULT 'warehouse_pickup', -- warehouse_pickup, ship_to_buyer, freight_forward, distributor_handoff
  released_by           UUID REFERENCES users(id),
  released_at           TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_alloc_receipt  ON inventory_allocations(inventory_receipt_id);
CREATE INDEX IF NOT EXISTS idx_inv_alloc_pooled   ON inventory_allocations(pooled_order_id);
CREATE INDEX IF NOT EXISTS idx_inv_alloc_buyer    ON inventory_allocations(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_inv_alloc_status   ON inventory_allocations(status);

-- ─── 19. DELIVERY ORDERS ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS delivery_orders (
  id                    SERIAL PRIMARY KEY,
  reference             VARCHAR(40) UNIQUE NOT NULL,
  allocation_id         INTEGER REFERENCES inventory_allocations(id),
  shipment_id           INTEGER REFERENCES shipment_records(id),
  recipient_user_id     UUID REFERENCES users(id),
  recipient_business_id INTEGER REFERENCES businesses(id),
  recipient_name        VARCHAR(200),
  recipient_phone       VARCHAR(40),
  delivery_address      TEXT,
  delivery_country      CHAR(2),
  delivery_city         VARCHAR(100),
  status                delivery_order_status DEFAULT 'pending',
  method                VARCHAR(40), -- local_pickup, ship_to_buyer, freight_forward, distributor, bulk_handoff, restock_route
  carrier               VARCHAR(120),
  tracking_number       VARCHAR(150),
  scheduled_date        DATE,
  delivered_at          TIMESTAMPTZ,
  delivery_notes        TEXT,
  proof_of_delivery_url TEXT,
  assigned_to           UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_status    ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_recipient ON delivery_orders(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_alloc     ON delivery_orders(allocation_id);

-- ─── 20. CLAIMS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS logistics_claims (
  id                  SERIAL PRIMARY KEY,
  reference           VARCHAR(40) UNIQUE NOT NULL,
  claim_type          VARCHAR(40) NOT NULL, -- 'shortage','damage','delay','wrong_item','customs_rejection','fraud','other'
  purchase_order_id   INTEGER REFERENCES purchase_orders(id),
  shipment_id         INTEGER REFERENCES shipment_records(id),
  pooled_order_id     INTEGER REFERENCES pooled_orders(id),
  participant_id      INTEGER REFERENCES pooled_order_participants(id),
  claimant_user_id    UUID NOT NULL REFERENCES users(id),
  status              claim_status DEFAULT 'open',
  description         TEXT NOT NULL,
  claimed_amount_usd  NUMERIC(12,2),
  approved_amount_usd NUMERIC(12,2),
  evidence_urls       TEXT[] DEFAULT '{}',
  resolution_notes    TEXT,
  assigned_to         UUID REFERENCES users(id),
  resolved_by         UUID REFERENCES users(id),
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_status   ON logistics_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_claimant ON logistics_claims(claimant_user_id);
CREATE INDEX IF NOT EXISTS idx_claims_po       ON logistics_claims(purchase_order_id);

-- ─── 21. REFUND CASES ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS logistics_refund_cases (
  id                  SERIAL PRIMARY KEY,
  reference           VARCHAR(40) UNIQUE NOT NULL,
  claim_id            INTEGER REFERENCES logistics_claims(id),
  purchase_order_id   INTEGER REFERENCES purchase_orders(id),
  pooled_order_id     INTEGER REFERENCES pooled_orders(id),
  participant_id      INTEGER REFERENCES pooled_order_participants(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  refund_reason       VARCHAR(200) NOT NULL,
  requested_amount_usd NUMERIC(12,2) NOT NULL,
  approved_amount_usd NUMERIC(12,2),
  status              VARCHAR(30) DEFAULT 'pending', -- pending, reviewing, approved, processed, rejected
  stripe_refund_id    VARCHAR(100),
  processed_by        UUID REFERENCES users(id),
  processed_at        TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_cases_status ON logistics_refund_cases(status);
CREATE INDEX IF NOT EXISTS idx_refund_cases_user   ON logistics_refund_cases(user_id);

-- ─── 22. LOGISTICS AUDIT LOG ──────────────────────────────────

CREATE TABLE IF NOT EXISTS logistics_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  entity_type     VARCHAR(60) NOT NULL,   -- 'purchase_order','shipment','pooled_order', etc.
  entity_id       INTEGER NOT NULL,
  action          VARCHAR(80) NOT NULL,
  actor_user_id   UUID REFERENCES users(id),
  before_state    JSONB,
  after_state     JSONB,
  notes           TEXT,
  ip_address      INET,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logistics_audit_entity ON logistics_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_logistics_audit_actor  ON logistics_audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_logistics_audit_ts     ON logistics_audit_log(created_at DESC);

-- ─── UPDATED_AT TRIGGERS ──────────────────────────────────────

CREATE OR REPLACE FUNCTION logistics_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'logistics_lanes','supplier_profiles','supplier_products',
    'sourcing_requests','supplier_quotes','markup_rules','fee_rules',
    'pooled_orders','pooled_order_participants','purchase_orders',
    'shipment_records','warehouses','inventory_receipts',
    'inventory_allocations','delivery_orders','logistics_claims',
    'logistics_refund_cases','country_access_rules'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I;
       CREATE TRIGGER %I BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION logistics_touch_updated_at();',
      tbl || '_updated_at', tbl, tbl || '_updated_at', tbl
    );
  END LOOP;
END $$;
