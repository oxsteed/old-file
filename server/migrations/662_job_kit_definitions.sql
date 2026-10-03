-- 662: Curated job-kit definitions for the helper parts-list copilot (template layer).
--
-- Kits reference catalog products by SKU. SKUs are resolved to live product
-- IDs and current database prices at build time by server/services/jobKitService.js.
-- A SKU that is missing or inactive in marketplace_products is omitted from the
-- draft cart and reported back; prices are never invented.
--
-- Also seeds a starter set of internal catalog products (source = 'internal')
-- so the curated kits resolve out of the box. Seed list prices are realistic
-- US retail; the business should review them (admin kit management is a later
-- follow-up).

CREATE TABLE IF NOT EXISTS job_kit_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type VARCHAR(100) NOT NULL,
  sku VARCHAR(50) NOT NULL,
  quantity SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes TEXT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_kit_definitions_job_type
  ON job_kit_definitions (job_type, sort_order)
  WHERE is_active = TRUE;

-- Starter internal catalog products used by the curated kits.
INSERT INTO marketplace_products (source, name, category, sku, price_cents, currency, is_active, is_available)
SELECT v.source, v.name, v.category, v.sku, v.price_cents, v.currency, TRUE, TRUE
FROM (VALUES
  ('internal', '2-Piece Toilet, White', 'plumbing', 'PLB-TOILET-2PC', 18999, 'USD'),
  ('internal', 'Toilet Wax Ring Kit with Bolts', 'plumbing', 'PLB-WAXRING', 749, 'USD'),
  ('internal', 'Braided Stainless Toilet Supply Line, 20 in', 'plumbing', 'PLB-SUPPLY-20', 999, 'USD'),
  ('internal', 'Closet Bolt Set', 'plumbing', 'PLB-BOLTS', 429, 'USD'),
  ('internal', 'PTFE Thread Seal Tape', 'plumbing', 'PLB-TAPE', 249, 'USD'),
  ('internal', 'Universal Faucet Repair Kit', 'plumbing', 'PLB-FAUCET-KIT', 1299, 'USD'),
  ('internal', 'Basin Wrench', 'plumbing', 'PLB-BASIN-WRENCH', 1899, 'USD'),
  ('internal', 'Silicone Plumber''s Grease', 'plumbing', 'PLB-GREASE', 549, 'USD'),
  ('internal', 'Braided Faucet Supply Lines, Pair', 'plumbing', 'PLB-SUPPLY-PAIR', 1499, 'USD'),
  ('internal', '1/2 HP Garbage Disposal', 'plumbing', 'PLB-DISPOSAL-12', 9999, 'USD'),
  ('internal', 'Disposal Installation Kit', 'plumbing', 'PLB-DISP-KIT', 1699, 'USD'),
  ('internal', 'Plumber''s Putty, 9 oz', 'plumbing', 'PLB-PUTTY', 629, 'USD'),
  ('internal', 'Dishwasher Connector Kit', 'plumbing', 'PLB-DISH-CONN', 1199, 'USD'),
  ('internal', '52 in Ceiling Fan with Light', 'electrical', 'ELE-FAN-52', 12999, 'USD'),
  ('internal', 'Fan-Rated Ceiling Box', 'electrical', 'ELE-FAN-BOX', 1499, 'USD'),
  ('internal', 'Wire Connector Assortment, 100 pc', 'electrical', 'ELE-WIRE-NUTS', 699, 'USD'),
  ('internal', 'Non-Contact Voltage Tester', 'electrical', 'ELE-VOLT-TEST', 1999, 'USD'),
  ('internal', 'Single-Cylinder Deadbolt, Satin Nickel', 'hardware', 'HDW-DEADBOLT', 3499, 'USD'),
  ('internal', 'Passage Door Knob Set', 'hardware', 'HDW-KNOB', 2499, 'USD'),
  ('internal', 'Strike Plate Reinforcement Kit', 'hardware', 'HDW-STRIKE', 1299, 'USD'),
  ('internal', 'Wood Chisel Set, 3 pc', 'hardware', 'HDW-CHISEL', 2199, 'USD'),
  ('internal', 'Kitchen and Bath Silicone Caulk', 'plumbing', 'PLB-CAULK', 899, 'USD'),
  ('internal', 'Caulk Remover Tool', 'plumbing', 'PLB-CAULK-TOOL', 799, 'USD'),
  ('internal', 'Dripless Caulk Gun, 10 oz', 'plumbing', 'PLB-CAULK-GUN', 1199, 'USD'),
  ('internal', 'Surface Prep Cleaner', 'plumbing', 'PLB-CLEANER', 949, 'USD'),
  ('internal', 'Painter''s Tape, 1.88 in', 'plumbing', 'PLB-TAPE-PAINT', 699, 'USD')
) AS v(source, name, category, sku, price_cents, currency)
WHERE NOT EXISTS (SELECT 1 FROM marketplace_products p WHERE p.sku = v.sku);

-- Curated kit definitions: job_type -> SKU list. Labels live in client locales
-- under partsList.kits.<job_type>.label so no migration is needed to rename.
INSERT INTO job_kit_definitions (job_type, sku, quantity, notes, sort_order)
SELECT v.job_type, v.sku, v.quantity, v.notes, v.sort_order
FROM (VALUES
  ('toilet-replacement', 'PLB-TOILET-2PC', 1, 'Standard 2-piece; confirm rough-in size with customer first', 1),
  ('toilet-replacement', 'PLB-WAXRING', 1, 'Includes bolts; skip if reusing flange bolts', 2),
  ('toilet-replacement', 'PLB-SUPPLY-20', 1, 'Replace the old supply line while the toilet is out', 3),
  ('toilet-replacement', 'PLB-BOLTS', 1, 'Backup set in case the kit bolts do not fit', 4),
  ('toilet-replacement', 'PLB-TAPE', 1, 'For the supply line threads', 5),

  ('leaky-faucet', 'PLB-FAUCET-KIT', 1, 'Covers most cartridge and compression faucets', 1),
  ('leaky-faucet', 'PLB-BASIN-WRENCH', 1, 'For the mounting nuts under the sink', 2),
  ('leaky-faucet', 'PLB-GREASE', 1, 'Lubricate O-rings on reassembly', 3),
  ('leaky-faucet', 'PLB-SUPPLY-PAIR', 1, 'Replace both lines if they look corroded', 4),

  ('garbage-disposal', 'PLB-DISPOSAL-12', 1, 'Confirm the existing unit is 1/2 HP or smaller', 1),
  ('garbage-disposal', 'PLB-DISP-KIT', 1, 'Flange, gasket, and mounting hardware', 2),
  ('garbage-disposal', 'PLB-PUTTY', 1, 'Seal the sink flange', 3),
  ('garbage-disposal', 'PLB-DISH-CONN', 1, 'Only needed if a dishwasher drains through the disposal', 4),

  ('ceiling-fan', 'ELE-FAN-52', 1, 'Confirm ceiling height suits a 52 in fan', 1),
  ('ceiling-fan', 'ELE-FAN-BOX', 1, 'Required: the old box is rarely fan-rated', 2),
  ('ceiling-fan', 'ELE-WIRE-NUTS', 1, 'Assortment covers the splice sizes', 3),
  ('ceiling-fan', 'ELE-VOLT-TEST', 1, 'Verify power is off before touching wires', 4),

  ('door-lock', 'HDW-DEADBOLT', 1, 'Confirm backset (2-3/8 or 2-3/4 in)', 1),
  ('door-lock', 'HDW-KNOB', 1, 'Match the deadbolt finish', 2),
  ('door-lock', 'HDW-STRIKE', 1, 'Reinforces the frame against kick-ins', 3),
  ('door-lock', 'HDW-CHISEL', 1, 'For mortising the strike plate', 4),

  ('tub-caulk', 'PLB-CAULK', 2, 'Two tubes covers a standard tub surround', 1),
  ('tub-caulk', 'PLB-CAULK-TOOL', 1, 'Remove every trace of old caulk first', 2),
  ('tub-caulk', 'PLB-CAULK-GUN', 1, 'Dripless type avoids mess between beads', 3),
  ('tub-caulk', 'PLB-CLEANER', 1, 'Prep the joint so the new caulk bonds', 4),
  ('tub-caulk', 'PLB-TAPE-PAINT', 1, 'Mask both sides of the joint for clean lines', 5)
) AS v(job_type, sku, quantity, notes, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM job_kit_definitions d
  WHERE d.job_type = v.job_type AND d.sku = v.sku
);
