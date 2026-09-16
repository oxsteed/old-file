import fs from 'node:fs';
import path from 'node:path';

const locales = ['en', 'es', 'fr', 'ht', 'ar'];
const daysJson = '["Monday", "Tuesday", "Wednesday", "Thursday"]';
const daysSql = "ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday']::TEXT[]";

const scopes = [
  { en: 'Small Residential', es: 'Residencial pequeño', fr: 'Petite résidence', ht: 'Ti kay rezidansyèl', ar: 'سكني صغير' },
  { en: 'Standard Residential', es: 'Residencial estándar', fr: 'Résidence standard', ht: 'Kay rezidansyèl nòmal', ar: 'سكني قياسي' },
  { en: 'Large Residential', es: 'Residencial grande', fr: 'Grande résidence', ht: 'Gwo kay rezidansyèl', ar: 'سكني كبير' },
  { en: 'Apartment or Condo', es: 'Apartamento o condominio', fr: 'Appartement ou copropriété', ht: 'Apatman oswa kondominyòm', ar: 'شقة أو مسكن مشترك' },
  { en: 'Rental Turnover', es: 'Cambio de alquiler', fr: 'Rotation locative', ht: 'Chanjman lokasyon', ar: 'تجهيز بين المستأجرين' },
  { en: 'Move-In Preparation', es: 'Preparación para mudanza', fr: 'Préparation à l’emménagement', ht: 'Preparasyon pou antre', ar: 'تجهيز للانتقال' },
  { en: 'Repair Follow-Up', es: 'Seguimiento de reparación', fr: 'Suivi de réparation', ht: 'Suivi reparasyon', ar: 'متابعة الإصلاح' },
  { en: 'Preventive Maintenance', es: 'Mantenimiento preventivo', fr: 'Entretien préventif', ht: 'Antretyen prevantif', ar: 'صيانة وقائية' },
  { en: 'Accessibility-Focused', es: 'Enfoque de accesibilidad', fr: 'Axé sur l’accessibilité', ht: 'Ki konsantre sou aksesibilite', ar: 'يركز على سهولة الوصول' },
  { en: 'Same-Property Multi-Area', es: 'Varias áreas de una propiedad', fr: 'Plusieurs zones d’une propriété', ht: 'Plizyè zòn menm pwopriyete a', ar: 'عدة مناطق في العقار نفسه' },
  { en: 'Seasonal Preparation', es: 'Preparación estacional', fr: 'Préparation saisonnière', ht: 'Preparasyon sezon', ar: 'تجهيز موسمي' },
  { en: 'Weather-Related Repair', es: 'Reparación por clima', fr: 'Réparation liée aux intempéries', ht: 'Reparasyon ki gen rapò ak move tan', ar: 'إصلاح متعلق بالطقس' },
  { en: 'Pre-Sale Preparation', es: 'Preparación para venta', fr: 'Préparation avant vente', ht: 'Preparasyon anvan vann', ar: 'تجهيز قبل البيع' },
  { en: 'Post-Renovation', es: 'Después de renovación', fr: 'Après rénovation', ht: 'Apre renovasyon', ar: 'بعد التجديد' },
  { en: 'Small Business', es: 'Pequeño negocio', fr: 'Petite entreprise', ht: 'Ti biznis', ar: 'شركة صغيرة' },
  { en: 'Property Manager', es: 'Administrador de propiedad', fr: 'Gestionnaire immobilier', ht: 'Manadjè pwopriyete', ar: 'مدير عقار' },
  { en: 'Emergency Assessment', es: 'Evaluación de emergencia', fr: 'Évaluation d’urgence', ht: 'Evalyasyon ijans', ar: 'تقييم طارئ' },
  { en: 'Scheduled Maintenance', es: 'Mantenimiento programado', fr: 'Entretien planifié', ht: 'Antretyen pwograme', ar: 'صيانة مجدولة' },
  { en: 'Material Consultation', es: 'Consulta de materiales', fr: 'Consultation sur les matériaux', ht: 'Konsiltasyon materyèl', ar: 'استشارة المواد' },
  { en: 'Final Cleanup', es: 'Limpieza final', fr: 'Nettoyage final', ht: 'Netwayaj final', ar: 'تنظيف نهائي' },
];

const categories = [
  {
    slug: 'electrical',
    bases: [
      ['Outlet & Switch Installation', 'Instalación de enchufes e interruptores', 'Installation de prises et interrupteurs', 'Enstalasyon priz ak switch', 'تركيب المقابس والمفاتيح'],
      ['Lighting Fixture Installation', 'Instalación de luminarias', 'Installation de luminaires', 'Enstalasyon aparèy limyè', 'تركيب تركيبات الإضاءة'],
      ['Ceiling Fan Service', 'Servicio de ventiladores de techo', 'Service de ventilateurs de plafond', 'Sèvis vantilatè plafon', 'خدمة مراوح السقف'],
      ['Circuit Breaker Service', 'Servicio de interruptores', 'Service de disjoncteurs', 'Sèvis disjonktè', 'خدمة قواطع الدائرة'],
      ['Electrical Panel Assessment', 'Evaluación del panel eléctrico', 'Évaluation du panneau électrique', 'Evalyasyon panèl elektrik', 'تقييم اللوحة الكهربائية'],
      ['Wiring Inspection', 'Inspección del cableado', 'Inspection du câblage', 'Enspeksyon fil elektrik', 'فحص الأسلاك'],
      ['EV Charger Preparation', 'Preparación de cargador para vehículos eléctricos', 'Préparation de borne pour véhicule électrique', 'Preparasyon chajè machin elektrik', 'تجهيز شاحن سيارة كهربائية'],
      ['Generator Readiness Assessment', 'Evaluación de preparación del generador', 'Évaluation de préparation du générateur', 'Evalyasyon preparasyon jeneratè', 'تقييم جاهزية المولد'],
      ['Smart Home Device Wiring', 'Cableado de dispositivos de hogar inteligente', 'Câblage d’appareils de maison connectée', 'Fil aparèy kay entelijan', 'تمديدات أجهزة المنزل الذكي'],
      ['Smoke and CO Detector Installation', 'Instalación de detectores de humo y CO', 'Installation de détecteurs de fumée et de CO', 'Enstalasyon detektè lafimen ak CO', 'تركيب كاشفات الدخان وأول أكسيد الكربون'],
    ],
  },
  {
    slug: 'plumbing',
    bases: [
      ['Leak Detection', 'Detección de fugas', 'Détection de fuites', 'Deteksyon fuit', 'كشف التسربات'],
      ['Faucet Installation', 'Instalación de grifos', 'Installation de robinets', 'Enstalasyon tiyo dlo', 'تركيب الصنابير'],
      ['Toilet Repair', 'Reparación de inodoros', 'Réparation de toilettes', 'Reparasyon twalèt', 'إصلاح المراحيض'],
      ['Drain Cleaning', 'Limpieza de desagües', 'Nettoyage de canalisations', 'Netwayaj drenaj', 'تنظيف المصارف'],
      ['Pipe Repair', 'Reparación de tuberías', 'Réparation de tuyaux', 'Reparasyon tiyo', 'إصلاح الأنابيب'],
      ['Water Heater Service', 'Servicio de calentadores de agua', 'Service de chauffe-eau', 'Sèvis chofè dlo', 'خدمة سخانات المياه'],
      ['Sump Pump Service', 'Servicio de bombas de sumidero', 'Service de pompes de puisard', 'Sèvis ponp drenaj', 'خدمة مضخات التصريف'],
      ['Garbage Disposal Installation', 'Instalación de trituradores', 'Installation de broyeurs à déchets', 'Enstalasyon moulen fatra', 'تركيب مطاحن النفايات'],
      ['Water Pressure Assessment', 'Evaluación de presión de agua', 'Évaluation de la pression d’eau', 'Evalyasyon presyon dlo', 'تقييم ضغط المياه'],
      ['Shutoff Valve Replacement', 'Reemplazo de válvulas de cierre', 'Remplacement de vannes d’arrêt', 'Ranplasman valv fèmen', 'استبدال صمامات الإغلاق'],
    ],
  },
  {
    slug: 'carpentry',
    bases: [
      ['Door Adjustment', 'Ajuste de puertas', 'Ajustement de portes', 'Ajisteman pòt', 'ضبط الأبواب'],
      ['Trim and Molding Installation', 'Instalación de molduras y acabados', 'Installation de garnitures et moulures', 'Enstalasyon fini ak moulaj', 'تركيب الحواف والقوالب'],
      ['Shelving Installation', 'Instalación de estantes', 'Installation d’étagères', 'Enstalasyon etajè', 'تركيب الرفوف'],
      ['Cabinet Repair', 'Reparación de gabinetes', 'Réparation de meubles de rangement', 'Reparasyon kabinè', 'إصلاح الخزائن'],
      ['Deck Board Repair', 'Reparación de tablas de terraza', 'Réparation de planches de terrasse', 'Reparasyon planch galri', 'إصلاح ألواح السطح الخشبي'],
      ['Stair and Railing Repair', 'Reparación de escaleras y barandillas', 'Réparation d’escaliers et rampes', 'Reparasyon mach ak ranp', 'إصلاح السلالم والدرابزين'],
      ['Furniture Assembly', 'Montaje de muebles', 'Assemblage de meubles', 'Asanble mèb', 'تجميع الأثاث'],
      ['Framing Repair', 'Reparación de estructuras', 'Réparation de charpente', 'Reparasyon kad', 'إصلاح الهياكل الخشبية'],
      ['Drywall Patch', 'Parcheo de paneles de yeso', 'Réparation de cloisons sèches', 'Patch mi sèk', 'ترميم الجدران الجافة'],
      ['Custom Woodwork Consultation', 'Consulta de carpintería personalizada', 'Consultation en menuiserie sur mesure', 'Konsiltasyon travay bwa pèsonalize', 'استشارة أعمال خشبية مخصصة'],
    ],
  },
  {
    slug: 'painting',
    bases: [
      ['Interior Room Painting', 'Pintura de habitaciones interiores', 'Peinture de pièces intérieures', 'Penti chanm andedan', 'طلاء الغرف الداخلية'],
      ['Exterior Surface Painting', 'Pintura de superficies exteriores', 'Peinture de surfaces extérieures', 'Penti sifas deyò', 'طلاء الأسطح الخارجية'],
      ['Cabinet Painting', 'Pintura de gabinetes', 'Peinture de meubles de rangement', 'Penti kabinè', 'طلاء الخزائن'],
      ['Trim Painting', 'Pintura de molduras', 'Peinture des garnitures', 'Penti fini', 'طلاء الحواف'],
      ['Deck Staining', 'Tintado de terrazas', 'Teinture de terrasses', 'Tenti galri', 'صبغ الأسطح الخشبية'],
      ['Drywall Paint Repair', 'Reparación de pintura en yeso', 'Réparation de peinture sur cloison sèche', 'Reparasyon penti mi sèk', 'إصلاح طلاء الجدران الجافة'],
      ['Wallpaper Removal', 'Retiro de papel tapiz', 'Dépose de papier peint', 'Retire papye miray', 'إزالة ورق الجدران'],
      ['Color Consultation', 'Consulta de colores', 'Consultation de couleurs', 'Konsiltasyon koulè', 'استشارة الألوان'],
      ['Door Painting', 'Pintura de puertas', 'Peinture de portes', 'Penti pòt', 'طلاء الأبواب'],
      ['Touch-Up Painting', 'Pintura de retoque', 'Peinture de retouche', 'Penti retouch', 'طلاء اللمسات النهائية'],
    ],
  },
  {
    slug: 'landscaping',
    bases: [
      ['Lawn Mowing', 'Corte de césped', 'Tonte de pelouse', 'Koupe gazon', 'قص العشب'],
      ['Lawn Edging', 'Bordeado de césped', 'Finition des bordures de pelouse', 'Fini bò gazon', 'تشذيب حواف العشب'],
      ['Hedge and Shrub Trimming', 'Recorte de setos y arbustos', 'Taille des haies et arbustes', 'Koupe lantiy ak touf', 'تشذيب الشجيرات والأسيجة'],
      ['Garden Bed Refresh', 'Renovación de parterres', 'Rafraîchissement des massifs', 'Renouvèlman kabann jaden', 'تجديد أحواض الحدائق'],
      ['Mulch Application', 'Aplicación de mantillo', 'Application de paillage', 'Aplikasyon payi', 'وضع النشارة'],
      ['Leaf Cleanup', 'Limpieza de hojas', 'Ramassage des feuilles', 'Netwayaj fèy', 'تنظيف الأوراق'],
      ['Seasonal Yard Cleanup', 'Limpieza estacional del jardín', 'Nettoyage saisonnier du terrain', 'Netwayaj lakou sezon', 'تنظيف الساحة الموسمي'],
      ['Sod Preparation', 'Preparación para césped', 'Préparation pour gazon', 'Preparasyon gazon', 'تجهيز العشب'],
      ['Planting Bed Preparation', 'Preparación de parterres de siembra', 'Préparation de massifs de plantation', 'Preparasyon kabann plante', 'تجهيز أحواض الزراعة'],
      ['Irrigation Visual Inspection', 'Inspección visual de riego', 'Inspection visuelle de l’irrigation', 'Enspeksyon vizyèl irigasyon', 'فحص بصري للري'],
    ],
  },
];

function slugify(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonb(value) {
  return `${sql(JSON.stringify(value))}::jsonb`;
}

const rows = [];
if (categories.length !== 5 || scopes.length !== 20 || categories.some((category) => category.bases.length !== 10)) {
  throw new Error('Expected five categories, twenty scopes, and ten service bases per category');
}

for (const category of categories) {
  category.bases.forEach((baseValues, baseIndex) => {
    const base = Object.fromEntries(locales.map((locale, index) => [locale, baseValues[index]]));
    scopes.forEach((scope, scopeIndex) => {
      const name = Object.fromEntries(locales.map((locale) => [locale, `${base[locale]} - ${scope[locale]}`]));
      const description = {
        en: `Quote-based ${base.en.toLowerCase()} for ${scope.en.toLowerCase()}. Final scope and materials are confirmed before work begins.`,
        es: `Servicio con cotización de ${base.es.toLowerCase()} para ${scope.es.toLowerCase()}. El alcance y los materiales finales se confirman antes de comenzar.`,
        fr: `Service sur devis de ${base.fr.toLowerCase()} pour ${scope.fr.toLowerCase()}. Le périmètre et les matériaux sont confirmés avant le début des travaux.`,
        ht: `Sèvis sou estimasyon pou ${base.ht.toLowerCase()} pou ${scope.ht.toLowerCase()}. Yo konfime travay la ak materyèl yo anvan yo kòmanse.`,
        ar: `خدمة بعرض سعر لـ${base.ar} ضمن نطاق ${scope.ar}. يتم تأكيد النطاق والمواد قبل بدء العمل.`,
      };
      rows.push({
        categorySlug: category.slug,
        slug: `direct-${category.slug}-${slugify(base.en)}-${slugify(scope.en)}`,
        name,
        description,
        sortOrder: (baseIndex + 1) * 100 + scopeIndex + 1,
      });
    });
  });
}

const rowsByCategory = new Map(categories.map((category) => [category.slug, rows.filter((row) => row.categorySlug === category.slug)]));
if (rows.length !== 1000 || new Set(rows.map((row) => row.slug)).size !== rows.length || [...rowsByCategory.values()].some((categoryRows) => categoryRows.length !== 200)) {
  throw new Error(`Expected 1000 unique service rows, got ${rows.length}`);
}
for (const row of rows) {
  for (const locale of locales) {
    if (!row.name[locale] || !row.description[locale]) throw new Error(`Missing ${locale} translation for ${row.slug}`);
  }
}

const values = rows.map((row) => `(${[
  sql(row.categorySlug),
  sql(row.slug),
  jsonb(row.name),
  jsonb(row.description),
  'NULL::INTEGER',
  sql('USD'),
  jsonb(JSON.parse(daysJson)),
  daysSql,
  String(row.sortOrder),
  String(row.sortOrder),
].join(', ')})`).join(',\n');

const migration = `-- Migration 525: publish 1,000 localized Direct service offerings.\n-- Each offering remains quote-based; final scope and materials are confirmed\n-- through the existing request flow before any work is accepted.\n\nWITH seeded(category_slug, slug, name_i18n, description_i18n, price_cents, currency_code, availability_days, available_days, sort_order, display_order) AS (\n  VALUES\n${values}\n),\ninserted AS (\n  INSERT INTO direct_catalog_services (\n    category_id, slug, name_i18n, description_i18n, price_cents, currency_code,\n    availability_days, available_days, sort_order, display_order, is_active,\n    is_published, lifecycle_status, is_operationally_available, is_bookable,\n    is_featured, published_at\n  )\n  SELECT c.id, s.slug, s.name_i18n, s.description_i18n, s.price_cents,\n    s.currency_code, s.availability_days, s.available_days, s.sort_order,\n    s.display_order, TRUE, TRUE, 'live', TRUE, FALSE, FALSE, CURRENT_TIMESTAMP\n  FROM seeded s\n  JOIN direct_catalog_categories c ON c.slug = s.category_slug\n  ON CONFLICT (slug) DO NOTHING\n  RETURNING id, slug\n)\nINSERT INTO catalog_status_history (item_type, item_id, from_status, to_status, changed_by, reason)\nSELECT 'service', inserted.id, NULL, 'live', NULL, 'Published 1,000-service Direct catalog expansion'\nFROM inserted;\n`;

const outputPath = path.resolve(new URL('../server/migrations/525_direct_catalog_1000_services.sql', import.meta.url).pathname);
fs.writeFileSync(outputPath, migration);
console.log(`Generated ${rows.length} services at ${outputPath}`);
