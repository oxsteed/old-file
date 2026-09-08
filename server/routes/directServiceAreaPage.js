const fs = require('fs');
const path = require('path');
const escapeHtml = require('../utils/escapeHtml');
const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];
const TEMPLATE_PATH = path.join(__dirname, '../public/direct-service-area/index.html');
const SERVICE_AREA = {
  '@type': 'GeoCircle',
  name: 'Within 60 miles of Springfield, Ohio',
  geoMidpoint: {
    '@type': 'GeoCoordinates',
    latitude: 39.9528,
    longitude: -83.7804,
  },
  geoRadius: 96560.64,
};
const SERVICE_AREA_NAMES = {
  en: 'Within 60 miles of Springfield, Ohio',
  es: 'A menos de 60 millas de Springfield, Ohio',
  fr: 'Dans un rayon de 60 miles autour de Springfield, Ohio',
  ht: 'Nan yon distans 60 mil ak Springfield, Ohio',
  ar: '\u0636\u0645\u0646 60 \u0645\u064a\u0644\u0627\u064b \u0645\u0646 Springfield\u060c Ohio',
};

const COPY = {
  en: {
    language: 'Language',
    languageName: 'English',
    title: 'OxSteed Direct Service Area',
    description: 'Check whether OxSteed Direct can serve your address within 60 miles of Springfield, Ohio.',
    eyebrow: 'OxSteed Direct',
    heading: 'Check service coverage',
    lede: 'OxSteed Direct serves locations within 60 miles of Springfield, Ohio. Enter a ZIP code or address to see whether we can quote work at that location.',
    requestQuote: 'Request a quote',
    checkerLabel: 'Service availability checker',
    zipCode: 'ZIP code',
    check: 'Check',
    address: 'Address or city',
    hint: 'ZIP code is fastest. Full addresses are checked through public geocoding and may take a moment.',
    initialTitle: 'Coverage starts in Springfield, OH 45503.',
    initialBody: 'Current default radius is 60 miles.',
    mapEyebrow: 'Coverage map',
    mapHeading: 'Active Direct areas',
    loadingAreas: 'Loading areas...',
    mapAria: 'Approximate map of active service coverage',
    mapHint: 'Coverage is approximate and final service availability is confirmed during quote review.',
    activeArea: '{{count}} active area',
    activeAreas: '{{count}} active areas',
    outsideCoverage: 'Outside current Direct coverage',
    availableHere: 'OxSteed Direct is available here',
    checking: 'Checking coverage...',
    checkingBody: 'This usually takes just a moment.',
    requiredTitle: 'Enter a ZIP code or address',
    requiredBody: 'A location is required before we can check coverage.',
    unavailableTitle: 'Coverage map unavailable',
    unavailableBody: 'Please try again later.',
    checkFailed: 'Could not check that location',
    checkFailedBody: 'Please try a ZIP code.',
    distanceFrom: '{{location}} is about {{distance}} miles from {{area}}.',
    noAreas: 'No active Direct service areas are configured right now.',
    miles: 'miles',
  },
  es: {
    language: 'Idioma',
    languageName: 'Espa\u00f1ol',
    title: '\u00c1rea de servicio de OxSteed Direct',
    description: 'Comprueba si OxSteed Direct puede atender tu direcci\u00f3n dentro de 60 millas de Springfield, Ohio.',
    eyebrow: 'OxSteed Direct',
    heading: 'Comprueba la cobertura del servicio',
    lede: 'OxSteed Direct atiende ubicaciones dentro de 60 millas de Springfield, Ohio. Escribe un c\u00f3digo postal o una direcci\u00f3n para saber si podemos cotizar el trabajo en ese lugar.',
    requestQuote: 'Solicitar una cotizaci\u00f3n',
    checkerLabel: 'Comprobador de disponibilidad del servicio',
    zipCode: 'C\u00f3digo postal',
    check: 'Consultar',
    address: 'Direcci\u00f3n o ciudad',
    hint: 'El c\u00f3digo postal es m\u00e1s r\u00e1pido. Las direcciones completas se verifican mediante geocodificaci\u00f3n p\u00fablica y pueden tardar un momento.',
    initialTitle: 'La cobertura comienza en Springfield, OH 45503.',
    initialBody: 'El radio predeterminado actual es de 60 millas.',
    mapEyebrow: 'Mapa de cobertura',
    mapHeading: '\u00c1reas Direct activas',
    loadingAreas: 'Cargando \u00e1reas...',
    mapAria: 'Mapa aproximado de la cobertura de servicio activa',
    mapHint: 'La cobertura es aproximada y la disponibilidad final se confirma al revisar la cotizaci\u00f3n.',
    activeArea: '{{count}} \u00e1rea activa',
    activeAreas: '{{count}} \u00e1reas activas',
    outsideCoverage: 'Fuera de la cobertura actual de Direct',
    availableHere: 'OxSteed Direct est\u00e1 disponible aqu\u00ed',
    checking: 'Comprobando la cobertura...',
    checkingBody: 'Normalmente solo tarda un momento.',
    requiredTitle: 'Escribe un c\u00f3digo postal o una direcci\u00f3n',
    requiredBody: 'Necesitamos una ubicaci\u00f3n para comprobar la cobertura.',
    unavailableTitle: 'El mapa de cobertura no est\u00e1 disponible',
    unavailableBody: 'Int\u00e9ntalo de nuevo m\u00e1s tarde.',
    checkFailed: 'No se pudo comprobar esa ubicaci\u00f3n',
    checkFailedBody: 'Prueba con un c\u00f3digo postal.',
    distanceFrom: '{{location}} est\u00e1 a unos {{distance}} millas de {{area}}.',
    noAreas: 'No hay \u00e1reas de servicio Direct activas configuradas en este momento.',
    miles: 'millas',
  },
  fr: {
    language: 'Langue',
    languageName: 'Fran\u00e7ais',
    title: 'Zone de service OxSteed Direct',
    description: 'V\u00e9rifiez si OxSteed Direct peut desservir votre adresse dans un rayon de 60 miles autour de Springfield, Ohio.',
    eyebrow: 'OxSteed Direct',
    heading: 'V\u00e9rifier la zone de service',
    lede: 'OxSteed Direct dessert les lieux situ\u00e9s dans un rayon de 60 miles autour de Springfield, Ohio. Saisissez un code postal ou une adresse pour v\u00e9rifier si nous pouvons proposer un devis.',
    requestQuote: 'Demander un devis',
    checkerLabel: 'V\u00e9rificateur de disponibilit\u00e9 du service',
    zipCode: 'Code postal',
    check: 'V\u00e9rifier',
    address: 'Adresse ou ville',
    hint: 'Le code postal est le plus rapide. Les adresses compl\u00e8tes sont v\u00e9rifi\u00e9es par g\u00e9ocodage public et peuvent prendre un moment.',
    initialTitle: 'La couverture commence \u00e0 Springfield, OH 45503.',
    initialBody: 'Le rayon par d\u00e9faut actuel est de 60 miles.',
    mapEyebrow: 'Carte de couverture',
    mapHeading: 'Zones Direct actives',
    loadingAreas: 'Chargement des zones...',
    mapAria: 'Carte approximative de la couverture active',
    mapHint: 'La couverture est approximative et la disponibilit\u00e9 finale est confirm\u00e9e lors de l\u2019examen du devis.',
    activeArea: '{{count}} zone active',
    activeAreas: '{{count}} zones actives',
    outsideCoverage: 'Hors de la couverture Direct actuelle',
    availableHere: 'OxSteed Direct est disponible ici',
    checking: 'V\u00e9rification de la couverture...',
    checkingBody: 'Cela ne prend g\u00e9n\u00e9ralement qu\u2019un instant.',
    requiredTitle: 'Saisissez un code postal ou une adresse',
    requiredBody: 'Une adresse est n\u00e9cessaire pour v\u00e9rifier la couverture.',
    unavailableTitle: 'Carte de couverture indisponible',
    unavailableBody: 'Veuillez r\u00e9essayer plus tard.',
    checkFailed: 'Impossible de v\u00e9rifier ce lieu',
    checkFailedBody: 'Essayez avec un code postal.',
    distanceFrom: '{{location}} se trouve \u00e0 environ {{distance}} miles de {{area}}.',
    noAreas: 'Aucune zone de service Direct active n\u2019est configur\u00e9e pour le moment.',
    miles: 'miles',
  },
  ht: {
    language: 'Lang',
    languageName: 'Krey\u00f2l ayisyen',
    title: 'Z\u00f2n s\u00e8vis OxSteed Direct',
    description: 'Verifye si OxSteed Direct ka s\u00e8vi adrese w nan yon distans 60 mil ak Springfield, Ohio.',
    eyebrow: 'OxSteed Direct',
    heading: 'Verifye z\u00f2n s\u00e8vis la',
    lede: 'OxSteed Direct s\u00e8vi kote ki nan yon distans 60 mil ak Springfield, Ohio. Antre k\u00f2d postal oswa adrese a pou w konnen si nou ka prepare yon pri pou travay la.',
    requestQuote: 'Mande yon pri',
    checkerLabel: 'Verifikat\u00e8 disponiblite s\u00e8vis',
    zipCode: 'K\u00f2d postal',
    check: 'Verifye',
    address: 'Adrese oswa vil',
    hint: 'K\u00f2d postal la pi rapid. Yo verifye adrese konpl\u00e8 yo ak geokodaj piblik, sa ka pran yon ti moman.',
    initialTitle: 'Kouv\u00e8ti a k\u00f2manse nan Springfield, OH 45503.',
    initialBody: 'Distans default la se 60 mil.',
    mapEyebrow: 'Kat kouv\u00e8ti',
    mapHeading: 'Z\u00f2n Direct ki aktif',
    loadingAreas: 'Z\u00f2n yo ap chaje...',
    mapAria: 'Kat apwoksimatif z\u00f2n s\u00e8vis ki aktif yo',
    mapHint: 'Kouv\u00e8ti a se yon estimasyon; disponiblite final la konfime pandan yo ap revize pri a.',
    activeArea: '{{count}} z\u00f2n aktif',
    activeAreas: '{{count}} z\u00f2n aktif',
    outsideCoverage: 'Kote a dey\u00f2 kouv\u00e8ti Direct la pou kounye a',
    availableHere: 'OxSteed Direct disponib isit la',
    checking: 'N ap verifye kouv\u00e8ti a...',
    checkingBody: 'Sa konn pran yon ti moman sèlman.',
    requiredTitle: 'Antre yon k\u00f2d postal oswa yon adrese',
    requiredBody: 'Nou bezwen yon kote anvan nou verifye kouv\u00e8ti a.',
    unavailableTitle: 'Kat kouv\u00e8ti a pa disponib',
    unavailableBody: 'Eseye ank\u00f2 pita.',
    checkFailed: 'Nou pa t ka verifye kote sa a',
    checkFailedBody: 'Eseye ak yon k\u00f2d postal.',
    distanceFrom: '{{location}} anviwon {{distance}} mil ak {{area}}.',
    noAreas: 'Pa gen okenn z\u00f2n s\u00e8vis Direct ki aktif kounye a.',
    miles: 'mil',
  },
  ar: {
    language: '\u0627\u0644\u0644\u063a\u0629',
    languageName: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629',
    title: '\u0645\u0646\u0637\u0642\u0629 \u062e\u062f\u0645\u0629 OxSteed Direct',
    description: '\u062a\u062d\u0642\u0642 \u0645\u0645\u0627 \u0625\u0630\u0627 \u0643\u0627\u0646\u062a OxSteed Direct \u062a\u062e\u062f\u0645 \u0639\u0646\u0648\u0627\u0646\u0643 \u0636\u0645\u0646 60 \u0645\u064a\u0644\u0627\u064b \u0645\u0646 Springfield\u060c Ohio.',
    eyebrow: 'OxSteed Direct',
    heading: '\u062a\u062d\u0642\u0642 \u0645\u0646 \u0646\u0637\u0627\u0642 \u0627\u0644\u062e\u062f\u0645\u0629',
    lede: '\u062a\u062e\u062f\u0645 OxSteed Direct \u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u0648\u062c\u0648\u062f\u0629 \u0636\u0645\u0646 60 \u0645\u064a\u0644\u0627\u064b \u0645\u0646 Springfield\u060c Ohio. \u0623\u062f\u062e\u0644 \u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0628\u0631\u064a\u062f\u064a \u0623\u0648 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0644\u0645\u0639\u0631\u0641\u0629 \u0645\u0627 \u0625\u0630\u0627 \u0643\u0646\u0627 \u0646\u0633\u062a\u0637\u064a\u0639 \u062a\u0642\u062f\u064a\u0645 \u0639\u0631\u0636 \u0644\u0644\u0639\u0645\u0644.',
    requestQuote: '\u0627\u0637\u0644\u0628 \u0639\u0631\u0636 \u0633\u0639\u0631',
    checkerLabel: '\u0645\u0641\u062d\u0635 \u062a\u0648\u0641\u0631 \u0627\u0644\u062e\u062f\u0645\u0629',
    zipCode: '\u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0628\u0631\u064a\u062f\u064a',
    check: '\u062a\u062d\u0642\u0642',
    address: '\u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0623\u0648 \u0627\u0644\u0645\u062f\u064a\u0646\u0629',
    hint: '\u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0628\u0631\u064a\u062f\u064a \u0623\u0633\u0631\u0639. \u064a\u062a\u0645 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u0639\u0646\u0627\u0648\u064a\u0646 \u0627\u0644\u0643\u0627\u0645\u0644\u0629 \u0639\u0628\u0631 \u062a\u062d\u062f\u064a\u062f \u0627\u0644\u0645\u0648\u0642\u0639 \u0627\u0644\u0639\u0644\u0646\u064a \u0648\u0642\u062f \u064a\u0633\u062a\u063a\u0631\u0642 \u0644\u062d\u0638\u0629.',
    initialTitle: '\u062a\u0628\u062f\u0623 \u0627\u0644\u062a\u063a\u0637\u064a\u0629 \u0641\u064a Springfield\u060c OH 45503.',
    initialBody: '\u0627\u0644\u0646\u0637\u0627\u0642 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a \u0627\u0644\u062d\u0627\u0644\u064a \u0647\u0648 60 \u0645\u064a\u0644\u0627\u064b.',
    mapEyebrow: '\u062e\u0631\u064a\u0637\u0629 \u0627\u0644\u062a\u063a\u0637\u064a\u0629',
    mapHeading: '\u0645\u0646\u0627\u0637\u0642 Direct \u0627\u0644\u0646\u0634\u0637\u0629',
    loadingAreas: '\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u0646\u0627\u0637\u0642...',
    mapAria: '\u062e\u0631\u064a\u0637\u0629 \u062a\u0642\u0631\u064a\u0628\u064a\u0629 \u0644\u0644\u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u0646\u0634\u0637\u0629',
    mapHint: '\u0627\u0644\u062a\u063a\u0637\u064a\u0629 \u062a\u0642\u0631\u064a\u0628\u064a\u0629 \u0648\u064a\u062a\u0645 \u062a\u0623\u0643\u064a\u062f \u062a\u0648\u0641\u0631 \u0627\u0644\u062e\u062f\u0645\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0623\u062b\u0646\u0627\u0621 \u0645\u0631\u0627\u062c\u0639\u0629 \u0639\u0631\u0636 \u0627\u0644\u0633\u0639\u0631.',
    activeArea: '{{count}} \u0645\u0646\u0637\u0642\u0629 \u0646\u0634\u0637\u0629',
    activeAreas: '{{count}} \u0645\u0646\u0627\u0637\u0642 \u0646\u0634\u0637\u0629',
    outsideCoverage: '\u062e\u0627\u0631\u062c \u0646\u0637\u0627\u0642 Direct \u0627\u0644\u062d\u0627\u0644\u064a',
    availableHere: 'OxSteed Direct \u0645\u062a\u0627\u062d \u0647\u0646\u0627',
    checking: '\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u062a\u063a\u0637\u064a\u0629...',
    checkingBody: '\u0647\u0630\u0627 \u0644\u0627 \u064a\u0633\u062a\u063a\u0631\u0642 \u0639\u0627\u062f\u0629 \u0633\u0648\u0649 \u0644\u062d\u0638\u0629.',
    requiredTitle: '\u0623\u062f\u062e\u0644 \u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0628\u0631\u064a\u062f\u064a \u0623\u0648 \u0627\u0644\u0639\u0646\u0648\u0627\u0646',
    requiredBody: '\u0646\u062d\u062a\u0627\u062c \u0625\u0644\u0649 \u0645\u0648\u0642\u0639 \u0642\u0628\u0644 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u062a\u063a\u0637\u064a\u0629.',
    unavailableTitle: '\u062e\u0631\u064a\u0637\u0629 \u0627\u0644\u062a\u063a\u0637\u064a\u0629 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629',
    unavailableBody: '\u064a\u0631\u062c\u0649 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649 \u0644\u0627\u062d\u0642\u0627\u064b.',
    checkFailed: '\u062a\u0639\u0630\u0631 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u0645\u0648\u0642\u0639',
    checkFailedBody: '\u062c\u0631\u0628 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0631\u0645\u0632 \u0628\u0631\u064a\u062f\u064a.',
    distanceFrom: '{{location}} \u062a\u0628\u0639\u062f \u062d\u0648\u0627\u0644\u064a {{distance}} \u0645\u064a\u0644\u0627\u064b \u0639\u0646 {{area}}.',
    noAreas: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0646\u0627\u0637\u0642 \u062e\u062f\u0645\u0629 Direct \u0646\u0634\u0637\u0629 \u0645\u0643\u0648\u0646\u0629 \u062d\u0627\u0644\u064a\u0627\u064b.',
    miles: '\u0645\u064a\u0644',
  },
};

let cachedTemplate = null;

function getLanguage(req) {
  const raw = req?.query?.lang || req?.query?.lng || req?.query?.locale;
  const language = String(raw || '').trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
}

function localizedPageUrl(pagePath, language) {
  const origin = getPublicSiteUrl();
  return language === 'en' ? `${origin}${pagePath}` : `${origin}${pagePath}?lang=${language}`;
}

function localizedUrl(language) {
  return localizedPageUrl('/direct/service-area', language);
}

function getTemplate() {
  if (!cachedTemplate) cachedTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return cachedTemplate;
}

function replaceSlot(html, slot, value) {
  const pattern = new RegExp(`(<[^>]*data-seo-slot="${slot}"[^>]*>)[\\s\\S]*?(</[^>]+>)`, 'i');
  return html.replace(pattern, `$1${escapeHtml(value)}$2`);
}

function replaceMeta(html, identity, value) {
  const pattern = new RegExp(`(<meta\\s+[^>]*${identity}[^>]*content=")[^"]*(")`, 'i');
  return html.replace(pattern, `$1${escapeHtml(value)}$2`);
}

function jsonScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function languageLinks(language) {
  return SUPPORTED_LANGUAGES.map((code) => (
    `<a href="${escapeHtml(localizedUrl(code))}"${code === language ? ' aria-current="page"' : ''}>${escapeHtml(COPY[code].languageName)}</a>`
  )).join(' ');
}

function replaceAttribute(html, identity, attribute, value) {
  const pattern = new RegExp(`(<(?=[^>]*${identity})[^>]*${attribute}=")[^"]*(")`, 'i');
  return html.replace(pattern, `$1${escapeHtml(value)}$2`);
}

function sendDirectServiceAreaPage(req, res) {
  const language = getLanguage(req);
  const copy = COPY[language];
  const origin = getPublicSiteUrl();
  const url = localizedUrl(language);
  const serviceDescription = language === 'en'
    ? 'OxSteed Direct provides home help, delivery, hauling, cleanup, and setup within 60 miles of Springfield, Ohio.'
    : copy.description;
  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: copy.title,
    description: serviceDescription,
    url,
    inLanguage: language,
    serviceType: copy.heading,
    provider: {
      '@type': 'Organization',
      name: 'OxSteed',
      url: `${origin}/`,
      logo: `${origin}/icons/icon-192.png`,
      telephone: '+1-937-408-5169',
    },
    areaServed: {
      ...SERVICE_AREA,
      name: SERVICE_AREA_NAMES[language] || SERVICE_AREA_NAMES.en,
    },
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    inLanguage: language,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'OxSteed', item: language === 'en' ? `${origin}/` : `${origin}/?lang=${language}` },
      { '@type': 'ListItem', position: 2, name: copy.title, item: url },
    ],
  };

  let html = getTemplate()
    .replace(/<html lang="[^"]*">/i, `<html lang="${escapeHtml(language)}" dir="${language === 'ar' ? 'rtl' : 'ltr'}">`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(copy.title)}</title>`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/i, `$1${escapeHtml(url)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/i, `$1${escapeHtml(copy.title)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/i, `$1${escapeHtml(url)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/i, `$1${escapeHtml(copy.title)}$2`);
  html = replaceMeta(html, 'name="description"', copy.description);
  html = replaceMeta(html, 'property="og:description"', copy.description);
  html = replaceMeta(html, 'name="twitter:description"', copy.description);
  html = replaceSlot(html, 'eyebrow', copy.eyebrow);
  html = replaceSlot(html, 'heading', copy.heading);
  html = replaceSlot(html, 'lede', copy.lede);
  html = replaceSlot(html, 'requestQuote', copy.requestQuote);
  html = replaceSlot(html, 'checkerLabel', copy.checkerLabel);
  html = replaceSlot(html, 'zipCode', copy.zipCode);
  html = replaceSlot(html, 'check', copy.check);
  html = replaceSlot(html, 'address', copy.address);
  html = replaceSlot(html, 'hint', copy.hint);
  html = replaceSlot(html, 'initialTitle', copy.initialTitle);
  html = replaceSlot(html, 'initialBody', copy.initialBody);
  html = replaceSlot(html, 'mapEyebrow', copy.mapEyebrow);
  html = replaceSlot(html, 'mapHeading', copy.mapHeading);
  html = replaceSlot(html, 'areaCount', copy.loadingAreas);
  html = replaceSlot(html, 'mapHint', copy.mapHint);
  html = replaceAttribute(html, 'id="map"', 'aria-label', copy.mapAria);
  html = replaceAttribute(html, 'data-seo-slot="requestQuote"', 'href', localizedPageUrl('/direct/request-quote', language));
  html = html.replace(/<nav class="language-links"[\s\S]*?<\/nav>/i, `<nav class="language-links" aria-label="${escapeHtml(copy.language)}">${languageLinks(language)}</nav>`);
  html = html.replace(
    /<main(?=[^>]*class="page")[^>]*>/i,
    `<main id="main-content" class="page" data-service-area-copy="${escapeHtml(JSON.stringify(copy))}">`,
  );
  let schemaIndex = 0;
  html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, () => {
    schemaIndex += 1;
    return schemaIndex === 1 ? jsonScript(serviceSchema) : jsonScript(breadcrumbSchema);
  });
  html = html.replace('</head>', SUPPORTED_LANGUAGES.map((code) => (
    `<link rel="alternate" hreflang="${code}" href="${escapeHtml(localizedUrl(code))}" />`
  )).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${escapeHtml(localizedUrl('en'))}" />\n</head>`);

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Content-Language', language);
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

module.exports = { sendDirectServiceAreaPage };
