-- Migration 137: Product Aliases & Comprehensive Categories
-- Enables advanced search with synonyms and hierarchical product categories (100+)

-- Product Aliases (synonyms for better search discovery)
-- Example: "wrench" has aliases "socket", "ratchet" for related products
CREATE TABLE IF NOT EXISTS product_aliases (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  alias_name VARCHAR(100) NOT NULL,
  alias_type VARCHAR(20) DEFAULT 'synonym', -- 'synonym', 'related', 'brand', 'alternative'
  relevance_score SMALLINT DEFAULT 50, -- 0-100, used for ranking
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, alias_name, alias_type)
);

CREATE INDEX IF NOT EXISTS idx_product_aliases_product_id ON product_aliases(product_id);
CREATE INDEX IF NOT EXISTS idx_product_aliases_alias_name ON product_aliases(alias_name);
CREATE INDEX IF NOT EXISTS idx_product_aliases_type ON product_aliases(alias_type);

-- Comprehensive Product Categories (100+)
-- Hierarchical: Tools → Power Tools → Drills → Cordless Drills
CREATE TABLE IF NOT EXISTS product_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  parent_category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL,
  icon_emoji VARCHAR(10),
  icon_name VARCHAR(50), -- Lucide icon name
  display_order SMALLINT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_parent ON product_categories(parent_category_id);
CREATE INDEX IF NOT EXISTS idx_categories_slug ON product_categories(slug);
CREATE INDEX IF NOT EXISTS idx_categories_active ON product_categories(is_active);

-- Product to Categories (many-to-many, replaces single category string)
CREATE TABLE IF NOT EXISTS marketplace_product_categories (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE, -- main category for this product
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_product ON marketplace_product_categories(product_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_category ON marketplace_product_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_product_categories_primary ON marketplace_product_categories(category_id) WHERE is_primary = TRUE;

-- Seed comprehensive product categories (tools, materials, safety, etc.)
INSERT INTO product_categories (name, slug, description, icon_emoji, icon_name, display_order, parent_category_id)
VALUES
  -- Top-level categories
  ('Tools', 'tools', 'Tools for all trades', '🔧', 'tool', 1, NULL),
  ('Power Tools', 'power-tools', 'Electric and battery-powered tools', '⚡', 'zap', 2, NULL),
  ('Hand Tools', 'hand-tools', 'Manual tools and implements', '🔨', 'hammer', 3, NULL),
  ('Safety & PPE', 'safety-ppe', 'Personal protective equipment', '⛑️', 'shield', 4, NULL),
  ('Hardware', 'hardware', 'Fasteners and hardware components', '🔩', 'wrench', 5, NULL),
  ('Materials & Supplies', 'materials-supplies', 'Building and finishing materials', '📦', 'package', 6, NULL),
  ('Measuring & Layout', 'measuring-layout', 'Measurement and layout tools', '📐', 'ruler', 7, NULL),
  ('Fasteners', 'fasteners', 'Nails, screws, bolts, and anchors', '🔗', 'link', 8, NULL),
  ('Paint & Coatings', 'paint-coatings', 'Paint, stain, and finishing coatings', '🎨', 'palette', 9, NULL),
  ('Lumber & Wood', 'lumber-wood', 'Wood materials and lumber', '🪵', 'tree', 10, NULL),
  ('Plumbing', 'plumbing', 'Plumbing fixtures and supplies', '🚰', 'droplet', 11, NULL),
  ('Electrical', 'electrical', 'Electrical supplies and components', '⚙️', 'lightbulb', 12, NULL),
  ('HVAC', 'hvac', 'Heating, ventilation, air conditioning', '🌡️', 'thermometer', 13, NULL),
  ('Flooring', 'flooring', 'Flooring materials and installation', '🏠', 'home', 14, NULL),
  ('Roofing', 'roofing', 'Roofing materials and supplies', '🏘️', 'building-2', 15, NULL),

  -- Subcategories under Tools (16-30)
  ('Drills', 'drills', 'Cordless and corded drills', '⚡', 'zap', 16, 1),
  ('Saws', 'saws', 'Circular saws, miter saws, band saws', '🔪', 'scissors', 17, 1),
  ('Sanders', 'sanders', 'Orbital, belt, and detail sanders', '✨', 'sparkles', 18, 1),
  ('Grinders', 'grinders', 'Angle grinders, bench grinders', '💫', 'star', 19, 1),
  ('Impact Tools', 'impact-tools', 'Impact drivers, hammers, chisel', '💥', 'zap', 20, 1),

  -- Subcategories under Hand Tools (21-35)
  ('Wrenches', 'wrenches', 'Open-end, box-end, adjustable wrenches', '🔧', 'wrench', 21, 3),
  ('Screwdrivers', 'screwdrivers', 'Phillips, flathead, multi-bit screwdrivers', '🔩', 'zap', 22, 3),
  ('Hammers & Mallets', 'hammers-mallets', 'Claw hammers, ball-pein, rubber mallets', '🔨', 'hammer', 23, 3),
  ('Pliers', 'pliers', 'Slip-joint, arc-joint, needle-nose pliers', '🔀', 'scissors', 24, 3),
  ('Measuring Tapes', 'measuring-tapes', 'Tape measures in various lengths', '📏', 'ruler', 25, 3),
  ('Levels', 'levels', 'Spirit levels, laser levels, digital levels', '⚖️', 'zap', 26, 3),
  ('Chisels', 'chisels', 'Wood chisels, cold chisels, gouges', '⚒️', 'zap', 27, 3),
  ('Saws (Hand)', 'saws-hand', 'Hand saws, hacksaws, coping saws', '🔪', 'scissors', 28, 3),

  -- Subcategories under Safety & PPE (29-45)
  ('Head Protection', 'head-protection', 'Hard hats, helmets, bump caps', '⛑️', 'shield', 29, 4),
  ('Eye Protection', 'eye-protection', 'Safety glasses, goggles, face shields', '👓', 'eye', 30, 4),
  ('Ear Protection', 'ear-protection', 'Earplugs, earmuffs, headphones', '👂', 'volume', 31, 4),
  ('Hand Protection', 'hand-protection', 'Work gloves, cut-resistant gloves', '🧤', 'hand', 32, 4),
  ('Foot Protection', 'foot-protection', 'Safety boots, steel-toe shoes', '👞', 'shoe', 33, 4),
  ('Body Protection', 'body-protection', 'Vests, aprons, coveralls, reflective wear', '🦺', 'vest', 34, 4),
  ('Respiratory Protection', 'respiratory-protection', 'Dust masks, respirators, cartridges', '😷', 'wind', 35, 4),
  ('Fall Protection', 'fall-protection', 'Harnesses, lanyards, anchors', '⛓️', 'link-2', 36, 4),

  -- Subcategories under Hardware (37-50)
  ('Nails', 'nails', 'Various nail sizes and types', '📌', 'pin', 37, 5),
  ('Screws', 'screws', 'Wood screws, machine screws, anchors', '🔩', 'zap', 38, 5),
  ('Bolts & Nuts', 'bolts-nuts', 'Bolts, nuts, washers, lock washers', '🔗', 'link', 39, 5),
  ('Hinges', 'hinges', 'Door hinges, cabinet hinges, specialty', '🔁', 'rotate-cw', 40, 5),
  ('Hooks & Anchors', 'hooks-anchors', 'Wall hooks, picture hangers, anchors', '🪝', 'hook', 41, 5),
  ('Door Hardware', 'door-hardware', 'Doorknobs, handles, locks, closers', '🚪', 'door-open', 42, 5),
  ('Drawer Slides', 'drawer-slides', 'Ball-bearing slides, undermount slides', '📦', 'package', 43, 5),

  -- Subcategories under Materials & Supplies (44-60)
  ('Lumber (Softwood)', 'lumber-softwood', '2x4s, plywood, pine boards', '🪵', 'tree', 44, 10),
  ('Lumber (Hardwood)', 'lumber-hardwood', 'Oak, maple, walnut, exotic woods', '🌲', 'tree', 45, 10),
  ('Plywood & OSB', 'plywood-osb', 'Plywood, OSB, composite sheets', '📦', 'package', 46, 10),
  ('Drywall & Insulation', 'drywall-insulation', 'Drywall, joint compound, insulation', '🧱', 'square', 47, 10),
  ('Concrete & Mortar', 'concrete-mortar', 'Portland cement, mortar, concrete mix', '🏗️', 'square', 48, 10),
  ('Adhesives & Sealants', 'adhesives-sealants', 'Wood glue, silicone, caulk, tape', '🧴', 'bottle-2', 49, 10),
  ('Caulks', 'caulks', 'Silicone, acrylic, polyurethane caulk', '🧴', 'bottle-2', 50, 10),

  -- Subcategories under Plumbing (51-65)
  ('Faucets', 'faucets', 'Kitchen, bathroom faucets, sprayers', '🚰', 'droplet', 51, 11),
  ('Pipes & Fittings', 'pipes-fittings', 'Copper, PVC, PEX pipes and connectors', '🔌', 'plug', 52, 11),
  ('Valves', 'valves', 'Ball valves, check valves, shutoff', '⚙️', 'settings', 53, 11),
  ('Drains & Traps', 'drains-traps', 'P-traps, S-traps, drain assemblies', '🌊', 'waves', 54, 11),
  ('Water Heaters', 'water-heaters', 'Tank, tankless, expansion tanks', '🔥', 'flame', 55, 11),
  ('Fixtures', 'fixtures', 'Sinks, toilets, bidets, tubs, showers', '🛁', 'bath', 56, 11),

  -- Subcategories under Electrical (57-70)
  ('Wire & Cable', 'wire-cable', 'Electrical wire, cable, cords', '⚡', 'zap', 57, 12),
  ('Breakers & Panels', 'breakers-panels', 'Circuit breakers, panel boxes', '⚙️', 'settings', 58, 12),
  ('Outlets & Switches', 'outlets-switches', 'Receptacles, switches, covers', '🔌', 'plug', 59, 12),
  ('Light Fixtures', 'light-fixtures', 'Ceiling, wall, outdoor lighting', '💡', 'lightbulb', 60, 12),
  ('Bulbs', 'bulbs', 'LED, incandescent, fluorescent, specialty', '💡', 'lightbulb', 61, 12),

  -- Additional categories
  ('Cleaning & Maintenance', 'cleaning-maintenance', 'Cleaning supplies, lubricants, degreasers', '🧹', 'broom', 62, NULL),
  ('Work Benches & Storage', 'work-benches-storage', 'Workbenches, tool chests, shelving', '🗄️', 'cabinet', 63, NULL),
  ('Ladders & Scaffolding', 'ladders-scaffolding', 'Step ladders, extension, scaffolding', '🪜', 'hammer', 64, NULL),
  ('Fastening & Joining', 'fastening-joining', 'Welding, brazing, riveting tools', '⛓️', 'link-2', 65, NULL),
  ('Cutting Tools', 'cutting-tools', 'Blades, bits, rotary cutting tools', '✂️', 'scissors', 66, NULL),
  ('Automotive Tools', 'automotive-tools', 'Socket sets, torque wrenches, jacks', '🚗', 'car', 67, NULL),
  ('Garden & Landscaping', 'garden-landscaping', 'Rakes, shovels, forks, pruning tools', '🌱', 'leaf', 68, NULL),
  ('Demolition Tools', 'demolition-tools', 'Pry bars, sledges, breakers', '💥', 'zap', 69, NULL),
  ('Tarps & Coverings', 'tarps-coverings', 'Tarps, drop cloths, protective coverings', '📕', 'rectangle', 70, NULL)
ON CONFLICT (name) DO NOTHING;

-- Enhanced marketplace_products fields (if not already present)
DO $$
BEGIN
  -- Add relevance metadata fields if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'marketplace_products' AND column_name = 'avg_rating') THEN
    ALTER TABLE marketplace_products ADD COLUMN avg_rating NUMERIC(3,2);
    ALTER TABLE marketplace_products ADD COLUMN rating_count INTEGER DEFAULT 0;
    ALTER TABLE marketplace_products ADD COLUMN in_carts_count INTEGER DEFAULT 0;
  END IF;
END $$;
