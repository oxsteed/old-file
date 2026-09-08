-- Migration 390: Admin-managed OxSteed Direct catalog.
-- The existing profile JSON fields remain for backwards compatibility while
-- these tables become the source of truth for the public Direct catalog.

CREATE TABLE IF NOT EXISTS direct_catalog_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(100) NOT NULL UNIQUE,
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon_key VARCHAR(40) NOT NULL DEFAULT 'wrench',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS direct_catalog_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES direct_catalog_categories(id) ON DELETE CASCADE,
  slug VARCHAR(140) NOT NULL UNIQUE,
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  description_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  availability_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS direct_catalog_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(140) NOT NULL UNIQUE,
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  description_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon_key VARCHAR(40) NOT NULL DEFAULT 'wrench',
  availability_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS direct_catalog_audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_direct_catalog_categories_public
  ON direct_catalog_categories (is_active, is_published, sort_order);
CREATE INDEX IF NOT EXISTS idx_direct_catalog_services_category_public
  ON direct_catalog_services (category_id, is_active, is_published, sort_order);
CREATE INDEX IF NOT EXISTS idx_direct_catalog_tools_public
  ON direct_catalog_tools (is_active, is_published, sort_order);
CREATE INDEX IF NOT EXISTS idx_direct_catalog_audit_created
  ON direct_catalog_audit_events (created_at DESC);

-- Seed a useful first catalog. Values are complete locale objects so the
-- initial deployment is publishable; administrators can refine wording later.
INSERT INTO direct_catalog_categories (slug, name_i18n, icon_key, sort_order, is_published)
VALUES
  ('electrical', '{"en":"Electrical","es":"Electricidad","fr":"Électricité","ht":"Elektrisite","ar":"كهرباء"}', 'zap', 10, TRUE),
  ('plumbing', '{"en":"Plumbing","es":"Plomería","fr":"Plomberie","ht":"Plonbri","ar":"سباكة"}', 'droplets', 20, TRUE),
  ('carpentry', '{"en":"Carpentry","es":"Carpintería","fr":"Menuiserie","ht":"Chapant","ar":"نجارة"}', 'hammer', 30, TRUE),
  ('painting', '{"en":"Painting","es":"Pintura","fr":"Peinture","ht":"Penti","ar":"دهان"}', 'paintbrush', 40, TRUE),
  ('landscaping', '{"en":"Landscaping","es":"Paisajismo","fr":"Aménagement paysager","ht":"Amenajman jaden","ar":"تنسيق الحدائق"}', 'trees', 50, TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO direct_catalog_services (
  category_id, slug, name_i18n, description_i18n, availability_days, sort_order, is_published
)
SELECT c.id, v.slug, v.name_i18n::jsonb, v.description_i18n::jsonb, '["Monday","Tuesday","Wednesday","Thursday"]'::jsonb, v.sort_order, TRUE
FROM direct_catalog_categories c
JOIN (VALUES
  ('electrical', 'ceiling-fan-installation', '{"en":"Ceiling Fan Installation","es":"Instalación de ventiladores de techo","fr":"Installation de ventilateur de plafond","ht":"Enstalasyon vantilatè plafon","ar":"تركيب مروحة سقف"}', '{"en":"Ceiling fan installation for ceilings.","es":"Instalación de ventiladores de techo.","fr":"Installation de ventilateurs de plafond.","ht":"Enstalasyon vantilatè plafon.","ar":"تركيب مراوح السقف."}', 10),
  ('electrical', 'light-fixture-repair', '{"en":"Light Fixture Repair","es":"Reparación de luminarias","fr":"Réparation de luminaires","ht":"Reparasyon aparèy limyè","ar":"إصلاح تركيبات الإضاءة"}', '{"en":"Repair or replace light fixtures.","es":"Repara o reemplaza luminarias.","fr":"Réparez ou remplacez les luminaires.","ht":"Repare oswa ranplase aparèy limyè.","ar":"إصلاح أو استبدال تركيبات الإضاءة."}', 20),
  ('electrical', 'outlet-switch-upgrade', '{"en":"Outlet & Switch Upgrade","es":"Mejora de enchufes e interruptores","fr":"Mise à niveau des prises et interrupteurs","ht":"Amelyorasyon priz ak switch","ar":"ترقية المقابس والمفاتيح"}', '{"en":"Upgrade outlets and switches for safer everyday use.","es":"Mejora enchufes e interruptores para un uso diario más seguro.","fr":"Modernisez les prises et interrupteurs pour un usage quotidien plus sûr.","ht":"Amelyore priz ak switch pou itilizasyon chak jou ki pi an sekirite.","ar":"ترقية المقابس والمفاتيح لاستخدام يومي أكثر أمانًا."}', 30),
  ('electrical', 'panel-circuit-breaker-service', '{"en":"Panel & Circuit Breaker Service","es":"Servicio de panel e interruptores","fr":"Service de panneau et disjoncteurs","ht":"Sèvis panèl ak disjonktè","ar":"خدمة اللوحة وقواطع الدائرة"}', '{"en":"Panel and circuit breaker service.","es":"Servicio de panel e interruptores.","fr":"Service de panneau et de disjoncteurs.","ht":"Sèvis panèl ak disjonktè.","ar":"خدمة اللوحة وقواطع الدائرة."}', 40),
  ('electrical', 'wiring-inspection', '{"en":"Wiring Inspection","es":"Inspección del cableado","fr":"Inspection du câblage","ht":"Enspeksyon fil elektrik","ar":"فحص الأسلاك"}', '{"en":"Inspect wiring and identify service needs.","es":"Inspecciona el cableado e identifica las necesidades de servicio.","fr":"Inspectez le câblage et identifiez les besoins de service.","ht":"Enspekte fil elektrik epi idantifye bezwen sèvis yo.","ar":"فحص الأسلاك وتحديد احتياجات الخدمة."}', 50)
) AS v(category_slug, slug, name_i18n, description_i18n, sort_order)
  ON c.slug = v.category_slug
ON CONFLICT (slug) DO NOTHING;

-- Existing profile tools are migrated into admin-managed records. They start
-- unpublished so an administrator can complete localized descriptions safely.
INSERT INTO direct_catalog_tools (slug, name_i18n, sort_order)
SELECT DISTINCT
  regexp_replace(lower(tool), '[^a-z0-9]+', '-', 'g'),
  jsonb_build_object('en', tool),
  row_number() OVER (ORDER BY tool) * 10
FROM direct_service_profiles p
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(p.tools) = 'array' THEN p.tools ELSE '[]'::jsonb END) AS t(tool)
WHERE trim(tool) <> ''
ON CONFLICT (slug) DO NOTHING;

-- Publish the original default inventory with editable translations so the
-- first public catalog remains useful immediately after migration.
WITH seeded(slug, icon_key, name_i18n, description_i18n) AS (
  VALUES
    ('truck-and-hauling-gear', 'truck', jsonb_build_object('en', 'Truck and hauling gear', 'es', 'Equipo de camión y transporte', 'fr', 'Équipement de camion et de transport', 'ht', 'Ekipman kamyon ak transpò', 'ar', 'معدات الشاحنات والنقل'), jsonb_build_object('en', 'Truck and hauling gear for local delivery and hauling work.', 'es', 'Equipo de camión y transporte para entregas y trabajos locales.', 'fr', 'Équipement de camion et de transport pour les livraisons et travaux locaux.', 'ht', 'Ekipman kamyon ak transpò pou livrezon ak travay lokal.', 'ar', 'معدات الشاحنات والنقل للتوصيل والأعمال المحلية.')),
    ('power-drill-and-bit-set', 'drill', jsonb_build_object('en', 'Power drill and bit set', 'es', 'Taladro eléctrico y juego de brocas', 'fr', 'Perceuse électrique et jeu de forets', 'ht', 'Perforatè elektrik ak seri mèch', 'ar', 'مثقاب كهربائي ومجموعة لقم'), jsonb_build_object('en', 'Power drill and bit set for installation and repair work.', 'es', 'Taladro eléctrico y juego de brocas para instalaciones y reparaciones.', 'fr', 'Perceuse électrique et jeu de forets pour les installations et réparations.', 'ht', 'Perforatè elektrik ak seri mèch pou enstalasyon ak reparasyon.', 'ar', 'مثقاب كهربائي ومجموعة لقم لأعمال التركيب والإصلاح.')),
    ('ladders-and-step-stools', 'ruler', jsonb_build_object('en', 'Ladders and step stools', 'es', 'Escaleras y taburetes', 'fr', 'Échelles et escabeaux', 'ht', 'Nechèl ak ti mach eskalye', 'ar', 'سلالم ودرجات صغيرة'), jsonb_build_object('en', 'Ladders and step stools for safe access during service.', 'es', 'Escaleras y taburetes para acceder de forma segura durante el servicio.', 'fr', 'Échelles et escabeaux pour un accès sûr pendant le service.', 'ht', 'Nechèl ak ti mach eskalye pou aksè an sekirite pandan sèvis la.', 'ar', 'سلالم ودرجات صغيرة للوصول الآمن أثناء الخدمة.')),
    ('pressure-washer', 'wrench', jsonb_build_object('en', 'Pressure washer', 'es', 'Hidrolavadora', 'fr', 'Nettoyeur haute pression', 'ht', 'Machin lave a presyon', 'ar', 'غسالة ضغط'), jsonb_build_object('en', 'Pressure washer for outdoor cleanup and preparation.', 'es', 'Hidrolavadora para limpieza y preparación exterior.', 'fr', 'Nettoyeur haute pression pour le nettoyage et la préparation extérieurs.', 'ht', 'Machin lave a presyon pou netwayaj ak preparasyon deyò.', 'ar', 'غسالة ضغط للتنظيف والتحضير الخارجي.')),
    ('hand-tools-and-repair-kit', 'wrench', jsonb_build_object('en', 'Hand tools and repair kit', 'es', 'Herramientas manuales y kit de reparación', 'fr', 'Outils à main et kit de réparation', 'ht', 'Zouti men ak twous reparasyon', 'ar', 'أدوات يدوية ومجموعة إصلاح'), jsonb_build_object('en', 'Hand tools and a repair kit for everyday service work.', 'es', 'Herramientas manuales y kit de reparación para trabajos diarios.', 'fr', 'Outils à main et kit de réparation pour les travaux courants.', 'ht', 'Zouti men ak twous reparasyon pou travay sèvis chak jou.', 'ar', 'أدوات يدوية ومجموعة إصلاح لأعمال الخدمة اليومية.')),
    ('measuring-and-layout-tools', 'ruler', jsonb_build_object('en', 'Measuring and layout tools', 'es', 'Herramientas de medición y trazado', 'fr', 'Outils de mesure et de traçage', 'ht', 'Zouti pou mezire ak trase', 'ar', 'أدوات القياس والتخطيط'), jsonb_build_object('en', 'Measuring and layout tools for accurate planning and installation.', 'es', 'Herramientas de medición y trazado para planificar e instalar con precisión.', 'fr', 'Outils de mesure et de traçage pour planifier et installer avec précision.', 'ht', 'Zouti pou mezire ak trase pou planifikasyon ak enstalasyon egzak.', 'ar', 'أدوات القياس والتخطيط للتخطيط والتركيب بدقة.')),
    ('cleanup-and-janitorial-supplies', 'shield-check', jsonb_build_object('en', 'Cleanup and janitorial supplies', 'es', 'Suministros de limpieza y conserjería', 'fr', 'Fournitures de nettoyage et d’entretien', 'ht', 'Founiti netwayaj ak antretyen', 'ar', 'مستلزمات التنظيف والخدمات'), jsonb_build_object('en', 'Cleanup and janitorial supplies for leaving each site ready.', 'es', 'Suministros de limpieza para dejar cada lugar listo.', 'fr', 'Fournitures de nettoyage pour laisser chaque site en ordre.', 'ht', 'Founiti netwayaj pou kite chak kote pare.', 'ar', 'مستلزمات التنظيف لترك كل موقع جاهزًا.')),
    ('phone-and-photo-inspection-kit', 'shield-check', jsonb_build_object('en', 'Phone and photo inspection kit', 'es', 'Kit de inspección con teléfono y fotos', 'fr', 'Kit d’inspection avec téléphone et photos', 'ht', 'Twous enspeksyon telefòn ak foto', 'ar', 'مجموعة فحص بالهاتف والصور'), jsonb_build_object('en', 'Phone and photo inspection kit for documenting service details.', 'es', 'Kit de inspección con teléfono y fotos para documentar el servicio.', 'fr', 'Kit d’inspection avec téléphone et photos pour documenter le service.', 'ht', 'Twous enspeksyon telefòn ak foto pou dokimante detay sèvis yo.', 'ar', 'مجموعة فحص بالهاتف والصور لتوثيق تفاصيل الخدمة.'))
)
UPDATE direct_catalog_tools AS tools
SET name_i18n = seeded.name_i18n,
    description_i18n = seeded.description_i18n,
    icon_key = seeded.icon_key,
    is_active = TRUE,
    is_published = TRUE,
    updated_at = CURRENT_TIMESTAMP
FROM seeded
WHERE tools.slug = seeded.slug;
