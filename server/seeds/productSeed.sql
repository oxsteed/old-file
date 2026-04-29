-- Product marketplace seed data
-- Populate sample products with categories, skills, and aliases

-- Get skill IDs for mapping (adjust as needed)
-- Assuming skills like 'Electrician', 'Plumber', 'Carpenter', etc. exist in skills_lookup

-- Sample products (Tools category)
INSERT INTO marketplace_products (name, description, category, sku, price_cents, product_image_url, is_active, is_available, avg_rating, rating_count, in_carts_count)
VALUES
  ('DeWalt 20V Cordless Drill', 'Professional-grade cordless drill with 1/2" chuck, 0-450/0-1500 RPM, LED work light', 'Power Tools', 'DCD777C2', 4999, 'https://via.placeholder.com/400?text=DeWalt+Drill', TRUE, TRUE, 4.7, 245, 82),
  ('Stanley 65-Piece Socket Set', 'Complete socket set with ratchet, extensions, and carrying case. Metric and SAE sizes', 'Hand Tools', 'STMT71649', 4999, 'https://via.placeholder.com/400?text=Stanley+Sockets', TRUE, TRUE, 4.5, 156, 45),
  ('Bosch 1/4" Sheet Sander', 'Random orbital sander with micro-filter dust collection, 2.0A motor', 'Power Tools', 'ROS20VSK', 9999, 'https://via.placeholder.com/400?text=Bosch+Sander', TRUE, TRUE, 4.6, 89, 32),
  ('Craftsman Adjustable Wrench', 'Chrome-plated adjustable wrench, 0-1.5" jaw capacity. Heat-treated steel', 'Hand Tools', 'CMMT81749', 899, 'https://via.placeholder.com/400?text=Wrench', TRUE, TRUE, 4.3, 312, 128),
  ('Milwaukee Tape Measure', '25ft tape measure with magnetic tip, standout to 11ft, 1.3" wide blade', 'Measuring', 'MT25', 1599, 'https://via.placeholder.com/400?text=Tape+Measure', TRUE, TRUE, 4.6, 467, 234),
  ('Klein Tools Screwdriver Set', '11-piece insulated screwdriver set. Phillips, flathead, square drive', 'Hand Tools', 'KT32500', 2799, 'https://via.placeholder.com/400?text=Screwdrivers', TRUE, TRUE, 4.7, 189, 78),
  ('Makita Circular Saw', '7-1/4" circular saw, 5800 RPM, laser cutting guide, 24-tooth blade included', 'Power Tools', 'CS7500', 12999, 'https://via.placeholder.com/400?text=Circular+Saw', TRUE, TRUE, 4.8, 323, 156),
  ('Lufkin Torpedo Level', '24" torpedo level, 3 vials, magnetic. Cast aluminum body', 'Measuring', 'LT32', 2499, 'https://via.placeholder.com/400?text=Level', TRUE, TRUE, 4.5, 267, 98),

  -- Hardware
  ('Spax Stainless Steel Screws (1 lb)', '2.5" stainless steel wood screws, 1 lb box of assorted', 'Fasteners', 'SPAX-SS-250', 1299, 'https://via.placeholder.com/400?text=Screws', TRUE, TRUE, 4.4, 156, 267),
  ('Grip-Rite 16d Finishing Nails', '1 lb box of 16d finishing nails, bright finish', 'Fasteners', 'GRIP-16D-1LB', 599, 'https://via.placeholder.com/400?text=Nails', TRUE, TRUE, 4.2, 89, 145),
  ('Everbilt 3" Stainless Steel Hinges', 'Pair of 3\" ball bearing hinges, satin nickel, reversible', 'Hardware', 'EVER-35-SN', 899, 'https://via.placeholder.com/400?text=Hinges', TRUE, TRUE, 4.6, 234, 112),
  ('Wright-Moore 5/16" Anchor Bolts', 'Box of 25 anchor bolts with washers and nuts, 2\" length', 'Fasteners', 'WM-516-ANCH', 1099, 'https://via.placeholder.com/400?text=Anchor+Bolts', TRUE, TRUE, 4.3, 67, 32),

  -- Safety & PPE
  ('3M N95 Respirator Masks (10-pack)', 'NIOSH-approved N95 respirator masks, case of 10', 'Safety', 'MASK-N95-10', 999, 'https://via.placeholder.com/400?text=N95+Mask', TRUE, TRUE, 4.5, 1245, 823),
  ('Mechanix Original Work Gloves (M)', 'Premium work gloves with Secure Fit cuff, tactile grip, breathable', 'Safety', 'MECH-ORG-M', 1599, 'https://via.placeholder.com/400?text=Work+Gloves', TRUE, TRUE, 4.7, 456, 234),
  ('Pyramex Safety Glasses', 'Anti-scratch, UV-blocking polycarbonate lenses, adjustable temple', 'Safety', 'PYRA-SG', 799, 'https://via.placeholder.com/400?text=Safety+Glasses', TRUE, TRUE, 4.4, 189, 98),
  ('Carhartt FR Apron', 'Heavy-duty canvas apron with reinforced pockets, flame-resistant', 'Safety', 'CARR-FRA-BRN', 2499, 'https://via.placeholder.com/400?text=Apron', TRUE, TRUE, 4.6, 123, 45),
  ('Hard Hat Hi-Vis Yellow', 'ANSI Z89.1 Type I hard hat with ratchet suspension, yellow', 'Safety', 'HH-YELLOW', 1999, 'https://via.placeholder.com/400?text=Hard+Hat', TRUE, TRUE, 4.5, 234, 156),

  -- Paint & Coatings
  ('Sherwin-Williams ProClassic Paint (Quart)', 'Premium waterborne paint, professional-grade, satin finish, 1 quart', 'Paint', 'SW-PRO-Q-SAT', 1899, 'https://via.placeholder.com/400?text=Paint', TRUE, TRUE, 4.8, 567, 345),
  ('Minwax Dark Walnut Stain (Quart)', 'Oil-based wood stain, dark walnut, 1 quart', 'Paint', 'MINWAX-DW-Q', 899, 'https://via.placeholder.com/400?text=Stain', TRUE, TRUE, 4.6, 234, 123),
  ('Behr 100% Acrylic Paint (Gallon)', 'Interior/exterior acrylic latex paint, matte finish, 1 gallon', 'Paint', 'BEHR-ACRYLIC-G', 3499, 'https://via.placeholder.com/400?text=Paint+Gallon', TRUE, TRUE, 4.4, 145, 87),

  -- Lumber & Materials
  ('2x4x8 Pressure Treated Lumber', '8-foot pressure-treated lumber for outdoor construction', 'Lumber', 'LBTR-2x4x8', 699, 'https://via.placeholder.com/400?text=Lumber', TRUE, TRUE, 4.3, 234, 456),
  ('3/4" Plywood Sheet (4x8)', '4x8 sheet of 3/4\" exterior plywood for roofing/decking', 'Lumber', 'PLY-34-4x8', 3499, 'https://via.placeholder.com/400?text=Plywood', TRUE, TRUE, 4.5, 178, 234),
  ('Portland Cement (80 lb)', '80 lb bag of Portland cement for concrete mix', 'Materials', 'CEMENT-80LB', 799, 'https://via.placeholder.com/400?text=Cement', TRUE, TRUE, 4.4, 89, 145),

  -- Electrical
  ('Romex 14/2 Electrical Wire (250 ft)', '250-foot spool of 14 gauge 2-conductor Romex cable with ground', 'Electrical', 'ROMEX-14-2-250', 2499, 'https://via.placeholder.com/400?text=Wire', TRUE, TRUE, 4.6, 67, 45),
  ('Leviton 15A Duplex Outlet', 'Standard 15 amp duplex electrical outlet, ivory', 'Electrical', 'LEV-15A-IV', 249, 'https://via.placeholder.com/400?text=Outlet', TRUE, TRUE, 4.5, 234, 567),
  ('Bryant Single-Pole Light Switch', '15 amp single-pole toggle light switch, white', 'Electrical', 'BRYANT-SP', 349, 'https://via.placeholder.com/400?text=Switch', TRUE, TRUE, 4.4, 145, 234),

  -- Plumbing
  ('PVC Schedule 40 Pipe (1\" x 10 ft)', '10-foot length of 1\" PVC schedule 40 pipe', 'Plumbing', 'PVC-1-10FT', 599, 'https://via.placeholder.com/400?text=PVC+Pipe', TRUE, TRUE, 4.3, 89, 123),
  ('Copper Coupling (1\")', '1\" copper coupling fitting for soldered connections', 'Plumbing', 'CU-COUP-1', 349, 'https://via.placeholder.com/400?text=Coupling', TRUE, TRUE, 4.6, 56, 78),
  ('Moen Single-Handle Faucet', 'Moen kitchen faucet with 8\" center, chrome finish, pulldown sprayer', 'Plumbing', 'MOEN-KF-8', 9999, 'https://via.placeholder.com/400?text=Faucet', TRUE, TRUE, 4.7, 234, 167)
ON CONFLICT DO NOTHING;

-- Sample product aliases (synonyms)
INSERT INTO product_aliases (product_id, alias_name, alias_type, relevance_score)
SELECT p.id, alias, 'synonym', 75
FROM (
  SELECT id, name FROM marketplace_products WHERE name LIKE '%Drill%'
) p, LATERAL (VALUES ('Power Drill'), ('Cordless Drill'), ('Chuck')) AS aliases(alias)
ON CONFLICT DO NOTHING;

INSERT INTO product_aliases (product_id, alias_name, alias_type, relevance_score)
SELECT p.id, alias, 'synonym', 75
FROM (
  SELECT id, name FROM marketplace_products WHERE name LIKE '%Wrench%'
) p, LATERAL (VALUES ('Socket Wrench'), ('Ratchet'), ('Chrome Wrench')) AS aliases(alias)
ON CONFLICT DO NOTHING;

-- Map products to categories
INSERT INTO marketplace_product_categories (product_id, category_id, is_primary)
SELECT p.id, c.id, TRUE
FROM marketplace_products p
JOIN product_categories c ON (
  (p.category = 'Power Tools' AND c.slug = 'power-tools') OR
  (p.category = 'Hand Tools' AND c.slug = 'hand-tools') OR
  (p.category = 'Measuring' AND c.slug = 'measuring-layout') OR
  (p.category = 'Fasteners' AND c.slug = 'fasteners') OR
  (p.category = 'Hardware' AND c.slug = 'hardware') OR
  (p.category = 'Safety' AND c.slug = 'safety-ppe') OR
  (p.category = 'Paint' AND c.slug = 'paint-coatings') OR
  (p.category = 'Lumber' AND c.slug = 'lumber-wood') OR
  (p.category = 'Materials' AND c.slug = 'materials-supplies') OR
  (p.category = 'Electrical' AND c.slug = 'electrical') OR
  (p.category = 'Plumbing' AND c.slug = 'plumbing')
)
ON CONFLICT DO NOTHING;

-- Map products to skills (assuming skills with these IDs exist)
-- Electrician → Electrical products
INSERT INTO marketplace_product_skills (product_id, skill_id, relevance_score)
SELECT p.id, 1, 85  -- Assuming skill_id=1 is Electrician
FROM marketplace_products p
WHERE p.category IN ('Electrical', 'Power Tools')
ON CONFLICT DO NOTHING;

-- Plumber → Plumbing products
INSERT INTO marketplace_product_skills (product_id, skill_id, relevance_score)
SELECT p.id, 2, 85  -- Assuming skill_id=2 is Plumber
FROM marketplace_products p
WHERE p.category IN ('Plumbing')
ON CONFLICT DO NOTHING;

-- Carpenter → Hand tools, Lumber
INSERT INTO marketplace_product_skills (product_id, skill_id, relevance_score)
SELECT p.id, 3, 80  -- Assuming skill_id=3 is Carpenter
FROM marketplace_products p
WHERE p.category IN ('Hand Tools', 'Lumber', 'Power Tools')
ON CONFLICT DO NOTHING;

-- General Handyman → All tools
INSERT INTO marketplace_product_skills (product_id, skill_id, relevance_score)
SELECT p.id, 4, 70  -- Assuming skill_id=4 is Handyman
FROM marketplace_products p
WHERE p.category IN ('Hand Tools', 'Power Tools', 'Measuring', 'Hardware')
ON CONFLICT DO NOTHING;

-- Painter → Paint & Safety
INSERT INTO marketplace_product_skills (product_id, skill_id, relevance_score)
SELECT p.id, 5, 85  -- Assuming skill_id=5 is Painter
FROM marketplace_products p
WHERE p.category IN ('Paint', 'Safety')
ON CONFLICT DO NOTHING;
