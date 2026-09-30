-- Migration 612: cover the remaining browse-by-skill trades in the Direct catalog.
-- Adds 8 published categories (roofing, flooring, concrete, welding, home repair,
-- home security, pet care, tutoring), 40 quote-based services (price_cents NULL),
-- and 32 category-linked supporting tools with complete five-locale names and
-- descriptions. All entries are quote-based so final scope and price are confirmed
-- before work is accepted, matching migrations 523 and 611. Existing rows are
-- never overwritten (ON CONFLICT DO NOTHING).

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
  ('roofing', '{"en":"Roofing","es":"Techado","fr":"Toiture","ht":"Twati","ar":"أعمال الأسقف"}'::jsonb, 'home', 140, 140, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('flooring', '{"en":"Flooring","es":"Pisos","fr":"Revêtements de sol","ht":"Planche","ar":"الأرضيات"}'::jsonb, 'layers', 150, 150, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('concrete', '{"en":"Concrete","es":"Concreto","fr":"Béton","ht":"Beton","ar":"الخرسانة"}'::jsonb, 'hard-hat', 160, 160, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('welding', '{"en":"Welding","es":"Soldadura","fr":"Soudure","ht":"Soudi","ar":"اللحام"}'::jsonb, 'flame', 170, 170, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('home-repair', '{"en":"Home Repair","es":"Reparación del hogar","fr":"Réparations domestiques","ht":"Reparasyon kay","ar":"إصلاحات منزلية"}'::jsonb, 'wrench', 180, 180, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('security', '{"en":"Home Security","es":"Seguridad del hogar","fr":"Sécurité domestique","ht":"Sekirite kay","ar":"أمن المنازل"}'::jsonb, 'shield', 190, 190, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('pet-care', '{"en":"Pet Care","es":"Cuidado de mascotas","fr":"Soins des animaux","ht":"Swen bèt","ar":"رعاية الحيوانات الأليفة"}'::jsonb, 'paw-print', 200, 200, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP),
  ('tutoring', '{"en":"Tutoring","es":"Tutorías","fr":"Cours particuliers","ht":"Leson prive","ar":"الدروس الخصوصية"}'::jsonb, 'graduation-cap', 210, 210, TRUE, TRUE, 'live', TRUE, FALSE, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO NOTHING;

WITH seeded(category_slug, slug, name_i18n, description_i18n, display_order) AS (
  VALUES
    -- Roofing,
    (
      'roofing', 'roof-repair',
      jsonb_build_object(
        'en', 'Roof Repair',
        'es', 'Reparación de techos',
        'fr', 'Réparation de toiture',
        'ht', 'Reparasyon twati',
        'ar', 'إصلاح الأسقف'
      ),
      jsonb_build_object(
        'en', 'Diagnosis and repair of leaks, missing shingles, and damaged flashing. Final scope and price confirmed before work begins.',
        'es', 'Diagnóstico y reparación de goteras, tejas faltantes y tapajuntas dañados. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Diagnostic et réparation des fuites, bardeaux manquants et solins endommagés. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Dyagnostik ak reparasyon koule, bardeau ki manke ak flachin ki domaje. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تشخيص وإصلاح التسربات والقرميد المفقود والفلاش التالف. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'roofing', 'roof-replacement',
      jsonb_build_object(
        'en', 'Roof Replacement',
        'es', 'Reemplazo de techo',
        'fr', 'Remplacement de toiture',
        'ht', 'Ranplasman twati',
        'ar', 'استبدال السقف'
      ),
      jsonb_build_object(
        'en', 'Full or partial roof replacement with materials matched to the home. Final scope and price confirmed before work begins.',
        'es', 'Reemplazo total o parcial del techo con materiales adecuados para el hogar. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Remplacement total ou partiel de la toiture avec des matériaux adaptés à la maison. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Ranplasman twati konplè oswa pasyèl ak materyèl ki adapte ak kay la. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'استبدال كامل أو جزئي للسقف بمواد تناسب المنزل. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'roofing', 'roof-inspection',
      jsonb_build_object(
        'en', 'Roof Inspection',
        'es', 'Inspección de techo',
        'fr', 'Inspection de toiture',
        'ht', 'Enspeksyon twati',
        'ar', 'فحص السقف'
      ),
      jsonb_build_object(
        'en', 'Visual inspection of roof condition, drainage, and vulnerable areas with a written summary. Final scope and price confirmed before work begins.',
        'es', 'Inspección visual del estado del techo, el drenaje y las zonas vulnerables, con resumen escrito. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Inspection visuelle de l''état de la toiture, du drainage et des zones vulnérables, avec un résumé écrit. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enspeksyon vizyèl kondisyon twati a, drenaj la ak zòn ki vilnerab, ak yon rezime ekri. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'فحص بصري لحالة السقف والصرف والمناطق الضعيفة مع ملخص مكتوب. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'roofing', 'gutter-installation-repair',
      jsonb_build_object(
        'en', 'Gutter Installation and Repair',
        'es', 'Instalación y reparación de canalones',
        'fr', 'Installation et réparation de gouttières',
        'ht', 'Enstalasyon ak reparasyon goutyè',
        'ar', 'تركيب وإصلاح المزاريب'
      ),
      jsonb_build_object(
        'en', 'Installation, repair, and realignment of gutters and downspouts. Final scope and price confirmed before work begins.',
        'es', 'Instalación, reparación y realineación de canalones y bajantes. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation, réparation et réalignement des gouttières et descentes. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon, reparasyon ak realiyasyon goutyè ak desant. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب وإصلاح وإعادة محاذاة المزاريب وأنابيب الصرف. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'roofing', 'skylight-installation',
      jsonb_build_object(
        'en', 'Skylight Installation',
        'es', 'Instalación de tragaluces',
        'fr', 'Installation de puits de lumière',
        'ht', 'Enstalasyon fenèt twati',
        'ar', 'تركيب النوافذ السقفية'
      ),
      jsonb_build_object(
        'en', 'Installation and sealing of skylights, including leak checks. Final scope and price confirmed before work begins.',
        'es', 'Instalación y sellado de tragaluces, incluida la verificación de filtraciones. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation et étanchéité des puits de lumière, y compris la vérification des fuites. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon ak sele fenèt twati, ki gen ladan verifikasyon koule. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب وإحكام النوافذ السقفية مع فحص التسربات. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
    ),
    -- Flooring,
    (
      'flooring', 'hardwood-floor-installation',
      jsonb_build_object(
        'en', 'Hardwood Floor Installation',
        'es', 'Instalación de pisos de madera',
        'fr', 'Pose de parquet',
        'ht', 'Enstalasyon planche bwa',
        'ar', 'تركيب الأرضيات الخشبية'
      ),
      jsonb_build_object(
        'en', 'Installation of hardwood flooring with measured cuts and finished transitions. Final scope and price confirmed before work begins.',
        'es', 'Instalación de pisos de madera con cortes medidos y transiciones acabadas. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Pose de parquet avec coupes mesurées et transitions finies. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon planche bwa ak koupe mezire ak tranzisyon fini. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب الأرضيات الخشبية بقطع دقيقة ووصلات نهائية. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'flooring', 'laminate-vinyl-flooring',
      jsonb_build_object(
        'en', 'Laminate and Vinyl Flooring',
        'es', 'Pisos laminados y de vinilo',
        'fr', 'Sols stratifiés et vinyle',
        'ht', 'Planche laminat ak vinil',
        'ar', 'أرضيات اللامينيت والفينيل'
      ),
      jsonb_build_object(
        'en', 'Installation of laminate and luxury vinyl flooring, including underlayment. Final scope and price confirmed before work begins.',
        'es', 'Instalación de pisos laminados y de vinilo de lujo, incluida la base aislante. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Pose de sols stratifiés et vinyle haut de gamme, sous-couche incluse. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon planche laminat ak vinil liks, ki gen ladan sou-kouch. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب أرضيات اللامينيت والفينيل الفاخر بما في ذلك الطبقة العازلة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'flooring', 'tile-floor-installation',
      jsonb_build_object(
        'en', 'Tile Floor Installation',
        'es', 'Instalación de pisos de cerámica',
        'fr', 'Pose de carrelage',
        'ht', 'Enstalasyon mozayik',
        'ar', 'تركيب أرضيات البلاط'
      ),
      jsonb_build_object(
        'en', 'Installation of tile flooring with grout, leveling, and sealed edges. Final scope and price confirmed before work begins.',
        'es', 'Instalación de pisos de cerámica con lechada, nivelación y bordes sellados. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Pose de carrelage avec joints, mise à niveau et bords scellés. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon mozayik ak jwen, nivelman ak bor sele. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب أرضيات البلاط مع الجص والتسوية وحواف محكمة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'flooring', 'floor-refinishing',
      jsonb_build_object(
        'en', 'Floor Refinishing',
        'es', 'Renovación de pisos de madera',
        'fr', 'Rénovation de parquet',
        'ht', 'Renouvèlman planche',
        'ar', 'تجديد الأرضيات'
      ),
      jsonb_build_object(
        'en', 'Sanding, staining, and sealing of worn wood floors. Final scope and price confirmed before work begins.',
        'es', 'Lijado, teñido y sellado de pisos de madera desgastados. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Ponçage, teinture et vitrification des parquets usés. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Lisaj, tenti ak sele planche bwa ki ize. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'صنفرة وصبغ وإحكام الأرضيات الخشبية البالية. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'flooring', 'carpet-installation',
      jsonb_build_object(
        'en', 'Carpet Installation',
        'es', 'Instalación de alfombras',
        'fr', 'Pose de moquette',
        'ht', 'Enstalasyon tapi',
        'ar', 'تركيب السجاد'
      ),
      jsonb_build_object(
        'en', 'Carpet installation with padding, stretching, and clean seams. Final scope and price confirmed before work begins.',
        'es', 'Instalación de alfombras con acolchado, estirado y uniones limpias. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Pose de moquette avec thibaude, tension et joints propres. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon tapi ak pad, etire ak kouti pwòp. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب السجاد مع البطانة والشد ووصلات نظيفة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
    ),
    -- Concrete,
    (
      'concrete', 'concrete-driveway',
      jsonb_build_object(
        'en', 'Concrete Driveway Installation',
        'es', 'Instalación de entradas de concreto',
        'fr', 'Pose d''allée en béton',
        'ht', 'Enstalasyon antre beton',
        'ar', 'تركيب ممر خرساني'
      ),
      jsonb_build_object(
        'en', 'New concrete driveway installation with grading and proper drainage. Final scope and price confirmed before work begins.',
        'es', 'Instalación de una nueva entrada de concreto con nivelación y drenaje adecuado. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Pose d''une nouvelle allée en béton avec nivellement et drainage adapté. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon nouvo antre beton ak nivelman ak drenaj kòrèk. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب ممر خرساني جديد مع التسوية والصرف السليم. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'concrete', 'concrete-patio-walkway',
      jsonb_build_object(
        'en', 'Concrete Patio and Walkway',
        'es', 'Patio y pasarela de concreto',
        'fr', 'Terrasse et allée en béton',
        'ht', 'Patio ak chemen beton',
        'ar', 'فناء وممشى خرساني'
      ),
      jsonb_build_object(
        'en', 'Concrete patios and walkways formed, poured, and finished. Final scope and price confirmed before work begins.',
        'es', 'Patios y pasarelas de concreto encofrados, vertidos y acabados. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Terrasses et allées en béton coffrées, coulées et finies. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Patio ak chemen beton yo fòme, koule ak fini. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تشكيل وصب وتشطيب الأفنية والمماشي الخرسانية. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'concrete', 'concrete-repair-resurfacing',
      jsonb_build_object(
        'en', 'Concrete Repair and Resurfacing',
        'es', 'Reparación y revestimiento de concreto',
        'fr', 'Réparation et resurfaçage du béton',
        'ht', 'Reparasyon ak resifasaj beton',
        'ar', 'إصلاح وإعادة تسوية الخرسانة'
      ),
      jsonb_build_object(
        'en', 'Repair of cracks, spalling, and uneven concrete, plus resurfacing. Final scope and price confirmed before work begins.',
        'es', 'Reparación de grietas, desprendimientos y concreto irregular, más revestimiento. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Réparation des fissures, écaillages et irrégularités du béton, plus resurfaçage. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Reparasyon fant, ekayman ak beton inegal, plis resifasaj. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'إصلاح الشقوق والتقشر وعدم استواء الخرسانة مع إعادة التسوية. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'concrete', 'stamped-decorative-concrete',
      jsonb_build_object(
        'en', 'Stamped and Decorative Concrete',
        'es', 'Concreto estampado y decorativo',
        'fr', 'Béton imprimé et décoratif',
        'ht', 'Beton estampe ak dekoratif',
        'ar', 'خرسانة مختومة وزخرفية'
      ),
      jsonb_build_object(
        'en', 'Stamped and decorative concrete with patterns and color finishes. Final scope and price confirmed before work begins.',
        'es', 'Concreto estampado y decorativo con patrones y acabados de color. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Béton imprimé et décoratif avec motifs et finitions colorées. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Beton estampe ak dekoratif ak modèl ak fini koulè. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'خرسانة مختومة وزخرفية بأنماط وتشطيبات ملونة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'concrete', 'concrete-demolition-removal',
      jsonb_build_object(
        'en', 'Concrete Demolition and Removal',
        'es', 'Demolición y retiro de concreto',
        'fr', 'Démolition et enlèvement de béton',
        'ht', 'Demolisyon ak retire beton',
        'ar', 'هدم وإزالة الخرسانة'
      ),
      jsonb_build_object(
        'en', 'Demolition and removal of old concrete slabs and structures. Final scope and price confirmed before work begins.',
        'es', 'Demolición y retiro de losas y estructuras de concreto viejas. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Démolition et enlèvement des dalles et structures en béton anciennes. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Demolisyon ak retire ansyen dal ak estrikti beton. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'هدم وإزالة البلاطات والهياكل الخرسانية القديمة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
    ),
    -- Welding,
    (
      'welding', 'gate-fence-welding',
      jsonb_build_object(
        'en', 'Gate and Fence Welding',
        'es', 'Soldadura de portones y cercas',
        'fr', 'Soudure de portails et clôtures',
        'ht', 'Soudi baryè ak kloti',
        'ar', 'لحام البوابات والأسوار'
      ),
      jsonb_build_object(
        'en', 'Welding repair and fabrication for metal gates and fences. Final scope and price confirmed before work begins.',
        'es', 'Reparación por soldadura y fabricación para portones y cercas metálicas. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Réparation par soudure et fabrication pour portails et clôtures métalliques. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Reparasyon soudi ak fabrikasyon pou baryè ak kloti metal. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'إصلاح وتصنيع باللحام للبوابات والأسوار المعدنية. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'welding', 'custom-metal-fabrication',
      jsonb_build_object(
        'en', 'Custom Metal Fabrication',
        'es', 'Fabricación de metal a medida',
        'fr', 'Fabrication métallique sur mesure',
        'ht', 'Fabrikasyon metal sou mezi',
        'ar', 'تصنيع معدني مخصص'
      ),
      jsonb_build_object(
        'en', 'Custom metal fabrication for brackets, frames, and one-off parts. Final scope and price confirmed before work begins.',
        'es', 'Fabricación de metal a medida para soportes, marcos y piezas únicas. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Fabrication métallique sur mesure pour supports, cadres et pièces uniques. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Fabrikasyon metal sou mezi pou sipò, kad ak pyès inik. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تصنيع معدني مخصص للحوامل والإطارات والقطع الفريدة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'welding', 'structural-steel-repair',
      jsonb_build_object(
        'en', 'Structural Steel Repair',
        'es', 'Reparación de acero estructural',
        'fr', 'Réparation d''acier structurel',
        'ht', 'Reparasyon asye estriktirèl',
        'ar', 'إصلاح الفولاذ الإنشائي'
      ),
      jsonb_build_object(
        'en', 'Repair of structural steel elements, subject to inspection and code review. Final scope and price confirmed before work begins.',
        'es', 'Reparación de elementos de acero estructural, sujeta a inspección y revisión normativa. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Réparation d''éléments en acier structurel, sous réserve d''inspection et de conformité. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Reparasyon eleman asye estriktirèl, sijè a enspeksyon ak revizyon kòd. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'إصلاح عناصر الفولاذ الإنشائي، خاضع للفحص ومراجعة اللوائح. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'welding', 'trailer-hitch-welding',
      jsonb_build_object(
        'en', 'Trailer Hitch Welding',
        'es', 'Soldadura de enganches de remolque',
        'fr', 'Soudure d''attelage de remorque',
        'ht', 'Soudi atèl trelè',
        'ar', 'لحام وصلة المقطورة'
      ),
      jsonb_build_object(
        'en', 'Trailer hitch installation and welding repair. Final scope and price confirmed before work begins.',
        'es', 'Instalación y reparación por soldadura de enganches de remolque. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation et réparation par soudure des attelages de remorque. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon ak reparasyon soudi atèl trelè. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب وإصلاح باللحام لوصلات المقطورات. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'welding', 'metal-railing-installation',
      jsonb_build_object(
        'en', 'Metal Railing Installation',
        'es', 'Instalación de barandillas metálicas',
        'fr', 'Installation de rampes métalliques',
        'ht', 'Enstalasyon ranp metal',
        'ar', 'تركيب درابزين معدني'
      ),
      jsonb_build_object(
        'en', 'Installation and repair of metal railings for stairs and balconies. Final scope and price confirmed before work begins.',
        'es', 'Instalación y reparación de barandillas metálicas para escaleras y balcones. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation et réparation de rampes métalliques pour escaliers et balcons. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon ak reparasyon ranp metal pou eskalye ak balkon. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب وإصلاح الدرابزين المعدني للسلالم والشرفات. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
    ),
    -- Home Repair,
    (
      'home-repair', 'general-handyman-visit',
      jsonb_build_object(
        'en', 'General Handyman Visit',
        'es', 'Visita de manitas general',
        'fr', 'Visite d''homme à tout faire',
        'ht', 'Vizit om repare tout',
        'ar', 'زيارة فني صيانة عام'
      ),
      jsonb_build_object(
        'en', 'A handyman visit for small repairs, mounting, and adjustments around the home. Final scope and price confirmed before work begins.',
        'es', 'Visita de un manitas para pequeñas reparaciones, montajes y ajustes en el hogar. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Visite d''un homme à tout faire pour petites réparations, fixations et réglages dans la maison. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Yon vizit om repare tout pou ti reparasyon, montaj ak ajisteman nan kay la. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'زيارة فني صيانة للإصلاحات الصغيرة والتركيب والتعديلات في المنزل. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'home-repair', 'drywall-patch-repair',
      jsonb_build_object(
        'en', 'Drywall Patch and Repair',
        'es', 'Reparación de paneles de yeso',
        'fr', 'Réparation de placoplâtre',
        'ht', 'Reparasyon plak platr',
        'ar', 'إصلاح ألواح الجبس'
      ),
      jsonb_build_object(
        'en', 'Patching and finishing of drywall holes, cracks, and dents. Final scope and price confirmed before work begins.',
        'es', 'Parcheo y acabado de agujeros, grietas y abolladuras en paneles de yeso. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Rebouchage et finition des trous, fissures et bosses du placoplâtre. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Bouche ak fini twou, fant ak bos plak platr. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'ترقيع وتشطيب ثقوب وشقوق وانبعاجات ألواح الجبس. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'home-repair', 'door-adjustment-repair',
      jsonb_build_object(
        'en', 'Door Adjustment and Repair',
        'es', 'Ajuste y reparación de puertas',
        'fr', 'Réglage et réparation de portes',
        'ht', 'Ajisteman ak reparasyon pòt',
        'ar', 'ضبط وإصلاح الأبواب'
      ),
      jsonb_build_object(
        'en', 'Adjustment and repair of sticking, sagging, or misaligned interior doors. Final scope and price confirmed before work begins.',
        'es', 'Ajuste y reparación de puertas interiores que se atascan, se hunden o están desalineadas. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Réglage et réparation des portes intérieures qui coincent, s''affaissent ou sont désalignées. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Ajisteman ak reparasyon pòt andedan ki kole, bese oswa pa aliyen. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'ضبط وإصلاح الأبواب الداخلية العالقة أو المترهلة أو غير المحاذاة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'home-repair', 'fence-repair',
      jsonb_build_object(
        'en', 'Fence Repair',
        'es', 'Reparación de cercas',
        'fr', 'Réparation de clôture',
        'ht', 'Reparasyon kloti',
        'ar', 'إصلاح الأسوار'
      ),
      jsonb_build_object(
        'en', 'Repair of wood and vinyl fences, including posts, rails, and pickets. Final scope and price confirmed before work begins.',
        'es', 'Reparación de cercas de madera y vinilo, incluidos postes, rieles y listones. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Réparation des clôtures en bois et vinyle, y compris poteaux, traverses et lattes. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Reparasyon kloti bwa ak vinil, ki gen ladan poto, travès ak lat. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'إصلاح الأسوار الخشبية والفينيل بما في ذلك الأعمدة والقضبان والألواح. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'home-repair', 'caulking-weatherproofing',
      jsonb_build_object(
        'en', 'Caulking and Weatherproofing',
        'es', 'Sellado y protección contra la intemperie',
        'fr', 'Calfeutrage et étanchéité',
        'ht', 'Kalfat ak pwoteksyon kont move tan',
        'ar', 'السد والعزل ضد الطقس'
      ),
      jsonb_build_object(
        'en', 'Caulking and weatherproofing of windows, doors, and exterior joints. Final scope and price confirmed before work begins.',
        'es', 'Sellado y protección contra la intemperie de ventanas, puertas y juntas exteriores. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Calfeutrage et étanchéité des fenêtres, portes et joints extérieurs. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Kalfat ak pwoteksyon kont move tan pou fenèt, pòt ak jwen deyò. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'سد وعزل النوافذ والأبواب والفواصل الخارجية ضد الطقس. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
    ),
    -- Home Security,
    (
      'security', 'security-camera-installation',
      jsonb_build_object(
        'en', 'Security Camera Installation',
        'es', 'Instalación de cámaras de seguridad',
        'fr', 'Installation de caméras de sécurité',
        'ht', 'Enstalasyon kamera sekirite',
        'ar', 'تركيب كاميرات المراقبة'
      ),
      jsonb_build_object(
        'en', 'Installation of security cameras with positioning and app setup. Final scope and price confirmed before work begins.',
        'es', 'Instalación de cámaras de seguridad con posicionamiento y configuración de la aplicación. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation de caméras de sécurité avec positionnement et configuration de l''application. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon kamera sekirite ak pozisyonman ak konfigirasyon aplikasyon an. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب كاميرات المراقبة مع التموضع وإعداد التطبيق. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'security', 'video-doorbell-installation',
      jsonb_build_object(
        'en', 'Video Doorbell Installation',
        'es', 'Instalación de timbres con video',
        'fr', 'Installation de sonnette vidéo',
        'ht', 'Enstalasyon klòch videyo',
        'ar', 'تركيب جرس باب بالفيديو'
      ),
      jsonb_build_object(
        'en', 'Video doorbell installation, wiring or battery setup, and app pairing. Final scope and price confirmed before work begins.',
        'es', 'Instalación de timbre con video, cableado o configuración con batería y vinculación con la aplicación. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation de sonnette vidéo, câblage ou configuration sur batterie, et jumelage avec l''application. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon klòch videyo, fil elektrik oswa konfigirasyon batri, ak koneksyon ak aplikasyon an. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب جرس الباب بالفيديو مع الأسلاك أو إعداد البطارية وربط التطبيق. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'security', 'alarm-system-installation',
      jsonb_build_object(
        'en', 'Alarm System Installation',
        'es', 'Instalación de sistemas de alarma',
        'fr', 'Installation de système d''alarme',
        'ht', 'Enstalasyon sistèm alàm',
        'ar', 'تركيب نظام الإنذار'
      ),
      jsonb_build_object(
        'en', 'Installation of alarm systems with sensors and control panel setup. Final scope and price confirmed before work begins.',
        'es', 'Instalación de sistemas de alarma con sensores y configuración del panel de control. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation de systèmes d''alarme avec capteurs et configuration du panneau de contrôle. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon sistèm alàm ak detektè ak konfigirasyon panèl kontwòl. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب أنظمة الإنذار مع أجهزة الاستشعار وإعداد لوحة التحكم. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'security', 'motion-sensor-lighting',
      jsonb_build_object(
        'en', 'Motion Sensor Lighting',
        'es', 'Iluminación con sensor de movimiento',
        'fr', 'Éclairage à détecteur de mouvement',
        'ht', 'Limyè ak detektè mouvman',
        'ar', 'إضاءة بمستشعر الحركة'
      ),
      jsonb_build_object(
        'en', 'Installation of motion sensor lighting for entries, yards, and garages. Final scope and price confirmed before work begins.',
        'es', 'Instalación de iluminación con sensor de movimiento para entradas, patios y garajes. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Installation d''éclairage à détecteur de mouvement pour entrées, cours et garages. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Enstalasyon limyè ak detektè mouvman pou antre, lakou ak garaj. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تركيب إضاءة بمستشعر الحركة للمداخل والساحات والمرائب. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'security', 'home-security-assessment',
      jsonb_build_object(
        'en', 'Home Security Assessment',
        'es', 'Evaluación de seguridad del hogar',
        'fr', 'Évaluation de la sécurité domestique',
        'ht', 'Evalyasyon sekirite kay',
        'ar', 'تقييم أمن المنزل'
      ),
      jsonb_build_object(
        'en', 'Walkthrough assessment of entry points and security gaps with written recommendations. Final scope and price confirmed before work begins.',
        'es', 'Evaluación recorriendo los puntos de acceso y las brechas de seguridad, con recomendaciones escritas. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Évaluation des points d’entrée et des failles de sécurité, avec recommandations écrites. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Evalyasyon pwen antre ak twou sekirite ak rekòmandasyon ekri. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تقييم ميداني لنقاط الدخول والثغرات الأمنية مع توصيات مكتوبة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
    ),
    -- Pet Care,
    (
      'pet-care', 'dog-walking',
      jsonb_build_object(
        'en', 'Dog Walking',
        'es', 'Paseo de perros',
        'fr', 'Promenade de chiens',
        'ht', 'Pwomnad chen',
        'ar', 'تمشية الكلاب'
      ),
      jsonb_build_object(
        'en', 'Scheduled dog walks with route notes and updates for the owner. Final scope and price confirmed before work begins.',
        'es', 'Paseos de perros programados con notas de la ruta y actualizaciones para el dueño. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Promenades de chiens planifiées avec notes d’itinéraire et nouvelles pour le propriétaire. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Pwomnad chen pwograme ak nòt sou wout la ak mizajou pou pwopriyetè a. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تمشية مجدولة للكلاب مع ملاحظات عن المسار وتحديثات للمالك. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'pet-care', 'pet-sitting',
      jsonb_build_object(
        'en', 'Pet Sitting',
        'es', 'Cuidado de mascotas en casa',
        'fr', 'Garde d’animaux à domicile',
        'ht', 'Gad bèt lakay',
        'ar', 'مجالسة الحيوانات'
      ),
      jsonb_build_object(
        'en', 'In-home pet sitting visits with feeding, play, and companionship. Final scope and price confirmed before work begins.',
        'es', 'Visitas de cuidado de mascotas en casa con alimentación, juego y compañía. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Visites de garde d’animaux à domicile avec repas, jeux et compagnie. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Vizit gad bèt lakay ak manje, jwèt ak konpayi. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'زيارات مجالسة الحيوانات في المنزل مع الإطعام واللعب والرفقة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'pet-care', 'pet-grooming',
      jsonb_build_object(
        'en', 'Pet Grooming',
        'es', 'Peluquería para mascotas',
        'fr', 'Toilettage d’animaux',
        'ht', 'Twalèt bèt',
        'ar', 'العناية بالحيوانات'
      ),
      jsonb_build_object(
        'en', 'Bathing, brushing, nail trimming, and basic grooming. Final scope and price confirmed before work begins.',
        'es', 'Baño, cepillado, corte de uñas y peluquería básica. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Bain, brossage, coupe des griffes et toilettage de base. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Ben, bwose, koupe zong ak twalèt debaz. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'الاستحمام والتمشيط وتقليم الأظافر والعناية الأساسية. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'pet-care', 'pet-waste-removal',
      jsonb_build_object(
        'en', 'Pet Waste Removal',
        'es', 'Retiro de desechos de mascotas',
        'fr', 'Enlèvement des déjections animales',
        'ht', 'Retire dechè bèt',
        'ar', 'إزالة مخلفات الحيوانات'
      ),
      jsonb_build_object(
        'en', 'Yard and litter-area pet waste cleanup on a scheduled basis. Final scope and price confirmed before work begins.',
        'es', 'Limpieza programada de desechos de mascotas en el patio y la zona de arena. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Nettoyage planifié des déjections animales dans la cour et la zone de litière. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Netwayaj dechè bèt pwograme nan lakou a ak zòn lityè a. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'تنظيف مجدول لمخلفات الحيوانات في الساحة ومنطقة الفضلات. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'pet-care', 'pet-taxi',
      jsonb_build_object(
        'en', 'Pet Taxi and Transport',
        'es', 'Taxi y transporte de mascotas',
        'fr', 'Taxi et transport d’animaux',
        'ht', 'Taksibèt ak transpò',
        'ar', 'نقل الحيوانات الأليفة'
      ),
      jsonb_build_object(
        'en', 'Transportation of pets to vets, groomers, and daycare. Final scope and price confirmed before work begins.',
        'es', 'Transporte de mascotas al veterinario, la peluquería y la guardería. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Transport d’animaux chez le vétérinaire, au toilettage et à la garderie. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Transpò bèt kay veterinè, twalèt ak gadri. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'نقل الحيوانات الأليفة إلى الأطباء البيطريين وصالونات العناية ودور الحضانة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
    ),
    -- Tutoring,
    (
      'tutoring', 'math-tutoring',
      jsonb_build_object(
        'en', 'Math Tutoring',
        'es', 'Tutoría de matemáticas',
        'fr', 'Cours de mathématiques',
        'ht', 'Leson matematik',
        'ar', 'دروس الرياضيات'
      ),
      jsonb_build_object(
        'en', 'One-on-one math tutoring from elementary through high school. Final scope and price confirmed before work begins.',
        'es', 'Tutoría individual de matemáticas desde primaria hasta secundaria. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Cours particuliers de mathématiques du primaire au lycée. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Leson matematik endividyèl de primè rive segondè. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'دروس رياضيات فردية من المرحلة الابتدائية حتى الثانوية. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      10
    ),
    (
      'tutoring', 'reading-writing-tutoring',
      jsonb_build_object(
        'en', 'Reading and Writing Tutoring',
        'es', 'Tutoría de lectura y escritura',
        'fr', 'Cours de lecture et d''écriture',
        'ht', 'Leson lekti ak ekriti',
        'ar', 'دروس القراءة والكتابة'
      ),
      jsonb_build_object(
        'en', 'Reading and writing tutoring with phonics, comprehension, and essay support. Final scope and price confirmed before work begins.',
        'es', 'Tutoría de lectura y escritura con fonética, comprensión y apoyo en redacción. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Cours de lecture et d''écriture avec phonétique, compréhension et aide à la rédaction. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Leson lekti ak ekriti ak fonetik, konpreyansyon ak sipò redaksyon. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'دروس القراءة والكتابة مع الصوتيات والفهم ودعم كتابة المقالات. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      20
    ),
    (
      'tutoring', 'science-tutoring',
      jsonb_build_object(
        'en', 'Science Tutoring',
        'es', 'Tutoría de ciencias',
        'fr', 'Cours de sciences',
        'ht', 'Leson syans',
        'ar', 'دروس العلوم'
      ),
      jsonb_build_object(
        'en', 'Science tutoring covering biology, chemistry, and physics fundamentals. Final scope and price confirmed before work begins.',
        'es', 'Tutoría de ciencias que cubre fundamentos de biología, química y física. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Cours de sciences couvrant les fondamentaux de la biologie, de la chimie et de la physique. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Leson syans ki kouvri baz byoloji, chimi ak fizik. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'دروس العلوم تغطي أساسيات الأحياء والكيمياء والفيزياء. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      30
    ),
    (
      'tutoring', 'test-prep-tutoring',
      jsonb_build_object(
        'en', 'Test Prep Tutoring',
        'es', 'Preparación para exámenes',
        'fr', 'Préparation aux examens',
        'ht', 'Preparasyon egzamen',
        'ar', 'التحضير للاختبارات'
      ),
      jsonb_build_object(
        'en', 'Test preparation for school exams and standardized tests. Final scope and price confirmed before work begins.',
        'es', 'Preparación para exámenes escolares y pruebas estandarizadas. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Préparation aux examens scolaires et aux tests standardisés. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Preparasyon pou egzamen lekòl ak tès estanda. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'التحضير للاختبارات المدرسية والاختبارات الموحدة. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      40
    ),
    (
      'tutoring', 'homework-help',
      jsonb_build_object(
        'en', 'Homework Help',
        'es', 'Ayuda con la tarea',
        'fr', 'Aide aux devoirs',
        'ht', 'Èd devwa',
        'ar', 'المساعدة في الواجبات'
      ),
      jsonb_build_object(
        'en', 'After-school homework help with study habits and organization. Final scope and price confirmed before work begins.',
        'es', 'Ayuda con la tarea después de la escuela, con hábitos de estudio y organización. El alcance final y el precio se confirman antes de comenzar.',
        'fr', 'Aide aux devoirs après l''école, avec méthodes de travail et organisation. Le périmètre final et le prix sont confirmés avant le début des travaux.',
        'ht', 'Èd devwa apre lekòl ak abitid etid ak òganizasyon. Yo konfime travay final la ak pri a anvan travay la kòmanse.',
        'ar', 'مساعدة في الواجبات بعد المدرسة مع عادات الدراسة والتنظيم. يتم تأكيد النطاق النهائي والسعر قبل بدء العمل.'
      ),
      50
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

WITH seeded(category_slug, slug, name_i18n, description_i18n, icon_key, display_order) AS (
  VALUES
    -- Roofing,
    ('roofing', 'extension-ladder', jsonb_build_object(
        'en', 'Extension Ladder',
        'es', 'Escalera extensible',
        'fr', 'Échelle coulissante',
        'ht', 'Nechèl ekstansyon',
        'ar', 'سلم تمديد'
      ), jsonb_build_object(
        'en', 'Ladder for safe access to roofs and high exterior areas during approved work.',
        'es', 'Escalera para acceder con seguridad a techos y zonas exteriores altas durante trabajos aprobados.',
        'fr', 'Échelle pour accéder en sécurité aux toitures et zones extérieures en hauteur lors de travaux approuvés.',
        'ht', 'Nechèl pou aksè an sekirite sou twati ak zòn deyò ki wo pandan travay ki apwouve.',
        'ar', 'سلم للوصول الآمن إلى الأسقف والمناطق الخارجية المرتفعة أثناء العمل المعتمد.'
      ), 'home', 40),
    ('roofing', 'roofing-nailer', jsonb_build_object(
        'en', 'Roofing Nailer',
        'es', 'Clavadora para techos',
        'fr', 'Cloueuse à toiture',
        'ht', 'Klouzè twati',
        'ar', 'مسدس مسامير الأسقف'
      ), jsonb_build_object(
        'en', 'Nailer for fastening shingles and roofing materials during approved work.',
        'es', 'Clavadora para fijar tejas y materiales de techado durante trabajos aprobados.',
        'fr', 'Cloueuse pour fixer les bardeaux et matériaux de toiture lors de travaux approuvés.',
        'ht', 'Klouzè pou fikse bardeau ak materyèl twati pandan travay ki apwouve.',
        'ar', 'مسدس مسامير لتثبيت القرميد ومواد الأسقف أثناء العمل المعتمد.'
      ), 'home', 50),
    ('roofing', 'moisture-meter', jsonb_build_object(
        'en', 'Moisture Meter',
        'es', 'Medidor de humedad',
        'fr', 'Humidimètre',
        'ht', 'Mèt imidite',
        'ar', 'مقياس الرطوبة'
      ), jsonb_build_object(
        'en', 'Meter for documenting moisture conditions during a roofing assessment.',
        'es', 'Medidor para documentar las condiciones de humedad durante una evaluación de techado.',
        'fr', 'Appareil pour documenter l''humidité lors d''une évaluation de toiture.',
        'ht', 'Mèt pou dokimante kondisyon imidite pandan yon evalyasyon twati.',
        'ar', 'مقياس لتوثيق حالة الرطوبة أثناء تقييم السقف.'
      ), 'droplets', 60),
    ('roofing', 'safety-harness', jsonb_build_object(
        'en', 'Safety Harness',
        'es', 'Arnés de seguridad',
        'fr', 'Harnais de sécurité',
        'ht', 'Ekipman sekirite kò',
        'ar', 'حزام الأمان'
      ), jsonb_build_object(
        'en', 'Fall protection equipment used during approved elevated work.',
        'es', 'Equipo de protección contra caídas usado durante trabajos aprobados en altura.',
        'fr', 'Équipement antichute utilisé lors de travaux approuvés en hauteur.',
        'ht', 'Ekipman pwoteksyon kont tonbe yo itilize pandan travay ki apwouve an wotè.',
        'ar', 'معدات الحماية من السقوط المستخدمة أثناء العمل المعتمد في المرتفعات.'
      ), 'shield-check', 70),
    -- Flooring,
    ('flooring', 'tile-cutter', jsonb_build_object(
        'en', 'Tile Cutter',
        'es', 'Cortadora de cerámica',
        'fr', 'Coupe-carreaux',
        'ht', 'Koutè mozayik',
        'ar', 'قاطع البلاط'
      ), jsonb_build_object(
        'en', 'Cutter for measured tile cuts during approved flooring work.',
        'es', 'Cortadora para cortes medidos de cerámica durante trabajos de pisos aprobados.',
        'fr', 'Coupe-carreaux pour les coupes mesurées lors de travaux de sols approuvés.',
        'ht', 'Koutè pou koupe mozayik mezire pandan travay planche ki apwouve.',
        'ar', 'قاطع لقطع البلاط المقاسة أثناء أعمال الأرضيات المعتمدة.'
      ), 'layers', 40),
    ('flooring', 'floor-sander', jsonb_build_object(
        'en', 'Floor Sander',
        'es', 'Lijadora de pisos',
        'fr', 'Ponceuse à parquet',
        'ht', 'Machin lisaj planche',
        'ar', 'آلة صنفرة الأرضيات'
      ), jsonb_build_object(
        'en', 'Sander for refinishing wood floors after the service scope is confirmed.',
        'es', 'Lijadora para renovar pisos de madera después de confirmar el alcance.',
        'fr', 'Ponceuse pour rénover les parquets après confirmation du périmètre.',
        'ht', 'Machin lisaj pou renouvle planche bwa apre yo konfime travay la.',
        'ar', 'آلة صنفرة لتجديد الأرضيات الخشبية بعد تأكيد نطاق الخدمة.'
      ), 'layers', 50),
    ('flooring', 'laser-distance-measurer', jsonb_build_object(
        'en', 'Laser Distance Measurer',
        'es', 'Medidor láser de distancia',
        'fr', 'Télémètre laser',
        'ht', 'Mèt distans lazè',
        'ar', 'جهاز قياس المسافة بالليزر'
      ), jsonb_build_object(
        'en', 'Laser tool for documenting room measurements during an assessment.',
        'es', 'Herramienta láser para documentar medidas de habitaciones durante una evaluación.',
        'fr', 'Outil laser pour documenter les mesures des pièces lors d’une évaluation.',
        'ht', 'Zouti lazè pou dokimante mezi chanm pandan yon evalyasyon.',
        'ar', 'أداة ليزر لتوثيق قياسات الغرف أثناء التقييم.'
      ), 'ruler', 60),
    ('flooring', 'knee-pads', jsonb_build_object(
        'en', 'Knee Pads',
        'es', 'Rodilleras',
        'fr', 'Genouillères',
        'ht', 'Pwotèj jenou',
        'ar', 'واقيات الركبة'
      ), jsonb_build_object(
        'en', 'Protective equipment used during approved floor-level work.',
        'es', 'Equipo de protección usado durante trabajos aprobados a nivel del piso.',
        'fr', 'Équipement de protection utilisé lors de travaux approuvés au niveau du sol.',
        'ht', 'Ekipman pwoteksyon yo itilize pandan travay ki apwouve nan nivo tè a.',
        'ar', 'معدات حماية تستخدم أثناء العمل المعتمد على مستوى الأرضية.'
      ), 'shield-check', 70),
    -- Concrete,
    ('concrete', 'concrete-mixer', jsonb_build_object(
        'en', 'Concrete Mixer',
        'es', 'Mezcladora de concreto',
        'fr', 'Bétonnière',
        'ht', 'Melanjè beton',
        'ar', 'خلاطة الخرسانة'
      ), jsonb_build_object(
        'en', 'Mixer for small-batch concrete work after the service scope is confirmed.',
        'es', 'Mezcladora para trabajos de concreto en pequeñas cantidades después de confirmar el alcance.',
        'fr', 'Bétonnière pour les petits travaux de béton après confirmation du périmètre.',
        'ht', 'Melanjè pou ti travay beton apre yo konfime travay la.',
        'ar', 'خلاطة لأعمال الخرسانة بكميات صغيرة بعد تأكيد نطاق الخدمة.'
      ), 'hard-hat', 40),
    ('concrete', 'bull-float', jsonb_build_object(
        'en', 'Bull Float',
        'es', 'Llana grande',
        'fr', 'Taloche',
        'ht', 'Talòch',
        'ar', 'مسطرين تسوية'
      ), jsonb_build_object(
        'en', 'Float for smoothing freshly poured concrete surfaces.',
        'es', 'Llana para alisar superficies de concreto recién vertido.',
        'fr', 'Taloche pour lisser les surfaces de béton fraîchement coulé.',
        'ht', 'Talòch pou lise sifas beton ki fèk koule.',
        'ar', 'مسطرين لتنعيم أسطح الخرسانة المصبوبة حديثاً.'
      ), 'hard-hat', 50),
    ('concrete', 'concrete-saw', jsonb_build_object(
        'en', 'Concrete Saw',
        'es', 'Sierra para concreto',
        'fr', 'Scie à béton',
        'ht', 'Sye beton',
        'ar', 'منشار الخرسانة'
      ), jsonb_build_object(
        'en', 'Saw for measured concrete cuts during approved demolition or repair work.',
        'es', 'Sierra para cortes medidos de concreto durante demoliciones o reparaciones aprobadas.',
        'fr', 'Scie pour les coupes de béton mesurées lors de démolitions ou réparations approuvées.',
        'ht', 'Sye pou koupe beton mezire pandan demolisyon oswa reparasyon ki apwouve.',
        'ar', 'منشار لقطع الخرسانة المقاسة أثناء أعمال الهدم أو الإصلاح المعتمدة.'
      ), 'hard-hat', 60),
    ('concrete', 'margin-trowel-set', jsonb_build_object(
        'en', 'Margin Trowel Set',
        'es', 'Juego de paletas de margen',
        'fr', 'Jeu de truelles à joints',
        'ht', 'Seri ti talòch',
        'ar', 'مجموعة مسطارين الحواف'
      ), jsonb_build_object(
        'en', 'Hand tools for edge and detail finishing of concrete surfaces.',
        'es', 'Herramientas manuales para el acabado de bordes y detalles de superficies de concreto.',
        'fr', 'Outils à main pour la finition des bords et détails des surfaces en béton.',
        'ht', 'Zouti men pou fini bor ak detay sifas beton.',
        'ar', 'أدوات يدوية لتشطيب الحواف والتفاصيل الدقيقة لأسطح الخرسانة.'
      ), 'hard-hat', 70),
    -- Welding,
    ('welding', 'welding-machine', jsonb_build_object(
        'en', 'Welding Machine',
        'es', 'Máquina de soldar',
        'fr', 'Poste à souder',
        'ht', 'Machin soudi',
        'ar', 'ماكينة اللحام'
      ), jsonb_build_object(
        'en', 'Machine for approved metal welding and fabrication work.',
        'es', 'Máquina para trabajos aprobados de soldadura y fabricación de metal.',
        'fr', 'Poste pour les travaux approuvés de soudure et de fabrication métallique.',
        'ht', 'Machin pou travay soudi ak fabrikasyon metal ki apwouve.',
        'ar', 'ماكينة لأعمال اللحام والتصنيع المعدني المعتمدة.'
      ), 'flame', 40),
    ('welding', 'welding-helmet', jsonb_build_object(
        'en', 'Welding Helmet',
        'es', 'Casco de soldador',
        'fr', 'Casque de soudage',
        'ht', 'Kas soudi',
        'ar', 'خوذة اللحام'
      ), jsonb_build_object(
        'en', 'Protective helmet used during approved welding work.',
        'es', 'Casco de protección usado durante trabajos de soldadura aprobados.',
        'fr', 'Casque de protection utilisé lors de travaux de soudage approuvés.',
        'ht', 'Kas pwoteksyon yo itilize pandan travay soudi ki apwouve.',
        'ar', 'خوذة حماية تستخدم أثناء أعمال اللحام المعتمدة.'
      ), 'shield-check', 50),
    ('welding', 'angle-grinder', jsonb_build_object(
        'en', 'Angle Grinder',
        'es', 'Amoladora angular',
        'fr', 'Meuleuse d''angle',
        'ht', 'Moulen ang',
        'ar', 'جلاخة زاوية'
      ), jsonb_build_object(
        'en', 'Grinder for cutting and smoothing metal during approved work.',
        'es', 'Amoladora para cortar y alisar metal durante trabajos aprobados.',
        'fr', 'Meuleuse pour couper et lisser le métal lors de travaux approuvés.',
        'ht', 'Moulen pou koupe ak lise metal pandan travay ki apwouve.',
        'ar', 'جلاخة لقطع وتنعيم المعدن أثناء العمل المعتمد.'
      ), 'flame', 60),
    ('welding', 'magnetic-welding-squares', jsonb_build_object(
        'en', 'Magnetic Welding Squares',
        'es', 'Escuadras magnéticas de soldadura',
        'fr', 'Équerres magnétiques de soudage',
        'ht', 'Ekè mayetik soudi',
        'ar', 'زوايا لحام مغناطيسية'
      ), jsonb_build_object(
        'en', 'Squares for holding metal at right angles during approved welding work.',
        'es', 'Escuadras para sujetar el metal en ángulo recto durante trabajos de soldadura aprobados.',
        'fr', 'Équerres pour maintenir le métal à angle droit lors de travaux de soudage approuvés.',
        'ht', 'Ekè pou kenbe metal nan bon ang pandan travay soudi ki apwouve.',
        'ar', 'زوايا لتثبيت المعدن بزاوية قائمة أثناء أعمال اللحام المعتمدة.'
      ), 'flame', 70),
    -- Home Repair,
    ('home-repair', 'oscillating-multi-tool', jsonb_build_object(
        'en', 'Oscillating Multi-Tool',
        'es', 'Multiherramienta oscilante',
        'fr', 'Outil multifonction oscillant',
        'ht', 'Zouti milti osilan',
        'ar', 'أداة متعددة متذبذبة'
      ), jsonb_build_object(
        'en', 'Tool for cutting, sanding, and scraping during approved repair work.',
        'es', 'Herramienta para cortar, lijar y raspar durante reparaciones aprobadas.',
        'fr', 'Outil pour couper, poncer et gratter lors de réparations approuvées.',
        'ht', 'Zouti pou koupe, lise ak grate pandan reparasyon ki apwouve.',
        'ar', 'أداة للقطع والصنفرة والكشط أثناء أعمال الإصلاح المعتمدة.'
      ), 'wrench', 40),
    ('home-repair', 'step-ladder', jsonb_build_object(
        'en', 'Step Ladder',
        'es', 'Escalera de tijera',
        'fr', 'Escabeau',
        'ht', 'Nechèl ti mach',
        'ar', 'سلم درجات'
      ), jsonb_build_object(
        'en', 'Ladder for safe access to elevated areas during approved work.',
        'es', 'Escalera para acceder con seguridad a zonas elevadas durante trabajos aprobados.',
        'fr', 'Escabeau pour accéder en sécurité aux zones en hauteur lors de travaux approuvés.',
        'ht', 'Nechèl pou aksè an sekirite nan zòn ki wo pandan travay ki apwouve.',
        'ar', 'سلم للوصول الآمن إلى المناطق المرتفعة أثناء العمل المعتمد.'
      ), 'wrench', 50),
    ('home-repair', 'tape-measure', jsonb_build_object(
        'en', 'Tape Measure',
        'es', 'Cinta métrica',
        'fr', 'Mètre ruban',
        'ht', 'Mèt mezire',
        'ar', 'شريط قياس'
      ), jsonb_build_object(
        'en', 'Tape for documenting measurements during an assessment or repair.',
        'es', 'Cinta para documentar medidas durante una evaluación o reparación.',
        'fr', 'Mètre ruban pour documenter les mesures lors d’une évaluation ou réparation.',
        'ht', 'Mèt pou dokimante mezi pandan yon evalyasyon oswa reparasyon.',
        'ar', 'شريط لتوثيق القياسات أثناء التقييم أو الإصلاح.'
      ), 'ruler', 60),
    ('home-repair', 'tool-belt', jsonb_build_object(
        'en', 'Tool Belt',
        'es', 'Cinturón de herramientas',
        'fr', 'Ceinture à outils',
        'ht', 'Sentiron zouti',
        'ar', 'حزام الأدوات'
      ), jsonb_build_object(
        'en', 'Belt for carrying hand tools during approved repair visits.',
        'es', 'Cinturón para llevar herramientas manuales durante visitas de reparación aprobadas.',
        'fr', 'Ceinture pour porter les outils à main lors de visites de réparation approuvées.',
        'ht', 'Sentiron pou pote zouti men pandan vizit reparasyon ki apwouve.',
        'ar', 'حزام لحمل الأدوات اليدوية أثناء زيارات الإصلاح المعتمدة.'
      ), 'wrench', 70),
    -- Home Security,
    ('security', 'cctv-tester', jsonb_build_object(
        'en', 'Camera Tester',
        'es', 'Probador de cámaras',
        'fr', 'Testeur de caméras',
        'ht', 'Tès kamera',
        'ar', 'فاحص الكاميرات'
      ), jsonb_build_object(
        'en', 'Tester for confirming camera feeds before an installation is signed off.',
        'es', 'Probador para confirmar las señales de las cámaras antes de aprobar una instalación.',
        'fr', 'Testeur pour confirmer les flux des caméras avant la validation d''une installation.',
        'ht', 'Tès pou konfime imaj kamera yo anvan yo apwouve yon enstalasyon.',
        'ar', 'فاحص لتأكيد بث الكاميرات قبل اعتماد التركيب.'
      ), 'shield', 40),
    ('security', 'ethernet-cable-tester', jsonb_build_object(
        'en', 'Network Cable Tester',
        'es', 'Probador de cables de red',
        'fr', 'Testeur de câbles réseau',
        'ht', 'Tès kab rezo',
        'ar', 'فاحص كابلات الشبكة'
      ), jsonb_build_object(
        'en', 'Tester for confirming network cable runs during a security installation.',
        'es', 'Probador para confirmar el tendido de cables de red durante una instalación de seguridad.',
        'fr', 'Testeur pour confirmer les passages de câbles réseau lors d’une installation de sécurité.',
        'ht', 'Tès pou konfime kab rezo yo pandan yon enstalasyon sekirite.',
        'ar', 'فاحص لتأكيد تمديدات كابلات الشبكة أثناء تركيب أنظمة الأمن.'
      ), 'shield', 50),
    ('security', 'impact-driver', jsonb_build_object(
        'en', 'Impact Driver',
        'es', 'Atornillador de impacto',
        'fr', 'Visseuse à chocs',
        'ht', 'Visèz chok',
        'ar', 'مفك صدمي'
      ), jsonb_build_object(
        'en', 'Driver for mounting cameras and hardware during approved installations.',
        'es', 'Atornillador para montar cámaras y accesorios durante instalaciones aprobadas.',
        'fr', 'Visseuse pour monter les caméras et le matériel lors d’installations approuvées.',
        'ht', 'Visèz pou monte kamera ak ekipman pandan enstalasyon ki apwouve.',
        'ar', 'مفك لتركيب الكاميرات والمعدات أثناء عمليات التركيب المعتمدة.'
      ), 'drill', 60),
    ('security', 'wire-fish-rods', jsonb_build_object(
        'en', 'Wire Fish Rods',
        'es', 'Varillas pasacables',
        'fr', 'Tiges tire-fil',
        'ht', 'Bat pas fil',
        'ar', 'قضبان سحب الأسلاك'
      ), jsonb_build_object(
        'en', 'Rods for routing cable through walls during approved installations.',
        'es', 'Varillas para pasar cables por las paredes durante instalaciones aprobadas.',
        'fr', 'Tiges pour acheminer les câbles dans les murs lors d’installations approuvées.',
        'ht', 'Bat pou pase kab nan mi pandan enstalasyon ki apwouve.',
        'ar', 'قضبان لتمرير الكابلات عبر الجدران أثناء عمليات التركيب المعتمدة.'
      ), 'shield', 70),
    -- Pet Care,
    ('pet-care', 'pet-carrier', jsonb_build_object(
        'en', 'Pet Carrier',
        'es', 'Transportadora para mascotas',
        'fr', 'Cage de transport',
        'ht', 'Kaj transpò bèt',
        'ar', 'حامل الحيوانات'
      ), jsonb_build_object(
        'en', 'Carrier for safe pet transport during approved pet care services.',
        'es', 'Transportadora para el traslado seguro de mascotas durante servicios aprobados.',
        'fr', 'Cage pour le transport sécurisé des animaux lors de services approuvés.',
        'ht', 'Kaj pou transpòte bèt an sekirite pandan sèvis swen bèt ki apwouve.',
        'ar', 'حامل لنقل الحيوانات بأمان أثناء خدمات رعاية الحيوانات المعتمدة.'
      ), 'paw-print', 40),
    ('pet-care', 'leash-and-collar-set', jsonb_build_object(
        'en', 'Leash and Collar Set',
        'es', 'Juego de correa y collar',
        'fr', 'Laisse et collier',
        'ht', 'Lès ak kolye',
        'ar', 'طقم المقود والطوق'
      ), jsonb_build_object(
        'en', 'Walking equipment used during scheduled dog walks.',
        'es', 'Equipo de paseo usado durante los paseos de perros programados.',
        'fr', 'Équipement de promenade utilisé lors des promenades de chiens planifiées.',
        'ht', 'Ekipman pwomnad yo itilize pandan pwomnad chen pwograme.',
        'ar', 'معدات التمشية المستخدمة أثناء تمشية الكلاب المجدولة.'
      ), 'paw-print', 50),
    ('pet-care', 'grooming-brush-set', jsonb_build_object(
        'en', 'Grooming Brush Set',
        'es', 'Juego de cepillos de peluquería',
        'fr', 'Brosse de toilettage',
        'ht', 'Seri bwòs twalèt',
        'ar', 'طقم فرش العناية'
      ), jsonb_build_object(
        'en', 'Brushes for coat care during approved grooming services.',
        'es', 'Cepillos para el cuidado del pelaje durante servicios de peluquería aprobados.',
        'fr', 'Brosses pour le soin du pelage lors de services de toilettage approuvés.',
        'ht', 'Bwòs pou swen fouri pandan sèvis twalèt ki apwouve.',
        'ar', 'فرش للعناية بالفراء أثناء خدمات العناية المعتمدة.'
      ), 'sparkles', 60),
    ('pet-care', 'pet-first-aid-kit', jsonb_build_object(
        'en', 'Pet First Aid Kit',
        'es', 'Botiquín de primeros auxilios para mascotas',
        'fr', 'Trousse de secours pour animaux',
        'ht', 'Twous premye swen bèt',
        'ar', 'عدة الإسعافات الأولية للحيوانات'
      ), jsonb_build_object(
        'en', 'First aid supplies carried during pet care visits.',
        'es', 'Suministros de primeros auxilios llevados durante las visitas de cuidado de mascotas.',
        'fr', 'Fournitures de premiers secours emportées lors des visites de garde d’animaux.',
        'ht', 'Founiti premye swen yo pote pandan vizit swen bèt.',
        'ar', 'مستلزمات الإسعافات الأولية المحمولة أثناء زيارات رعاية الحيوانات.'
      ), 'shield-check', 70),
    -- Tutoring,
    ('tutoring', 'whiteboard-easel', jsonb_build_object(
        'en', 'Whiteboard Easel',
        'es', 'Caballete con pizarra',
        'fr', 'Chevalet avec tableau blanc',
        'ht', 'Chevalè ak tablo blan',
        'ar', 'حامل سبورة بيضاء'
      ), jsonb_build_object(
        'en', 'Easel for working through problems during tutoring sessions.',
        'es', 'Caballete para resolver problemas durante las sesiones de tutoría.',
        'fr', 'Chevalet pour résoudre des problèmes pendant les séances de cours.',
        'ht', 'Chevalè pou rezoud pwoblèm pandan sesyon leson.',
        'ar', 'حامل لحل المسائل أثناء جلسات الدروس الخصوصية.'
      ), 'graduation-cap', 40),
    ('tutoring', 'workbook-set', jsonb_build_object(
        'en', 'Workbook Set',
        'es', 'Juego de cuadernos de ejercicios',
        'fr', 'Cahiers d''exercices',
        'ht', 'Kayè egzèsis',
        'ar', 'طقم كراسات التمارين'
      ), jsonb_build_object(
        'en', 'Practice materials selected for the student’s level and goals.',
        'es', 'Materiales de práctica seleccionados según el nivel y los objetivos del estudiante.',
        'fr', 'Matériel d’exercices choisi selon le niveau et les objectifs de l’élève.',
        'ht', 'Materyèl pratik yo chwazi selon nivo ak objektif elèv la.',
        'ar', 'مواد تدريبية مختارة حسب مستوى الطالب وأهدافه.'
      ), 'graduation-cap', 50),
    ('tutoring', 'graphing-calculator', jsonb_build_object(
        'en', 'Graphing Calculator',
        'es', 'Calculadora gráfica',
        'fr', 'Calculatrice graphique',
        'ht', 'Kalkilatris grafik',
        'ar', 'آلة حاسبة بيانية'
      ), jsonb_build_object(
        'en', 'Calculator for math and science tutoring sessions.',
        'es', 'Calculadora para sesiones de tutoría de matemáticas y ciencias.',
        'fr', 'Calculatrice pour les séances de cours de mathématiques et de sciences.',
        'ht', 'Kalkilatris pou sesyon leson matematik ak syans.',
        'ar', 'آلة حاسبة لجلسات دروس الرياضيات والعلوم.'
      ), 'graduation-cap', 60),
    ('tutoring', 'study-headphones', jsonb_build_object(
        'en', 'Study Headphones',
        'es', 'Auriculares para estudiar',
        'fr', 'Casque d’étude',
        'ht', 'Kas ekout pou etidye',
        'ar', 'سماعات الدراسة'
      ), jsonb_build_object(
        'en', 'Headphones for focused work during tutoring sessions.',
        'es', 'Auriculares para trabajar con concentración durante las sesiones de tutoría.',
        'fr', 'Casque pour un travail concentré pendant les séances de cours.',
        'ht', 'Kas ekout pou travay ak konsantrasyon pandan sesyon leson.',
        'ar', 'سماعات للعمل بتركيز أثناء جلسات الدروس الخصوصية.'
      ), 'monitor-smartphone', 70)
),
inserted AS (
  INSERT INTO direct_catalog_tools (
    category_slug, slug, name_i18n, description_i18n, icon_key,
    availability_days, available_days, sort_order, display_order, is_active,
    is_published, lifecycle_status, is_operationally_available, is_bookable,
    is_featured, published_at
  )
  SELECT category_slug, slug, name_i18n, description_i18n, icon_key,
    '["Monday","Tuesday","Wednesday","Thursday"]'::jsonb, ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday']::TEXT[],
    display_order, display_order, TRUE, TRUE, 'live', TRUE, FALSE, FALSE, CURRENT_TIMESTAMP
  FROM seeded
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug
)

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'tool', inserted.id, NULL, 'live', NULL, 'Published expanded Direct supporting tool inventory'
FROM inserted;

-- Record lifecycle history for the new categories and services.
INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'category', c.id, NULL, 'live', NULL, 'Published Direct remaining-skills catalog expansion'
FROM direct_catalog_categories c
WHERE c.slug IN (
  'roofing', 'flooring', 'concrete', 'welding', 'home-repair', 'security', 'pet-care', 'tutoring'
)
AND NOT EXISTS (
  SELECT 1
  FROM catalog_status_history h
  WHERE h.item_type = 'category' AND h.item_id = c.id
);

INSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)
SELECT 'service', s.id, NULL, 'live', NULL, 'Published Direct remaining-skills catalog expansion'
FROM direct_catalog_services s
WHERE s.slug IN (
  'roof-repair', 'roof-replacement', 'roof-inspection', 'gutter-installation-repair', 'skylight-installation',
  'hardwood-floor-installation', 'laminate-vinyl-flooring', 'tile-floor-installation', 'floor-refinishing', 'carpet-installation',
  'concrete-driveway', 'concrete-patio-walkway', 'concrete-repair-resurfacing', 'stamped-decorative-concrete', 'concrete-demolition-removal',
  'gate-fence-welding', 'custom-metal-fabrication', 'structural-steel-repair', 'trailer-hitch-welding', 'metal-railing-installation',
  'general-handyman-visit', 'drywall-patch-repair', 'door-adjustment-repair', 'fence-repair', 'caulking-weatherproofing',
  'security-camera-installation', 'video-doorbell-installation', 'alarm-system-installation', 'motion-sensor-lighting', 'home-security-assessment',
  'dog-walking', 'pet-sitting', 'pet-grooming', 'pet-waste-removal', 'pet-taxi',
  'math-tutoring', 'reading-writing-tutoring', 'science-tutoring', 'test-prep-tutoring', 'homework-help'
)
AND NOT EXISTS (
  SELECT 1
  FROM catalog_status_history h
  WHERE h.item_type = 'service' AND h.item_id = s.id
);
