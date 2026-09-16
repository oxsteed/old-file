-- Migration 523: publish the next starter services across every Direct skill.
-- All entries remain quote-based so final scope and price are confirmed before
-- work is accepted. Each published record includes the five supported locales.

WITH seeded(category_slug, slug, name_i18n, description_i18n, display_order) AS (
  VALUES
    (
      'electrical', 'ev-charger-installation',
      jsonb_build_object(
        'en', 'EV Charger Installation',
        'es', 'Instalación de cargador para vehículos eléctricos',
        'fr', 'Installation de borne de recharge pour véhicule électrique',
        'ht', 'Enstalasyon chajè machin elektrik',
        'ar', 'تركيب شاحن للسيارات الكهربائية'
      ),
      jsonb_build_object(
        'en', 'Install or prepare an EV charger after an electrical-site review.',
        'es', 'Instalación o preparación de un cargador para vehículos eléctricos después de revisar el sitio eléctrico.',
        'fr', 'Installez ou préparez une borne après une vérification électrique du site.',
        'ht', 'Enstale oswa prepare yon chajè apre yon verifikasyon sit elektrik la.',
        'ar', 'تركيب أو تجهيز شاحن بعد مراجعة الموقع الكهربائي.'
      ), 60
    ),
    (
      'electrical', 'generator-installation',
      jsonb_build_object(
        'en', 'Generator Installation',
        'es', 'Instalación de generador',
        'fr', 'Installation de générateur',
        'ht', 'Enstalasyon jeneratè',
        'ar', 'تركيب مولد كهربائي'
      ),
      jsonb_build_object(
        'en', 'Prepare a generator installation quote after reviewing the property and load.',
        'es', 'Prepara una cotización para instalar un generador después de revisar la propiedad y la carga.',
        'fr', 'Préparez un devis d’installation de générateur après examen de la propriété et de la charge.',
        'ht', 'Prepare yon estimasyon pou enstale yon jeneratè apre revize pwopriyete a ak chaj la.',
        'ar', 'إعداد عرض لتركيب مولد بعد مراجعة العقار والحمل الكهربائي.'
      ), 70
    ),
    (
      'electrical', 'smart-home-wiring',
      jsonb_build_object(
        'en', 'Smart Home Wiring',
        'es', 'Cableado para hogar inteligente',
        'fr', 'Câblage pour maison connectée',
        'ht', 'Fil elektrik pou kay entelijan',
        'ar', 'تمديدات المنزل الذكي'
      ),
      jsonb_build_object(
        'en', 'Plan and install wiring for compatible smart-home devices.',
        'es', 'Planifica e instala el cableado para dispositivos compatibles de hogar inteligente.',
        'fr', 'Planifiez et installez le câblage pour les appareils compatibles de maison connectée.',
        'ht', 'Planifye epi enstale fil elektrik pou aparèy kay entelijan ki konpatib.',
        'ar', 'تخطيط وتركيب تمديدات للأجهزة المتوافقة مع المنزل الذكي.'
      ), 80
    ),
    (
      'plumbing', 'leak-repair',
      jsonb_build_object(
        'en', 'Leak Repair',
        'es', 'Reparación de fugas',
        'fr', 'Réparation de fuites',
        'ht', 'Reparasyon fuit',
        'ar', 'إصلاح التسربات'
      ),
      jsonb_build_object(
        'en', 'Locate and repair common water leaks after an on-site assessment.',
        'es', 'Localiza y repara fugas comunes de agua después de una evaluación en el sitio.',
        'fr', 'Localisez et réparez les fuites d’eau courantes après une évaluation sur place.',
        'ht', 'Jwenn epi repare fuit dlo komen apre yon evalyasyon sou plas.',
        'ar', 'تحديد وإصلاح تسربات المياه الشائعة بعد تقييم موقعي.'
      ), 60
    ),
    (
      'plumbing', 'drain-cleaning',
      jsonb_build_object(
        'en', 'Drain Cleaning',
        'es', 'Limpieza de desagües',
        'fr', 'Nettoyage de canalisations',
        'ht', 'Netwayaj drenaj',
        'ar', 'تنظيف المصارف'
      ),
      jsonb_build_object(
        'en', 'Clear a household drain and identify conditions that need additional work.',
        'es', 'Limpia un desagüe doméstico e identifica condiciones que requieren trabajo adicional.',
        'fr', 'Débouchez une canalisation domestique et identifiez les problèmes nécessitant des travaux supplémentaires.',
        'ht', 'Netwaye yon drenaj kay epi idantifye pwoblèm ki bezwen plis travay.',
        'ar', 'تنظيف مصرف منزلي وتحديد الحالات التي تحتاج إلى عمل إضافي.'
      ), 70
    ),
    (
      'plumbing', 'water-heater-service',
      jsonb_build_object(
        'en', 'Water Heater Service',
        'es', 'Servicio de calentador de agua',
        'fr', 'Service de chauffe-eau',
        'ht', 'Sèvis chofè dlo',
        'ar', 'خدمة سخان المياه'
      ),
      jsonb_build_object(
        'en', 'Inspect, troubleshoot, or prepare a water-heater service quote.',
        'es', 'Inspecciona, diagnostica o prepara una cotización para el servicio del calentador de agua.',
        'fr', 'Inspectez, diagnostiquez ou préparez un devis pour un chauffe-eau.',
        'ht', 'Enspekte, chèche pwoblèm oswa prepare yon estimasyon pou sèvis chofè dlo.',
        'ar', 'فحص سخان المياه أو تشخيصه أو إعداد عرض لخدمته.'
      ), 80
    ),
    (
      'carpentry', 'door-repair-and-installation',
      jsonb_build_object(
        'en', 'Door Repair & Installation',
        'es', 'Reparación e instalación de puertas',
        'fr', 'Réparation et installation de portes',
        'ht', 'Reparasyon ak enstalasyon pòt',
        'ar', 'إصلاح وتركيب الأبواب'
      ),
      jsonb_build_object(
        'en', 'Repair, adjust, or install interior and exterior doors.',
        'es', 'Repara, ajusta o instala puertas interiores y exteriores.',
        'fr', 'Réparez, ajustez ou installez des portes intérieures et extérieures.',
        'ht', 'Repare, ajiste oswa enstale pòt andedan ak deyò.',
        'ar', 'إصلاح أو ضبط أو تركيب الأبواب الداخلية والخارجية.'
      ), 60
    ),
    (
      'carpentry', 'trim-and-molding',
      jsonb_build_object(
        'en', 'Trim & Molding',
        'es', 'Molduras y acabados',
        'fr', 'Garnitures et moulures',
        'ht', 'Fini ak moulaj',
        'ar', 'الحواف والقوالب الخشبية'
      ),
      jsonb_build_object(
        'en', 'Install or repair baseboards, casing, and other interior trim.',
        'es', 'Instala o repara zócalos, marcos y otros acabados interiores.',
        'fr', 'Installez ou réparez les plinthes, encadrements et autres garnitures intérieures.',
        'ht', 'Enstale oswa repare plint, ankadreman ak lòt fini andedan.',
        'ar', 'تركيب أو إصلاح الألواح السفلية والإطارات وغيرها من التشطيبات الداخلية.'
      ), 70
    ),
    (
      'carpentry', 'deck-repair',
      jsonb_build_object(
        'en', 'Deck Repair',
        'es', 'Reparación de terrazas',
        'fr', 'Réparation de terrasses',
        'ht', 'Reparasyon galri',
        'ar', 'إصلاح الأسطح الخشبية الخارجية'
      ),
      jsonb_build_object(
        'en', 'Inspect and repair common deck boards, rails, and steps.',
        'es', 'Inspecciona y repara tablas, barandillas y escalones comunes de terrazas.',
        'fr', 'Inspectez et réparez les planches, rampes et marches courantes d’une terrasse.',
        'ht', 'Enspekte epi repare planch, ranp ak mach galri ki komen.',
        'ar', 'فحص وإصلاح ألواح الأسطح الخشبية والدرابزين والدرجات الشائعة.'
      ), 80
    ),
    (
      'painting', 'interior-room-painting',
      jsonb_build_object(
        'en', 'Interior Room Painting',
        'es', 'Pintura de habitaciones interiores',
        'fr', 'Peinture de pièces intérieures',
        'ht', 'Penti chanm andedan',
        'ar', 'طلاء الغرف الداخلية'
      ),
      jsonb_build_object(
        'en', 'Prepare and paint an interior room after confirming surfaces and colors.',
        'es', 'Prepara y pinta una habitación interior después de confirmar las superficies y los colores.',
        'fr', 'Préparez et peignez une pièce après confirmation des surfaces et des couleurs.',
        'ht', 'Prepare epi penti yon chanm apre konfime sifas yo ak koulè yo.',
        'ar', 'تجهيز وطلاء غرفة داخلية بعد تأكيد الأسطح والألوان.'
      ), 60
    ),
    (
      'painting', 'exterior-painting',
      jsonb_build_object(
        'en', 'Exterior Painting',
        'es', 'Pintura exterior',
        'fr', 'Peinture extérieure',
        'ht', 'Penti deyò',
        'ar', 'الطلاء الخارجي'
      ),
      jsonb_build_object(
        'en', 'Prepare and paint approved exterior surfaces after a condition review.',
        'es', 'Prepara y pinta superficies exteriores aprobadas después de revisar su estado.',
        'fr', 'Préparez et peignez les surfaces extérieures approuvées après examen de leur état.',
        'ht', 'Prepare epi penti sifas deyò ki apwouve apre revize kondisyon yo.',
        'ar', 'تجهيز وطلاء الأسطح الخارجية المعتمدة بعد مراجعة حالتها.'
      ), 70
    ),
    (
      'painting', 'drywall-and-paint-repair',
      jsonb_build_object(
        'en', 'Drywall & Paint Repair',
        'es', 'Reparación de yeso y pintura',
        'fr', 'Réparation de cloisons sèches et peinture',
        'ht', 'Reparasyon mi sèk ak penti',
        'ar', 'إصلاح الجدران الجافة والطلاء'
      ),
      jsonb_build_object(
        'en', 'Patch minor wall damage and blend the repaired paint area.',
        'es', 'Repara daños menores en la pared y combina la zona de pintura reparada.',
        'fr', 'Réparez les petits dommages muraux et raccordez la zone repeinte.',
        'ht', 'Repare ti domaj sou mi a epi melanje zòn yo repenti a.',
        'ar', 'ترميم أضرار الجدران البسيطة ودمج منطقة الطلاء التي تم إصلاحها.'
      ), 80
    ),
    (
      'landscaping', 'lawn-mowing',
      jsonb_build_object(
        'en', 'Lawn Mowing',
        'es', 'Corte de césped',
        'fr', 'Tonte de pelouse',
        'ht', 'Koupe gazon',
        'ar', 'قص العشب'
      ),
      jsonb_build_object(
        'en', 'Mow and tidy an established residential lawn within the service area.',
        'es', 'Corta y arregla un césped residencial establecido dentro del área de servicio.',
        'fr', 'Tondez et entretenez une pelouse résidentielle établie dans la zone desservie.',
        'ht', 'Koupe epi netwaye yon gazon rezidansyèl ki deja etabli nan zòn sèvis la.',
        'ar', 'قص وترتيب عشب سكني قائم ضمن منطقة الخدمة.'
      ), 60
    ),
    (
      'landscaping', 'mulch-and-garden-beds',
      jsonb_build_object(
        'en', 'Mulch & Garden Beds',
        'es', 'Mantillo y parterres',
        'fr', 'Paillage et massifs de jardin',
        'ht', 'Payi ak kabann jaden',
        'ar', 'النشارة وأحواض الحدائق'
      ),
      jsonb_build_object(
        'en', 'Refresh garden beds with agreed mulch, edging, and cleanup.',
        'es', 'Renueva los parterres con mantillo, bordes y limpieza acordados.',
        'fr', 'Rafraîchissez les massifs avec le paillage, les bordures et le nettoyage convenus.',
        'ht', 'Renouvle kabann jaden yo ak payi, rebò ak netwayaj yo dakò sou yo.',
        'ar', 'تجديد أحواض الحدائق بالنشارة والحواف والتنظيف المتفق عليها.'
      ), 70
    ),
    (
      'landscaping', 'hedge-and-shrub-trimming',
      jsonb_build_object(
        'en', 'Hedge & Shrub Trimming',
        'es', 'Recorte de setos y arbustos',
        'fr', 'Taille des haies et arbustes',
        'ht', 'Koupe lantiy ak touf',
        'ar', 'تشذيب الشجيرات والأسيجة'
      ),
      jsonb_build_object(
        'en', 'Trim and clean up established hedges and shrubs within the service area.',
        'es', 'Recorta y limpia setos y arbustos establecidos dentro del área de servicio.',
        'fr', 'Taillez et nettoyez les haies et arbustes établis dans la zone desservie.',
        'ht', 'Koupe epi netwaye lantiy ak touf ki deja etabli nan zòn sèvis la.',
        'ar', 'تشذيب وتنظيف الشجيرات والأسيجة القائمة ضمن منطقة الخدمة.'
      ), 80
    )
)
INSERT INTO direct_catalog_services (
  category_id,
  slug,
  name_i18n,
  description_i18n,
  price_cents,
  currency_code,
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
  c.id,
  seeded.slug,
  seeded.name_i18n,
  seeded.description_i18n,
  NULL,
  'USD',
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
JOIN direct_catalog_categories c ON c.slug = seeded.category_slug
ON CONFLICT (slug) DO NOTHING;

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'service', s.id, NULL, 'live', NULL, 'Published Direct starter catalog expansion'
FROM direct_catalog_services s
WHERE s.slug IN (
  'ev-charger-installation', 'generator-installation', 'smart-home-wiring',
  'leak-repair', 'drain-cleaning', 'water-heater-service',
  'door-repair-and-installation', 'trim-and-molding', 'deck-repair',
  'interior-room-painting', 'exterior-painting', 'drywall-and-paint-repair',
  'lawn-mowing', 'mulch-and-garden-beds', 'hedge-and-shrub-trimming'
)
AND NOT EXISTS (
  SELECT 1
  FROM catalog_status_history h
  WHERE h.item_type = 'service' AND h.item_id = s.id
);
