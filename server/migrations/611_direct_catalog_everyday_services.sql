-- Migration 611: expand the Direct catalog into everyday house, car, and tech services.
-- Adds 8 published categories (appliance repair, heating & cooling, home cleaning,
-- pest control, locksmith, moving & furniture, car care & repair, tech support) and
-- 40 quote-based services (price_cents NULL) with complete five-locale names and
-- descriptions. All entries are quote-based so final scope and price are confirmed
-- before work is accepted, matching migration 523. Existing rows are never
-- overwritten (ON CONFLICT DO NOTHING).

INSERT INTO direct_catalog_categories (
  slug,
  name_i18n,
  icon_key,
  sort_order,
  display_order,
  is_active,
  is_published,
  lifecycle_status,
  is_operationally_available,
  is_bookable,
  published_at
)
VALUES
  ('appliances', '{"en":"Appliance Repair","es":"Reparación de electrodomésticos","fr":"Réparation des appareils électroménagers","ht":"Reparasyon aparèy elektwomenaje","ar":"إصلاح الأجهزة المنزلية"}'::jsonb, 'refrigerator', 60, 60, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('hvac', '{"en":"Heating & Cooling","es":"Calefacción y aire acondicionado","fr":"Chauffage et climatisation","ht":"Chofaj ak klimatizasyon","ar":"التدفئة والتبريد"}'::jsonb, 'air-vent', 70, 70, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('cleaning', '{"en":"Home Cleaning","es":"Limpieza del hogar","fr":"Nettoyage domestique","ht":"Netwayaj kay","ar":"تنظيف المنازل"}'::jsonb, 'sparkles', 80, 80, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('pest-control', '{"en":"Pest Control","es":"Control de plagas","fr":"Lutte antiparasitaire","ht":"Kontwòl ensèk nuizib","ar":"مكافحة الحشرات"}'::jsonb, 'bug', 90, 90, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('locksmith', '{"en":"Locksmith","es":"Cerrajería","fr":"Serrurerie","ht":"Seruri","ar":"خدمات الأقفال"}'::jsonb, 'key-round', 100, 100, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('moving', '{"en":"Moving & Furniture","es":"Mudanzas y muebles","fr":"Déménagement et meubles","ht":"Demenajman ak mèb","ar":"النقل والأثاث"}'::jsonb, 'package', 110, 110, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('automotive', '{"en":"Car Care & Repair","es":"Cuidado y reparación de autos","fr":"Entretien et réparation automobile","ht":"Antretyen ak reparasyon machin","ar":"صيانة وإصلاح السيارات"}'::jsonb, 'car', 120, 120, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('tech-support', '{"en":"Tech Support","es":"Soporte técnico","fr":"Assistance technique","ht":"Sipò teknik","ar":"الدعم التقني"}'::jsonb, 'monitor-smartphone', 130, 130, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

WITH seeded(category_slug, slug, name_i18n, description_i18n, display_order) AS (
  VALUES
    -- Appliance Repair
    (
      'appliances', 'refrigerator-repair',
      jsonb_build_object(
        'en', 'Refrigerator Repair',
        'es', 'Reparación de refrigeradores',
        'fr', 'Réparation de réfrigérateurs',
        'ht', 'Reparasyon frijidè',
        'ar', 'إصلاح الثلاجات'
      ),
      jsonb_build_object(
        'en', 'Diagnose and repair a refrigerator that is not cooling properly, with a quote before work begins.',
        'es', 'Diagnostica y repara un refrigerador que no enfría bien, con cotización antes de comenzar el trabajo.',
        'fr', 'Diagnostiquez et réparez un réfrigérateur qui ne refroidit pas correctement, avec un devis avant le début des travaux.',
        'ht', 'Dyagnostike epi repare yon frijidè ki pa refwadi byen, ak yon estimasyon anvan travay la kòmanse.',
        'ar', 'تشخيص وإصلاح الثلاجة التي لا تبرد بشكل صحيح، مع عرض سعر قبل بدء العمل.'
      ), 10
    ),
    (
      'appliances', 'washer-dryer-repair',
      jsonb_build_object(
        'en', 'Washer & Dryer Repair',
        'es', 'Reparación de lavadoras y secadoras',
        'fr', 'Réparation de lave-linge et sèche-linge',
        'ht', 'Reparasyon machin lave ak sechwa',
        'ar', 'إصلاح الغسالات والمجففات'
      ),
      jsonb_build_object(
        'en', 'Fix a washer or dryer that will not start, drain, spin, or heat, with a quote before work begins.',
        'es', 'Repara una lavadora o secadora que no enciende, no drena, no centrifuga o no calienta, con cotización antes de comenzar.',
        'fr', 'Réparez un lave-linge ou un sèche-linge qui ne démarre pas, ne vidange pas, ne essore pas ou ne chauffe pas, avec un devis avant les travaux.',
        'ht', 'Repare yon machin lave oswa sechwa ki pa limen, pa vide dlo, pa vire, oswa pa chofe, ak yon estimasyon anvan travay la.',
        'ar', 'إصلاح الغسالة أو المجفف الذي لا يعمل أو لا يصرف الماء أو لا يسخن، مع عرض سعر قبل بدء العمل.'
      ), 20
    ),
    (
      'appliances', 'oven-stove-repair',
      jsonb_build_object(
        'en', 'Oven & Stove Repair',
        'es', 'Reparación de hornos y estufas',
        'fr', 'Réparation de fours et cuisinières',
        'ht', 'Reparasyon fou ak recho',
        'ar', 'إصلاح الأفران والمواقد'
      ),
      jsonb_build_object(
        'en', 'Repair an oven or stovetop with uneven heat, faulty burners, or broken controls, with a quote before work begins.',
        'es', 'Repara un horno o estufa con calor desigual, quemadores defectuosos o controles dañados, con cotización previa.',
        'fr', 'Réparez un four ou une cuisinière à chaleur inégale, brûleurs défectueux ou commandes cassées, avec devis préalable.',
        'ht', 'Repare yon fou oswa recho ki pa chofe byen, ki gen bouch ki pa mache, oswa kontwòl ki kase, ak estimasyon anvan.',
        'ar', 'إصلاح الفرن أو الموقد الذي يعاني من حرارة غير متساوية أو شعلات معطلة، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'appliances', 'dishwasher-repair',
      jsonb_build_object(
        'en', 'Dishwasher Repair',
        'es', 'Reparación de lavavajillas',
        'fr', 'Réparation de lave-vaisselle',
        'ht', 'Reparasyon machin lave vesèl',
        'ar', 'إصلاح غسالات الأطباق'
      ),
      jsonb_build_object(
        'en', 'Fix a dishwasher that leaks, will not drain, or leaves dishes dirty, with a quote before work begins.',
        'es', 'Repara un lavavajillas con fugas, que no drena o deja los platos sucios, con cotización previa.',
        'fr', 'Réparez un lave-vaisselle qui fuit, ne vidange pas ou laisse la vaisselle sale, avec devis préalable.',
        'ht', 'Repare yon machin lave vesèl ki koule, ki pa vide dlo, oswa ki kite vesèl yo sal, ak estimasyon anvan.',
        'ar', 'إصلاح غسالة الأطباق التي تسرب الماء أو لا تصرفه أو تترك الأطباق متسخة، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'appliances', 'microwave-repair',
      jsonb_build_object(
        'en', 'Microwave Repair',
        'es', 'Reparación de microondas',
        'fr', 'Réparation de micro-ondes',
        'ht', 'Reparasyon mikwo ond',
        'ar', 'إصلاح الميكروويف'
      ),
      jsonb_build_object(
        'en', 'Repair a microwave that will not heat, has a broken door, or sparks inside, with a quote before work begins.',
        'es', 'Repara un microondas que no calienta, tiene la puerta rota o produce chispas, con cotización previa.',
        'fr', 'Réparez un micro-ondes qui ne chauffe pas, dont la porte est cassée ou qui produit des étincelles, avec devis préalable.',
        'ht', 'Repare yon mikwo ond ki pa chofe, ki gen pòt kase, oswa ki fè etensèl anndan, ak estimasyon anvan.',
        'ar', 'إصلاح الميكروويف الذي لا يسخن أو بابه مكسور أو يصدر شرارات، مع عرض سعر مسبق.'
      ), 50
    ),
    -- Heating & Cooling
    (
      'hvac', 'ac-repair',
      jsonb_build_object(
        'en', 'AC Repair',
        'es', 'Reparación de aire acondicionado',
        'fr', 'Réparation de climatiseurs',
        'ht', 'Reparasyon klimatizè',
        'ar', 'إصلاح مكيفات الهواء'
      ),
      jsonb_build_object(
        'en', 'Diagnose and repair an air conditioner that is not cooling, leaking, or blowing warm air, with a quote before work begins.',
        'es', 'Diagnostica y repara un aire acondicionado que no enfría, gotea o sopla aire caliente, con cotización previa.',
        'fr', 'Diagnostiquez et réparez un climatiseur qui ne refroidit pas, fuit ou souffle un air chaud, avec devis préalable.',
        'ht', 'Dyagnostike epi repare yon klimatizè ki pa refwadi, k ap koule, oswa k ap soufle lè cho, ak estimasyon anvan.',
        'ar', 'تشخيص وإصلاح مكيف الهواء الذي لا يبرد أو يسرب الماء أو ينفث هواء ساخنا، مع عرض سعر مسبق.'
      ), 10
    ),
    (
      'hvac', 'furnace-repair',
      jsonb_build_object(
        'en', 'Furnace & Heater Repair',
        'es', 'Reparación de calefacción',
        'fr', 'Réparation de chaudières et chauffages',
        'ht', 'Reparasyon chofaj',
        'ar', 'إصلاح أنظمة التدفئة'
      ),
      jsonb_build_object(
        'en', 'Repair a furnace or heater that will not start, cycles constantly, or heats unevenly, with a quote before work begins.',
        'es', 'Repara una caldera o calefactor que no enciende, se enciende y apaga sin parar o calienta de forma desigual, con cotización previa.',
        'fr', 'Réparez une chaudière ou un chauffage qui ne démarre pas, fonctionne sans arrêt ou chauffe de façon inégale, avec devis préalable.',
        'ht', 'Repare yon chofaj ki pa limen, k ap limen etenn san rete, oswa ki pa chofe tout kay la menm jan, ak estimasyon anvan.',
        'ar', 'إصلاح نظام التدفئة الذي لا يعمل أو يعمل باستمرار أو يسخن بشكل غير متساو، مع عرض سعر مسبق.'
      ), 20
    ),
    (
      'hvac', 'thermostat-installation',
      jsonb_build_object(
        'en', 'Thermostat Installation',
        'es', 'Instalación de termostatos',
        'fr', 'Installation de thermostats',
        'ht', 'Enstalasyon tèmosta',
        'ar', 'تركيب منظمات الحرارة'
      ),
      jsonb_build_object(
        'en', 'Install or replace a thermostat, including smart and programmable models, with a quote before work begins.',
        'es', 'Instala o reemplaza un termostato, incluidos modelos inteligentes y programables, con cotización previa.',
        'fr', 'Installez ou remplacez un thermostat, y compris les modèles intelligents et programmables, avec devis préalable.',
        'ht', 'Enstale oswa ranplase yon tèmosta, enkli modèl entelijan ak pwogramab, ak estimasyon anvan.',
        'ar', 'تركيب أو استبدال منظم الحرارة بما في ذلك الطرازات الذكية والقابلة للبرمجة، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'hvac', 'duct-cleaning',
      jsonb_build_object(
        'en', 'Duct Cleaning',
        'es', 'Limpieza de conductos',
        'fr', 'Nettoyage de conduits de ventilation',
        'ht', 'Netwayaj kanal vantilasyon',
        'ar', 'تنظيف مجاري الهواء'
      ),
      jsonb_build_object(
        'en', 'Clean air ducts and vents to improve airflow and indoor air quality, with a quote before work begins.',
        'es', 'Limpia los conductos y rejillas de ventilación para mejorar el flujo de aire y la calidad del aire interior, con cotización previa.',
        'fr', 'Nettoyez les conduits et bouches de ventilation pour une maison mieux ventilée et un air intérieur plus sain, avec devis préalable.',
        'ht', 'Netwaye kanal ak bouch vantilasyon pou amelyore sikilasyon lè a ak kalite lè anndan kay la, ak estimasyon anvan.',
        'ar', 'تنظيف مجاري الهواء وفتحات التهوية لتحسين تدفق الهواء وجودته داخل المنزل، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'hvac', 'hvac-seasonal-maintenance',
      jsonb_build_object(
        'en', 'HVAC Seasonal Maintenance',
        'es', 'Mantenimiento estacional de climatización',
        'fr', 'Entretien saisonnier de chauffage et climatisation',
        'ht', 'Antretyen sezonye sistèm chofaj ak klimatizasyon',
        'ar', 'الصيانة الموسمية لأنظمة التكييف'
      ),
      jsonb_build_object(
        'en', 'Seasonal tune-up and filter service for heating and cooling systems, with a quote before work begins.',
        'es', 'Puesta a punto estacional y servicio de filtros para sistemas de calefacción y refrigeración, con cotización previa.',
        'fr', 'Révision saisonnière et entretien des filtres pour les systèmes de chauffage et de climatisation, avec devis préalable.',
        'ht', 'Reglaj sezonye ak sèvis filtè pou sistèm chofaj ak klimatizasyon, ak estimasyon anvan.',
        'ar', 'ضبط موسمي وخدمة فلاتر لأنظمة التدفئة والتبريد، مع عرض سعر مسبق.'
      ), 50
    ),
    -- Home Cleaning
    (
      'cleaning', 'recurring-house-cleaning',
      jsonb_build_object(
        'en', 'Recurring House Cleaning',
        'es', 'Limpieza recurrente del hogar',
        'fr', 'Ménage récurrent à domicile',
        'ht', 'Netwayaj kay regilye',
        'ar', 'تنظيف منزلي دوري'
      ),
      jsonb_build_object(
        'en', 'Regular scheduled cleaning for kitchens, bathrooms, bedrooms, and living areas, with a quote before service begins.',
        'es', 'Limpieza programada regular de cocinas, baños, dormitorios y salas, con cotización antes de comenzar.',
        'fr', 'Nettoyage régulier planifié des cuisines, salles de bain, chambres et pièces à vivre, avec devis avant le service.',
        'ht', 'Netwayaj regilye pwograme pou kwizin, twalèt, chanm, ak salon, ak estimasyon anvan sèvis la kòmanse.',
        'ar', 'تنظيف مجدول منتظم للمطابخ والحمامات وغرف النوم والمعيشة، مع عرض سعر قبل بدء الخدمة.'
      ), 10
    ),
    (
      'cleaning', 'deep-cleaning',
      jsonb_build_object(
        'en', 'Deep Cleaning',
        'es', 'Limpieza profunda',
        'fr', 'Grand nettoyage en profondeur',
        'ht', 'Gwo netwayaj',
        'ar', 'تنظيف عميق'
      ),
      jsonb_build_object(
        'en', 'Detailed top-to-bottom cleaning including baseboards, grout, fixtures, and hard-to-reach areas, with a quote before service begins.',
        'es', 'Limpieza detallada de arriba a abajo, incluidos zócalos, juntas, grifería y áreas difíciles, con cotización previa.',
        'fr', 'Nettoyage détaillé complet, y compris plinthes, joints, robinetterie et zones peu accessibles, avec devis préalable.',
        'ht', 'Netwayaj detaye de anwo jouk anba, enkli baz mi, jwenti, wobinè, ak kote ki difisil pou rive, ak estimasyon anvan.',
        'ar', 'تنظيف تفصيلي شامل يشمل الحواف والفواصل والتركيبات والأماكن صعبة الوصول، مع عرض سعر مسبق.'
      ), 20
    ),
    (
      'cleaning', 'move-in-out-cleaning',
      jsonb_build_object(
        'en', 'Move-In / Move-Out Cleaning',
        'es', 'Limpieza de mudanza',
        'fr', 'Nettoyage avant emménagement ou après déménagement',
        'ht', 'Netwayaj anvan ou apre demenajman',
        'ar', 'تنظيف ما قبل وبعد الانتقال'
      ),
      jsonb_build_object(
        'en', 'Full cleaning of an empty home before moving in or after moving out, with a quote before service begins.',
        'es', 'Limpieza completa de una vivienda vacía antes de mudarse o después de hacerlo, con cotización previa.',
        'fr', 'Nettoyage complet du logement vide avant votre emménagement ou après votre déménagement, avec devis préalable.',
        'ht', 'Netwayaj konplè yon kay vid anvan ou antre ladan oswa apre ou kite l, ak estimasyon anvan.',
        'ar', 'تنظيف كامل لمنزل فارغ قبل الانتقال إليه أو بعده، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'cleaning', 'carpet-upholstery-cleaning',
      jsonb_build_object(
        'en', 'Carpet & Upholstery Cleaning',
        'es', 'Limpieza de alfombras y tapicería',
        'fr', 'Nettoyage de tapis et tissus',
        'ht', 'Netwayaj tapi ak mèb twal',
        'ar', 'تنظيف السجاد والمفروشات'
      ),
      jsonb_build_object(
        'en', 'Deep extraction cleaning for carpets, rugs, and upholstered furniture, with a quote before service begins.',
        'es', 'Limpieza profunda por extracción para alfombras, tapetes y muebles tapizados, con cotización previa.',
        'fr', 'Nettoyage en profondeur par extraction pour tapis, moquettes et meubles rembourrés, avec devis préalable.',
        'ht', 'Netwayaj pwofon pa ekstraksyon pou tapi, kapèt, ak mèb ki kouvri ak twal, ak estimasyon anvan.',
        'ar', 'تنظيف عميق بالاستخلاص للسجاد والموكيت والأثاث المنجد، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'cleaning', 'window-cleaning',
      jsonb_build_object(
        'en', 'Window Cleaning',
        'es', 'Limpieza de ventanas',
        'fr', 'Nettoyage de vitres',
        'ht', 'Netwayaj fenèt',
        'ar', 'تنظيف النوافذ'
      ),
      jsonb_build_object(
        'en', 'Streak-free interior and exterior window cleaning, including screens on request, with a quote before service begins.',
        'es', 'Limpieza de ventanas interiores y exteriores sin marcas, incluidos mosquiteros a petición, con cotización previa.',
        'fr', 'Nettoyage sans traces des vitres intérieures et extérieures, moustiquaires sur demande, avec devis préalable.',
        'ht', 'Netwayaj fenèt anndan ak deyò san tras, enkli moustikè si ou mande, ak estimasyon anvan.',
        'ar', 'تنظيف النوافذ من الداخل والخارج بدون خطوط، بما في ذلك الشبك عند الطلب، مع عرض سعر مسبق.'
      ), 50
    ),
    -- Pest Control
    (
      'pest-control', 'general-pest-treatment',
      jsonb_build_object(
        'en', 'General Pest Treatment',
        'es', 'Tratamiento general de plagas',
        'fr', 'Traitement général contre les nuisibles',
        'ht', 'Tretman jeneral kont ensèk nuizib',
        'ar', 'مكافحة عامة للحشرات'
      ),
      jsonb_build_object(
        'en', 'Treat ants, roaches, spiders, and other common household pests, with a quote before service begins.',
        'es', 'Trata hormigas, cucarachas, arañas y otras plagas domésticas comunes, con cotización previa.',
        'fr', 'Traitez fourmis, cafards, araignées et autres parasites domestiques courants, avec devis préalable.',
        'ht', 'Trete foumi, ravèt, areye, ak lòt ensèk nuizib kay komen, ak estimasyon anvan.',
        'ar', 'مكافحة النمل والصراصير والعناكب وغيرها من حشرات المنازل الشائعة، مع عرض سعر مسبق.'
      ), 10
    ),
    (
      'pest-control', 'termite-inspection',
      jsonb_build_object(
        'en', 'Termite Inspection & Treatment',
        'es', 'Inspección y tratamiento de termitas',
        'fr', 'Inspection et traitement contre les termites',
        'ht', 'Enspeksyon ak tretman termit',
        'ar', 'فحص ومكافحة النمل الأبيض'
      ),
      jsonb_build_object(
        'en', 'Inspect for termites and treat active infestations to protect wood structures, with a quote before service begins.',
        'es', 'Inspecciona termitas y trata infestaciones activas para proteger estructuras de madera, con cotización previa.',
        'fr', 'Inspectez les termites et traitez les infestations actives pour protéger les structures en bois, avec devis préalable.',
        'ht', 'Enspekte termit epi trete enfestasyon aktif pou pwoteje estrikti bwa, ak estimasyon anvan.',
        'ar', 'فحص النمل الأبيض ومكافحة الإصابات النشطة لحماية الهياكل الخشبية، مع عرض سعر مسبق.'
      ), 20
    ),
    (
      'pest-control', 'rodent-removal',
      jsonb_build_object(
        'en', 'Rodent Removal',
        'es', 'Eliminación de roedores',
        'fr', 'Élimination des rongeurs',
        'ht', 'Retire wonjè',
        'ar', 'إزالة القوارض'
      ),
      jsonb_build_object(
        'en', 'Remove mice and rats and seal common entry points, with a quote before service begins.',
        'es', 'Elimina ratones y ratas y sella los puntos de entrada comunes, con cotización previa.',
        'fr', 'Éliminez souris et rats et colmatez les accès habituels, avec devis préalable.',
        'ht', 'Retire sourit ak rat epi bouche kote yo konn antre, ak estimasyon anvan.',
        'ar', 'إزالة الفئران والجرذان وإغلاق نقاط الدخول الشائعة، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'pest-control', 'mosquito-treatment',
      jsonb_build_object(
        'en', 'Mosquito & Tick Treatment',
        'es', 'Tratamiento contra mosquitos y garrapatas',
        'fr', 'Traitement contre moustiques et tiques',
        'ht', 'Tretman kont moustik ak tik',
        'ar', 'مكافحة البعوض والقراد'
      ),
      jsonb_build_object(
        'en', 'Yard treatment to reduce mosquitoes and ticks around the home, with a quote before service begins.',
        'es', 'Tratamiento del jardín para reducir mosquitos y garrapatas alrededor del hogar, con cotización previa.',
        'fr', 'Traitement du jardin pour réduire moustiques et tiques autour de la maison, avec devis préalable.',
        'ht', 'Tretman lakou pou diminye moustik ak tik ozalantou kay la, ak estimasyon anvan.',
        'ar', 'معالجة الحديقة لتقليل البعوض والقراد حول المنزل، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'pest-control', 'bed-bug-treatment',
      jsonb_build_object(
        'en', 'Bed Bug Treatment',
        'es', 'Tratamiento contra chinches',
        'fr', 'Traitement contre les punaises de lit',
        'ht', 'Tretman kont pis lit',
        'ar', 'مكافحة بق الفراش'
      ),
      jsonb_build_object(
        'en', 'Inspect and treat bedrooms and furniture for bed bugs, with a quote before service begins.',
        'es', 'Inspecciona y trata dormitorios y muebles contra chinches, con cotización previa.',
        'fr', 'Inspectez et traitez chambres et meubles contre les punaises de lit, avec devis préalable.',
        'ht', 'Enspekte epi trete chanm ak mèb kont pis lit, ak estimasyon anvan.',
        'ar', 'فحص ومعالجة غرف النوم والأثاث ضد بق الفراش، مع عرض سعر مسبق.'
      ), 50
    )
    -- Locksmith
    (
      'locksmith', 'emergency-lockout-service',
      jsonb_build_object(
        'en', 'Emergency Lockout Service',
        'es', 'Apertura de emergencia',
        'fr', 'Ouverture de porte en urgence',
        'ht', 'Sèvis ijans lè pòt fèmen sou ou',
        'ar', 'خدمة فتح الأقفال الطارئة'
      ),
      jsonb_build_object(
        'en', 'Fast entry when locked out of home or car, without damage where possible, with a quote before service begins.',
        'es', 'Apertura rápida si te quedas fuera de casa o del auto, sin daños cuando sea posible, con cotización previa.',
        'fr', 'Ouverture rapide en cas de porte claquée, sans dégâts si possible, avec devis préalable.',
        'ht', 'Louvri pòt rapid lè ou rete deyò kay oswa machin, san domaj si posib, ak estimasyon anvan.',
        'ar', 'فتح سريع عند الانغلاق خارج المنزل أو السيارة دون إتلاف إن أمكن، مع عرض سعر مسبق.'
      ), 10
    ),
    (
      'locksmith', 'lock-replacement',
      jsonb_build_object(
        'en', 'Lock Replacement',
        'es', 'Reemplazo de cerraduras',
        'fr', 'Remplacement de serrures',
        'ht', 'Ranplasman kadna',
        'ar', 'استبدال الأقفال'
      ),
      jsonb_build_object(
        'en', 'Replace worn or damaged door locks and handles, with a quote before service begins.',
        'es', 'Reemplaza cerraduras y manijas desgastadas o dañadas, con cotización previa.',
        'fr', 'Remplacez serrures et poignées usées ou endommagées, avec devis préalable.',
        'ht', 'Ranplase kadna ak manch pòt ki ize oswa ki domaje, ak estimasyon anvan.',
        'ar', 'استبدال أقفال ومقابض الأبواب البالية أو التالفة، مع عرض سعر مسبق.'
      ), 20
    ),
    (
      'locksmith', 'home-rekeying',
      jsonb_build_object(
        'en', 'Home Rekeying',
        'es', 'Recodificación de cerraduras',
        'fr', 'Recodage de serrures à domicile',
        'ht', 'Chanje konbinezon kadna',
        'ar', 'إعادة ضبط الأقفال'
      ),
      jsonb_build_object(
        'en', 'Rekey existing locks so old keys no longer work, with a quote before service begins.',
        'es', 'Recodifica las cerraduras existentes para que las llaves viejas ya no funcionen, con cotización previa.',
        'fr', 'Recodez les serrures existantes pour que les anciennes clés ne fonctionnent plus, avec devis préalable.',
        'ht', 'Chanje konbinezon kadna ki deja enstale pou ansyen kle yo pa mache ankò, ak estimasyon anvan.',
        'ar', 'إعادة ضبط الأقفال الحالية بحيث لا تعمل المفاتيح القديمة، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'locksmith', 'deadbolt-installation',
      jsonb_build_object(
        'en', 'Deadbolt Installation',
        'es', 'Instalación de cerrojos',
        'fr', 'Installation de verrous de sûreté',
        'ht', 'Enstalasyon vewou sekirite',
        'ar', 'تركيب أقفال الأمان'
      ),
      jsonb_build_object(
        'en', 'Install new deadbolts on entry doors for added security, with a quote before service begins.',
        'es', 'Instala nuevos cerrojos en puertas de entrada para mayor seguridad, con cotización previa.',
        'fr', 'Installez de nouveaux verrous sur vos portes principales pour plus de sécurité, avec devis préalable.',
        'ht', 'Enstale nouvo vewou sekirite sou pòt antre pou plis pwoteksyon, ak estimasyon anvan.',
        'ar', 'تركيب أقفال أمان جديدة على أبواب المداخل لمزيد من الحماية، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'locksmith', 'smart-lock-installation',
      jsonb_build_object(
        'en', 'Smart Lock Installation',
        'es', 'Instalación de cerraduras inteligentes',
        'fr', 'Installation de serrures connectées',
        'ht', 'Enstalasyon kadna entelijan',
        'ar', 'تركيب الأقفال الذكية'
      ),
      jsonb_build_object(
        'en', 'Install keypad or smart locks with code and phone access, with a quote before service begins.',
        'es', 'Instala cerraduras inteligentes o con teclado, con acceso por código y teléfono, con cotización previa.',
        'fr', 'Installez des serrures connectées ou à code, avec accès par code et téléphone, avec devis préalable.',
        'ht', 'Enstale kadna entelijan oswa ak klavye, ak aksè pa kòd ak telefòn, ak estimasyon anvan.',
        'ar', 'تركيب أقفال ذكية أو بلوحة مفاتيح مع الدخول بالرمز والهاتف، مع عرض سعر مسبق.'
      ), 50
    ),
    -- Moving & Furniture
    (
      'moving', 'local-moving-help',
      jsonb_build_object(
        'en', 'Local Moving Help',
        'es', 'Ayuda para mudanzas locales',
        'fr', 'Aide au déménagement local',
        'ht', 'Èd pou demenajman lokal',
        'ar', 'مساعدة في الانتقال المحلي'
      ),
      jsonb_build_object(
        'en', 'Loading, transport, and unloading help for local moves, with a quote before service begins.',
        'es', 'Ayuda con carga, transporte y descarga para mudanzas locales, con cotización previa.',
        'fr', 'Aide au chargement, transport et déchargement pour déménagements locaux, avec devis préalable.',
        'ht', 'Èd pou chaje, transpòte, ak dechaje pou demenajman lokal, ak estimasyon anvan.',
        'ar', 'مساعدة في التحميل والنقل والتفريغ للانتقالات المحلية، مع عرض سعر مسبق.'
      ), 10
    ),
    (
      'moving', 'furniture-assembly',
      jsonb_build_object(
        'en', 'Furniture Assembly',
        'es', 'Armado de muebles',
        'fr', 'Montage de meubles',
        'ht', 'Monte mèb',
        'ar', 'تركيب الأثاث'
      ),
      jsonb_build_object(
        'en', 'Assemble flat-pack and ready-to-assemble furniture correctly and safely, with a quote before service begins.',
        'es', 'Arma muebles desarmados de forma correcta y segura, con cotización previa.',
        'fr', 'Montez correctement et en sécurité les meubles en kit, avec devis préalable.',
        'ht', 'Monte mèb ki vini an moso kòrèkteman epi an sekirite, ak estimasyon anvan.',
        'ar', 'تركيب الأثاث الجاهز بشكل صحيح وآمن، مع عرض سعر مسبق.'
      ), 20
    ),
    (
      'moving', 'loading-unloading-help',
      jsonb_build_object(
        'en', 'Loading & Unloading Help',
        'es', 'Ayuda para carga y descarga',
        'fr', 'Aide au chargement et déchargement',
        'ht', 'Èd pou chaje ak dechaje',
        'ar', 'مساعدة في التحميل والتفريغ'
      ),
      jsonb_build_object(
        'en', 'Extra hands to load or unload a truck, trailer, or storage unit, with a quote before service begins.',
        'es', 'Manos extra para cargar o descargar un camión, remolque o trastero, con cotización previa.',
        'fr', 'Des bras supplémentaires pour charger ou décharger un camion, une remorque ou un garde-meuble, avec devis préalable.',
        'ht', 'Lòt men pou chaje oswa dechaje yon kamyon, trelè, oswa depo, ak estimasyon anvan.',
        'ar', 'أيد إضافية لتحميل أو تفريغ شاحنة أو مقطورة أو وحدة تخزين، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'moving', 'packing-help',
      jsonb_build_object(
        'en', 'Packing Help',
        'es', 'Ayuda para empacar',
        'fr', 'Aide à emballage pour déménagement',
        'ht', 'Èd pou anbale',
        'ar', 'مساعدة في التغليف'
      ),
      jsonb_build_object(
        'en', 'Careful packing of boxes, fragile items, and furniture for a move, with a quote before service begins.',
        'es', 'Empacado cuidadoso de cajas, artículos frágiles y muebles para la mudanza, con cotización previa.',
        'fr', 'Emballage soigneux des cartons, objets fragiles et meubles pour un déménagement, avec devis préalable.',
        'ht', 'Anbale bwat, bagay frajil, ak mèb ak swen pou demenajman, ak estimasyon anvan.',
        'ar', 'تغليف دقيق للصناديق والأغراض القابلة للكسر والأثاث استعدادا للانتقال، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'moving', 'furniture-rearranging',
      jsonb_build_object(
        'en', 'Furniture Rearranging',
        'es', 'Reorganización de muebles',
        'fr', 'Réagencement de meubles à domicile',
        'ht', 'Ranje mèb nan kay la',
        'ar', 'إعادة ترتيب الأثاث'
      ),
      jsonb_build_object(
        'en', 'Move and rearrange heavy furniture within the home, with a quote before service begins.',
        'es', 'Mueve y reorganiza muebles pesados dentro del hogar, con cotización previa.',
        'fr', 'Déplacez et réagencez les meubles lourds dans la maison, avec devis préalable.',
        'ht', 'Deplase epi ranje gwo mèb lou andedan kay la, ak estimasyon anvan.',
        'ar', 'نقل وإعادة ترتيب الأثاث الثقيل داخل المنزل، مع عرض سعر مسبق.'
      ), 50
    ),
    -- Car Care & Repair
    (
      'automotive', 'oil-change',
      jsonb_build_object(
        'en', 'Oil Change',
        'es', 'Cambio de aceite',
        'fr', 'Vidange moteur',
        'ht', 'Chanje lwil motè',
        'ar', 'تغيير زيت المحرك'
      ),
      jsonb_build_object(
        'en', 'Engine oil and filter change at your home or workplace, with a quote before service begins.',
        'es', 'Cambio de aceite y filtro del motor en tu casa o trabajo, con cotización previa.',
        'fr', 'Vidange moteur avec remplacement du filtre à domicile ou au bureau, avec devis préalable.',
        'ht', 'Chanje lwil motè ak filtè lakay ou oswa nan travay ou, ak estimasyon anvan.',
        'ar', 'تغيير زيت المحرك والفلتر في منزلك أو مكان عملك، مع عرض سعر مسبق.'
      ), 10
    ),
    (
      'automotive', 'brake-service',
      jsonb_build_object(
        'en', 'Brake Service',
        'es', 'Servicio de frenos',
        'fr', 'Entretien des freins',
        'ht', 'Sèvis fren',
        'ar', 'خدمة الفرامل'
      ),
      jsonb_build_object(
        'en', 'Inspect and replace brake pads, rotors, or calipers, with a quote before service begins.',
        'es', 'Inspecciona y reemplaza pastillas, discos o mordazas de freno, con cotización previa.',
        'fr', 'Inspectez et remplacez plaquettes, disques ou étriers de frein, avec devis préalable.',
        'ht', 'Enspekte epi ranplase plakèt, disk, oswa etriye fren, ak estimasyon anvan.',
        'ar', 'فحص واستبدال وسادات أو أقراص أو ملاقط الفرامل، مع عرض سعر مسبق.'
      ), 20
    ),
    (
      'automotive', 'tire-service',
      jsonb_build_object(
        'en', 'Tire Rotation & Replacement',
        'es', 'Rotación y reemplazo de llantas',
        'fr', 'Permutation et remplacement de pneus',
        'ht', 'Sèvis kawoutchou',
        'ar', 'تدوير واستبدال الإطارات'
      ),
      jsonb_build_object(
        'en', 'Rotate tires or replace worn tires, including balancing, with a quote before service begins.',
        'es', 'Rota las llantas o reemplaza las desgastadas, incluido el balanceo, con cotización previa.',
        'fr', 'Permutez les pneus ou remplacez les pneus usés, équilibrage inclus, avec devis préalable.',
        'ht', 'Vire kawoutchou yo oswa ranplase sa ki ize, enkli ekilibraj, ak estimasyon anvan.',
        'ar', 'تدوير الإطارات أو استبدال التالف منها مع الموازنة، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'automotive', 'battery-replacement',
      jsonb_build_object(
        'en', 'Battery Replacement',
        'es', 'Reemplazo de batería',
        'fr', 'Remplacement de batterie automobile',
        'ht', 'Ranplase batri machin',
        'ar', 'استبدال بطارية السيارة'
      ),
      jsonb_build_object(
        'en', 'Test, jump-start, and replace a dead car battery on site, with a quote before service begins.',
        'es', 'Prueba, arranca con pinzas y reemplaza una batería descargada en el lugar, con cotización previa.',
        'fr', 'Testez, démarrez avec des câbles et remplacez une batterie à plat sur place, avec devis préalable.',
        'ht', 'Teste, bay kouran, epi ranplase yon batri machin ki mouri sou plas, ak estimasyon anvan.',
        'ar', 'فحص وتشغيل واستبدال بطارية السيارة الفارغة في الموقع، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'automotive', 'car-detailing',
      jsonb_build_object(
        'en', 'Car Detailing',
        'es', 'Detallado de autos',
        'fr', 'Nettoyage automobile détaillé',
        'ht', 'Netwayaj machin konplè',
        'ar', 'تلميع وتنظيف السيارات'
      ),
      jsonb_build_object(
        'en', 'Interior and exterior detailing including wash, wax, vacuum, and trim care, with a quote before service begins.',
        'es', 'Detallado interior y exterior con lavado, cera, aspirado y cuidado de molduras, con cotización previa.',
        'fr', 'Nettoyage détaillé intérieur et extérieur avec lavage, cire, aspirateur et soin des garnitures, avec devis préalable.',
        'ht', 'Netwayaj konplè anndan ak deyò machin enkli lave, si, aspiratè, ak swen detay, ak estimasyon anvan.',
        'ar', 'تنظيف تفصيلي داخلي وخارجي يشمل الغسيل والشمع والشفط والعناية بالتفاصيل، مع عرض سعر مسبق.'
      ), 50
    ),
    -- Tech Support
    (
      'tech-support', 'computer-repair',
      jsonb_build_object(
        'en', 'Computer Repair',
        'es', 'Reparación de computadoras',
        'fr', 'Réparation des ordinateurs',
        'ht', 'Reparasyon òdinatè',
        'ar', 'إصلاح أجهزة الكمبيوتر'
      ),
      jsonb_build_object(
        'en', 'Diagnose and repair desktops and laptops that are slow, will not boot, or have hardware issues, with a quote before service begins.',
        'es', 'Diagnostica y repara computadoras lentas, que no encienden o tienen fallas de hardware, con cotización previa.',
        'fr', 'Diagnostiquez et réparez les ordinateurs lents, qui ne démarrent pas ou qui ont des problèmes matériels, avec devis préalable.',
        'ht', 'Dyagnostike epi repare òdinatè ki lan, ki pa limen, oswa ki gen pwoblèm pyès, ak estimasyon anvan.',
        'ar', 'تشخيص وإصلاح أجهزة الكمبيوتر البطيئة أو التي لا تعمل أو تعاني من مشاكل في العتاد، مع عرض سعر مسبق.'
      ), 10
    ),
    (
      'tech-support', 'phone-tablet-repair',
      jsonb_build_object(
        'en', 'Phone & Tablet Repair',
        'es', 'Reparación de teléfonos y tabletas',
        'fr', 'Réparation de téléphones et tablettes',
        'ht', 'Reparasyon telefòn ak tablèt',
        'ar', 'إصلاح الهواتف والأجهزة اللوحية'
      ),
      jsonb_build_object(
        'en', 'Replace cracked screens, batteries, and charging ports on phones and tablets, with a quote before service begins.',
        'es', 'Reemplaza pantallas rotas, baterías y puertos de carga en teléfonos y tabletas, con cotización previa.',
        'fr', 'Remplacez écrans fissurés, batteries et ports de charge sur téléphones et tablettes, avec devis préalable.',
        'ht', 'Ranplase ekran kase, batri, ak pò chaj sou telefòn ak tablèt, ak estimasyon anvan.',
        'ar', 'استبدال الشاشات المكسورة والبطاريات ومنافذ الشحن في الهواتف والأجهزة اللوحية، مع عرض سعر مسبق.'
      ), 20
    ),
    (
      'tech-support', 'wifi-network-setup',
      jsonb_build_object(
        'en', 'Wi-Fi & Network Setup',
        'es', 'Instalación de Wi-Fi y redes',
        'fr', 'Installation et dépannage Wi-Fi',
        'ht', 'Enstalasyon Wi-Fi ak rezo',
        'ar', 'إعداد شبكات الواي فاي'
      ),
      jsonb_build_object(
        'en', 'Set up or fix home Wi-Fi, extend coverage to dead zones, and secure the network, with a quote before service begins.',
        'es', 'Instala o repara el Wi-Fi del hogar, amplía la cobertura a zonas sin señal y asegura la red, con cotización previa.',
        'fr', 'Installez ou réparez le Wi-Fi domestique, étendez la couverture aux zones sans signal et sécurisez le réseau, avec devis préalable.',
        'ht', 'Enstale oswa repare Wi-Fi lakay, pwolonje kouvèti nan kote ki pa gen siyal, epi sekirize rezo a, ak estimasyon anvan.',
        'ar', 'إعداد أو إصلاح الواي فاي المنزلي وتوسيع التغطية للمناطق الضعيفة وتأمين الشبكة، مع عرض سعر مسبق.'
      ), 30
    ),
    (
      'tech-support', 'smart-home-setup',
      jsonb_build_object(
        'en', 'Smart Home Setup',
        'es', 'Configuración de hogar inteligente',
        'fr', 'Installation de maison connectée',
        'ht', 'Enstalasyon kay entelijan',
        'ar', 'إعداد المنزل الذكي'
      ),
      jsonb_build_object(
        'en', 'Install and configure smart speakers, cameras, doorbells, lights, and thermostats, with a quote before service begins.',
        'es', 'Instala y configura altavoces, cámaras, timbres, luces y termostatos inteligentes, con cotización previa.',
        'fr', 'Installez et configurez enceintes, caméras, sonnettes, lumières et thermostats connectés, avec devis préalable.',
        'ht', 'Enstale epi konfigire pale entelijan, kamera, sonèt, limyè, ak tèmosta entelijan, ak estimasyon anvan.',
        'ar', 'تركيب وإعداد المكبرات والكاميرات وأجراس الأبواب والإضاءة ومنظمات الحرارة الذكية، مع عرض سعر مسبق.'
      ), 40
    ),
    (
      'tech-support', 'tv-mounting',
      jsonb_build_object(
        'en', 'TV Mounting',
        'es', 'Instalación de TV en pared',
        'fr', 'Fixation murale de téléviseur',
        'ht', 'Monte televizyon sou mi',
        'ar', 'تركيب التلفزيون على الحائط'
      ),
      jsonb_build_object(
        'en', 'Mount a TV securely on any wall type with clean cable management, with a quote before service begins.',
        'es', 'Monta un televisor de forma segura en cualquier tipo de pared con gestión limpia de cables, con cotización previa.',
        'fr', 'Fixez solidement un téléviseur sur tout type de mur avec un passage de câbles propre, avec devis préalable.',
        'ht', 'Monte yon televizyon byen solid sou nenpòt kalite mi ak jesyon kab pwòp, ak estimasyon anvan.',
        'ar', 'تركيب التلفزيون بإحكام على أي نوع من الجدران مع ترتيب أنيق للكابلات، مع عرض سعر مسبق.'
      ), 50
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

-- Record lifecycle history for the new categories and services.
INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'category', c.id, NULL, 'live', NULL, 'Published Direct everyday-services catalog expansion'
FROM direct_catalog_categories c
WHERE c.slug IN (
  'appliances', 'hvac', 'cleaning', 'pest-control',
  'locksmith', 'moving', 'automotive', 'tech-support'
)
AND NOT EXISTS (
  SELECT 1
  FROM catalog_status_history h
  WHERE h.item_type = 'category' AND h.item_id = c.id
);

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'service', s.id, NULL, 'live', NULL, 'Published Direct everyday-services catalog expansion'
FROM direct_catalog_services s
WHERE s.slug IN (
  'refrigerator-repair', 'washer-dryer-repair', 'oven-stove-repair', 'dishwasher-repair', 'microwave-repair',
  'ac-repair', 'furnace-repair', 'thermostat-installation', 'duct-cleaning', 'hvac-seasonal-maintenance',
  'recurring-house-cleaning', 'deep-cleaning', 'move-in-out-cleaning', 'carpet-upholstery-cleaning', 'window-cleaning',
  'general-pest-treatment', 'termite-inspection', 'rodent-removal', 'mosquito-treatment', 'bed-bug-treatment',
  'emergency-lockout-service', 'lock-replacement', 'home-rekeying', 'deadbolt-installation', 'smart-lock-installation',
  'local-moving-help', 'furniture-assembly', 'loading-unloading-help', 'packing-help', 'furniture-rearranging',
  'oil-change', 'brake-service', 'tire-service', 'battery-replacement', 'car-detailing',
  'computer-repair', 'phone-tablet-repair', 'wifi-network-setup', 'smart-home-setup', 'tv-mounting'
)
AND NOT EXISTS (
  SELECT 1
  FROM catalog_status_history h
  WHERE h.item_type = 'service' AND h.item_id = s.id
);
