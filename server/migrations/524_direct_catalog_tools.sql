-- Migration 524: publish the core tools needed by the expanded Direct catalog.
-- Tools are informational inventory; availability still depends on scheduling
-- and the operator's confirmed scope for a request.

ALTER TABLE direct_catalog_tools
  ADD COLUMN IF NOT EXISTS category_slug VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_direct_catalog_tools_category
  ON direct_catalog_tools (category_slug, lifecycle_status, display_order);

WITH seeded(category_slug, slug, name_i18n, description_i18n, icon_key, display_order) AS (
  VALUES
    ('electrical', 'voltage-tester', jsonb_build_object('en', 'Voltage Tester', 'es', 'Probador de voltaje', 'fr', 'Testeur de tension', 'ht', 'Tès vòltaj', 'ar', 'فاحص الجهد'), jsonb_build_object('en', 'Non-contact tester for checking circuits before service.', 'es', 'Probador sin contacto para revisar circuitos antes del servicio.', 'fr', 'Testeur sans contact pour vérifier les circuits avant le service.', 'ht', 'Tès san kontak pou verifye sikwi yo anvan sèvis la.', 'ar', 'فاحص بدون تلامس للتحقق من الدوائر قبل الخدمة.'), 'zap', 10),
    ('electrical', 'wire-strippers', jsonb_build_object('en', 'Wire Strippers', 'es', 'Pelacables', 'fr', 'Dénude-fils', 'ht', 'Zouti pou dekale fil', 'ar', 'كماشة تجريد الأسلاك'), jsonb_build_object('en', 'Hand tool for preparing wire ends during approved electrical work.', 'es', 'Herramienta manual para preparar extremos de cables durante trabajos eléctricos aprobados.', 'fr', 'Outil manuel pour préparer les extrémités des fils lors de travaux électriques approuvés.', 'ht', 'Zouti men pou prepare bout fil yo pandan travay elektrik ki apwouve.', 'ar', 'أداة يدوية لتجهيز أطراف الأسلاك أثناء الأعمال الكهربائية المعتمدة.'), 'zap', 20),
    ('electrical', 'multimeter', jsonb_build_object('en', 'Multimeter', 'es', 'Multímetro', 'fr', 'Multimètre', 'ht', 'Miltimèt', 'ar', 'جهاز قياس متعدد'), jsonb_build_object('en', 'Meter for diagnostic readings during a qualified electrical assessment.', 'es', 'Medidor para lecturas de diagnóstico durante una evaluación eléctrica calificada.', 'fr', 'Appareil de mesure pour les diagnostics lors d’une évaluation électrique qualifiée.', 'ht', 'Mèt pou lekti dyagnostik pandan yon evalyasyon elektrik ki kalifye.', 'ar', 'جهاز لقراءات التشخيص أثناء التقييم الكهربائي المؤهل.'), 'zap', 30),
    ('plumbing', 'pipe-wrench-set', jsonb_build_object('en', 'Pipe Wrench Set', 'es', 'Juego de llaves para tuberías', 'fr', 'Jeu de clés à tuyau', 'ht', 'Seri kle tiyo', 'ar', 'مجموعة مفاتيح الأنابيب'), jsonb_build_object('en', 'Wrench set for approved pipe fitting and repair work.', 'es', 'Juego de llaves para trabajos aprobados de reparación y conexión de tuberías.', 'fr', 'Jeu de clés pour les travaux approuvés de raccordement et de réparation de tuyaux.', 'ht', 'Seri kle pou travay reparasyon ak koneksyon tiyo ki apwouve.', 'ar', 'مجموعة مفاتيح لأعمال توصيل وإصلاح الأنابيب المعتمدة.'), 'droplets', 10),
    ('plumbing', 'drain-snake', jsonb_build_object('en', 'Drain Snake', 'es', 'Serpiente para desagües', 'fr', 'Furet de canalisation', 'ht', 'Fouri drenaj', 'ar', 'سلك تنظيف المصارف'), jsonb_build_object('en', 'Drain clearing tool for routine household blockages.', 'es', 'Herramienta para despejar obstrucciones habituales en desagües domésticos.', 'fr', 'Outil pour dégager les obstructions courantes des canalisations domestiques.', 'ht', 'Zouti pou retire blokaj komen nan drenaj kay.', 'ar', 'أداة لإزالة الانسدادات المنزلية المعتادة في المصارف.'), 'droplets', 20),
    ('plumbing', 'water-pressure-gauge', jsonb_build_object('en', 'Water Pressure Gauge', 'es', 'Manómetro de presión de agua', 'fr', 'Manomètre de pression d’eau', 'ht', 'Jij presyon dlo', 'ar', 'مقياس ضغط المياه'), jsonb_build_object('en', 'Gauge for documenting water pressure during a plumbing assessment.', 'es', 'Manómetro para documentar la presión del agua durante una evaluación de plomería.', 'fr', 'Manomètre pour documenter la pression de l’eau lors d’une évaluation de plomberie.', 'ht', 'Jij pou dokimante presyon dlo pandan evalyasyon plonbri.', 'ar', 'مقياس لتوثيق ضغط المياه أثناء تقييم السباكة.'), 'droplets', 30),
    ('carpentry', 'miter-saw', jsonb_build_object('en', 'Miter Saw', 'es', 'Sierra ingletadora', 'fr', 'Scie à onglet', 'ht', 'Sye ang', 'ar', 'منشار ميتري'), jsonb_build_object('en', 'Saw for accurately cutting trim and framing materials.', 'es', 'Sierra para cortar con precisión materiales de molduras y estructuras.', 'fr', 'Scie pour couper avec précision les moulures et matériaux de charpente.', 'ht', 'Sye pou koupe materyèl fini ak kad avèk presizyon.', 'ar', 'منشار لقطع مواد الحواف والهياكل بدقة.'), 'hammer', 10),
    ('carpentry', 'stud-finder', jsonb_build_object('en', 'Stud Finder', 'es', 'Detector de montantes', 'fr', 'Détecteur de montants', 'ht', 'Detektè poto miray', 'ar', 'كاشف القوائم الجدارية'), jsonb_build_object('en', 'Locator for identifying wall framing before mounting or repair.', 'es', 'Detector para identificar la estructura de la pared antes de instalar o reparar.', 'fr', 'Détecteur pour repérer la structure murale avant une fixation ou une réparation.', 'ht', 'Zouti pou jwenn kad miray la anvan monte oswa repare.', 'ar', 'أداة لتحديد هيكل الجدار قبل التثبيت أو الإصلاح.'), 'ruler', 20),
    ('carpentry', 'orbital-sander', jsonb_build_object('en', 'Orbital Sander', 'es', 'Lijadora orbital', 'fr', 'Ponceuse orbitale', 'ht', 'Lisyè orbital', 'ar', 'صنفرة مدارية'), jsonb_build_object('en', 'Sander for preparing wood surfaces before repair or finish work.', 'es', 'Lijadora para preparar superficies de madera antes de reparar o aplicar acabados.', 'fr', 'Ponceuse pour préparer les surfaces en bois avant réparation ou finition.', 'ht', 'Lisyè pou prepare sifas bwa anvan reparasyon oswa fini.', 'ar', 'آلة صنفرة لتجهيز الأسطح الخشبية قبل الإصلاح أو التشطيب.'), 'hammer', 30),
    ('painting', 'airless-paint-sprayer', jsonb_build_object('en', 'Airless Paint Sprayer', 'es', 'Rociador de pintura sin aire', 'fr', 'Pulvérisateur de peinture sans air', 'ht', 'Flitè penti san lè', 'ar', 'مرش طلاء بدون هواء'), jsonb_build_object('en', 'Sprayer for approved large-surface painting after masking and preparation.', 'es', 'Rociador para pintar superficies grandes aprobadas después de proteger y preparar.', 'fr', 'Pulvérisateur pour les grandes surfaces approuvées après masquage et préparation.', 'ht', 'Flitè pou gwo sifas ki apwouve apre pwoteksyon ak preparasyon.', 'ar', 'مرش للأسطح الكبيرة المعتمدة بعد الحماية والتجهيز.'), 'paintbrush', 10),
    ('painting', 'drop-cloths-and-masking', jsonb_build_object('en', 'Drop Cloths & Masking Supplies', 'es', 'Lonas y suministros de protección', 'fr', 'Bâches et fournitures de masquage', 'ht', 'Twal pwoteksyon ak materyèl kouvèti', 'ar', 'أغطية ومواد حماية'), jsonb_build_object('en', 'Protective supplies for keeping customer spaces clean during painting.', 'es', 'Suministros de protección para mantener limpios los espacios del cliente durante la pintura.', 'fr', 'Fournitures de protection pour garder les espaces du client propres pendant la peinture.', 'ht', 'Materyèl pwoteksyon pou kenbe espas kliyan an pwòp pandan penti.', 'ar', 'مواد حماية للحفاظ على نظافة مساحة العميل أثناء الطلاء.'), 'paintbrush', 20),
    ('painting', 'drywall-sanding-kit', jsonb_build_object('en', 'Drywall Sanding Kit', 'es', 'Kit para lijar yeso', 'fr', 'Kit de ponçage de cloisons sèches', 'ht', 'Twous lisaj mi sèk', 'ar', 'عدة صنفرة الجدران الجافة'), jsonb_build_object('en', 'Sanding tools for preparing minor wall repairs before painting.', 'es', 'Herramientas de lijado para preparar reparaciones menores antes de pintar.', 'fr', 'Outils de ponçage pour préparer les petites réparations murales avant peinture.', 'ht', 'Zouti lisaj pou prepare ti reparasyon mi anvan penti.', 'ar', 'أدوات صنفرة لتجهيز إصلاحات الجدران البسيطة قبل الطلاء.'), 'paintbrush', 30),
    ('landscaping', 'string-trimmer', jsonb_build_object('en', 'String Trimmer', 'es', 'Desbrozadora', 'fr', 'Coupe-bordures', 'ht', 'Koupe zèb ak fil', 'ar', 'آلة تشذيب العشب'), jsonb_build_object('en', 'Trimmer for lawn edges and routine vegetation maintenance.', 'es', 'Desbrozadora para bordes del césped y mantenimiento habitual de la vegetación.', 'fr', 'Coupe-bordures pour les bordures de pelouse et l’entretien courant de la végétation.', 'ht', 'Koupe zèb pou bò gazon ak antretyen vejetasyon regilye.', 'ar', 'آلة لتشذيب حواف العشب وصيانة النباتات المعتادة.'), 'trees', 10),
    ('landscaping', 'leaf-blower', jsonb_build_object('en', 'Leaf Blower', 'es', 'Soplador de hojas', 'fr', 'Souffleur de feuilles', 'ht', 'Souflè fèy', 'ar', 'منفاخ أوراق'), jsonb_build_object('en', 'Blower for clearing leaves and light yard debris after service.', 'es', 'Soplador para retirar hojas y residuos ligeros del jardín después del servicio.', 'fr', 'Souffleur pour retirer les feuilles et petits débris après le service.', 'ht', 'Souflè pou retire fèy ak ti debri nan lakou apre sèvis la.', 'ar', 'منفاخ لإزالة الأوراق والحطام الخفيف من الساحة بعد الخدمة.'), 'trees', 20),
    ('landscaping', 'wheelbarrow', jsonb_build_object('en', 'Wheelbarrow', 'es', 'Carretilla', 'fr', 'Brouette', 'ht', 'Brouèt', 'ar', 'عربة يدوية'), jsonb_build_object('en', 'Transport equipment for mulch, soil, and cleanup materials.', 'es', 'Equipo de transporte para mantillo, tierra y materiales de limpieza.', 'fr', 'Équipement de transport pour le paillage, la terre et les matériaux de nettoyage.', 'ht', 'Ekipman transpò pou payi, tè ak materyèl netwayaj.', 'ar', 'معدات لنقل النشارة والتربة ومواد التنظيف.'), 'trees', 30)
)
INSERT INTO direct_catalog_tools (
  category_slug,
  slug,
  name_i18n,
  description_i18n,
  icon_key,
  availability_days,
  available_days,
  sort_order,
  display_order,
  is_active,
  is_published,
  lifecycle_status,
  is_operationally_available,
  is_bookable,
  is_featured,
  published_at
)
SELECT
  seeded.category_slug,
  seeded.slug,
  seeded.name_i18n,
  seeded.description_i18n,
  seeded.icon_key,
  '["Monday", "Tuesday", "Wednesday", "Thursday"]'::jsonb,
  ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday']::TEXT[],
  seeded.display_order,
  seeded.display_order,
  TRUE,
  TRUE,
  'live',
  TRUE,
  FALSE,
  FALSE,
  CURRENT_TIMESTAMP
FROM seeded
ON CONFLICT (slug) DO UPDATE SET
  category_slug = EXCLUDED.category_slug,
  name_i18n = EXCLUDED.name_i18n,
  description_i18n = EXCLUDED.description_i18n,
  icon_key = EXCLUDED.icon_key,
  availability_days = EXCLUDED.availability_days,
  available_days = EXCLUDED.available_days,
  sort_order = EXCLUDED.sort_order,
  display_order = EXCLUDED.display_order,
  is_active = TRUE,
  is_published = TRUE,
  lifecycle_status = 'live',
  is_operationally_available = TRUE,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'tool', t.id, NULL, 'live', NULL, 'Published Direct starter tool inventory'
FROM direct_catalog_tools t
WHERE t.slug IN (
  'voltage-tester', 'wire-strippers', 'multimeter',
  'pipe-wrench-set', 'drain-snake', 'water-pressure-gauge',
  'miter-saw', 'stud-finder', 'orbital-sander',
  'airless-paint-sprayer', 'drop-cloths-and-masking', 'drywall-sanding-kit',
  'string-trimmer', 'leaf-blower', 'wheelbarrow'
)
AND NOT EXISTS (
  SELECT 1
  FROM catalog_status_history h
  WHERE h.item_type = 'tool' AND h.item_id = t.id
);
