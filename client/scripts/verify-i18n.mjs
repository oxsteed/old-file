import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const languages = ['en', 'es', 'fr', 'ht', 'ar'];

// Catalog files are read many times across checks; cache parsed JSON so the
// new whole-catalog scans stay fast.
const jsonCache = new Map();

function readJson(relativePath) {
  if (!jsonCache.has(relativePath)) {
    const fullPath = path.join(root, relativePath);
    try {
      jsonCache.set(relativePath, JSON.parse(fs.readFileSync(fullPath, 'utf8')));
    } catch (error) {
      throw new Error(`${relativePath}: ${error.message}`);
    }
  }
  return jsonCache.get(relativePath);
}

// Mirrors i18next's deepFind key lookup: at each level the full remaining
// dotted path is tried as a flat key first (the catalogs mix truly nested
// objects and flat dotted keys like "adminSupportTickets.time.justNow"),
// then lookup descends one token.
function resolveCatalogKey(catalog, dottedKey) {
  let node = catalog;
  let rest = dottedKey;
  while (node !== null && typeof node === 'object') {
    if (Object.prototype.hasOwnProperty.call(node, rest)) return node[rest];
    const dot = rest.indexOf('.');
    if (dot === -1) return undefined;
    const head = rest.slice(0, dot);
    if (!Object.prototype.hasOwnProperty.call(node, head)) return undefined;
    node = node[head];
    rest = rest.slice(dot + 1);
  }
  return undefined;
}

function flattenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(child, nextPrefix);
  });
}

function flattenStringValues(value, prefix = '') {
  if (typeof value === 'string') return [[prefix, value]];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenStringValues(child, nextPrefix);
  });
}

function interpolationNames(value) {
  return [...String(value).matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g)]
    .map((match) => match[1])
    .sort();
}

function verifyInterpolationParity(label, pathForLanguage) {
  const english = Object.fromEntries(flattenStringValues(readJson(pathForLanguage('en'))));
  const failures = [];

  for (const language of languages.filter((entry) => entry !== 'en')) {
    const translated = Object.fromEntries(flattenStringValues(readJson(pathForLanguage(language))));
    for (const [key, englishValue] of Object.entries(english)) {
      const translatedValue = translated[key];
      if (typeof translatedValue !== 'string') continue;
      // i18next plural variants may intentionally render a fixed singular or
      // plural phrase, so their count token is not required in every locale.
      if (/_((zero|one|two|few|many|other))$/.test(key)) continue;
      const expected = interpolationNames(englishValue).filter((name) => name !== 's');
      const actual = interpolationNames(translatedValue);
      if (expected.join('|') !== actual.join('|')) {
        failures.push(`${label} ${language} ${key}: expected {{${expected.join(', ')}}}, got {{${actual.join(', ')}}}`);
      }
    }
  }

  if (failures.length) throw new Error(`Interpolation placeholder parity failed:\n${failures.join('\n')}`);
  console.log(`ok ${label} interpolation placeholders match across ${languages.join('/')}`);
}

function pluralStem(key) {
  return key.replace(/_(zero|one|two|few|many|other)$/, '');
}

function isAllowedPluralExtra(key, baseKeys) {
  const stem = pluralStem(key);
  return stem !== key && [...baseKeys].some((baseKey) => pluralStem(baseKey) === stem);
}

function compareKeySets(label, pathForLanguage) {
  const baseKeys = new Set(flattenKeys(readJson(pathForLanguage('en'))));
  const failures = [];

  for (const language of languages) {
    const relativePath = pathForLanguage(language);
    const keys = new Set(flattenKeys(readJson(relativePath)));
    const missing = [...baseKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !baseKeys.has(key) && !isAllowedPluralExtra(key, baseKeys));

    if (missing.length || extra.length) {
      failures.push({
        language,
        relativePath,
        missing,
        extra,
      });
    }
  }

  if (failures.length) {
    const details = failures.map(({ language, relativePath, missing, extra }) => {
      const parts = [`${label} ${language} (${relativePath})`];
      if (missing.length) parts.push(`missing: ${missing.slice(0, 25).join(', ')}`);
      if (extra.length) parts.push(`extra: ${extra.slice(0, 25).join(', ')}`);
      return parts.join('\n  ');
    }).join('\n');
    throw new Error(details);
  }

  console.log(`ok ${label}: ${baseKeys.size} keys across ${languages.join('/')}`);
}

function verifyI18nIndex() {
  const source = fs.readFileSync(path.join(root, 'src/i18n/index.js'), 'utf8');
  for (const language of languages) {
    if (!source.includes(`code: '${language}'`)) {
      throw new Error(`src/i18n/index.js is missing LANGUAGES entry for ${language}`);
    }
    if (!source.includes(`${language}: {`) && !source.includes(`${language}: () =>`)) {
      throw new Error(`src/i18n/index.js is missing resources or lazy loader entry for ${language}`);
    }
  }
  console.log(`ok i18n index declares ${languages.join('/')}`);
}

function verifyCanonicalBrands() {
  const exact = {
    'homePage.company.heading': 'OxSteed',
    'homePage.company.headingDirect': 'OxSteed Direct',
    'network.restaurants.title': 'Local Food Directory',
    'footer.restaurants': 'Local Food Directory',
    'restaurants.nav.entry': 'Local Food Directory',
    'food.nav.entry': 'OxSteed Food',
    'dashboard.customer.foodEyebrow': 'Local Food Directory',
    'food.merchant.landing.eyebrow': 'Local Food Directory',
  };
  const includes = {
    'publicSeo.help.restaurant.title': 'Local Food Directory',
    'publicSeo.help.restaurant.description': 'Local Food Directory',
    'publicSeo.direct.services.title': 'OxSteed Direct',
    'publicSeo.direct.services.description': 'OxSteed Direct',
  };
  const resolve = (value, key) => key.split('.').reduce((child, part) => child?.[part], value);
  const failures = [];

  for (const language of languages) {
    const catalog = readJson(`src/locales/${language}.json`);
    for (const [key, expectedValue] of Object.entries(exact)) {
      const actualValue = resolve(catalog, key);
      if (actualValue !== expectedValue) {
        failures.push(`${language} ${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
      }
    }
    for (const [key, expectedValue] of Object.entries(includes)) {
      const actualValue = resolve(catalog, key);
      if (typeof actualValue !== 'string' || !actualValue.includes(expectedValue)) {
        failures.push(`${language} ${key}: expected to contain ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
      }
    }
  }

  if (failures.length) {
    throw new Error(`Canonical brand values drifted:\n${failures.join('\n')}`);
  }

  console.log(`ok canonical brands remain unchanged across ${languages.join('/')}`);
}

function verifyHomepageTranslationSurface() {
  const english = readJson('src/locales/en.json');
  const resolve = (value, key) => key.split('.').reduce((child, part) => child?.[part], value);
  const translatedKeys = [
    'hero.eyebrow',
    'liveHelpers.verified',
    'homePage.search.searchMode',
    'homePage.search.findHelper',
    'homePage.search.browseJobs',
    'homePage.search.discoverAll',
    'homePage.search.helperLabel',
    'homePage.search.helperPh',
    'homePage.search.jobsLabel',
    'homePage.search.jobsPh',
    'homePage.search.discoverLabel',
    'homePage.search.discoverPh',
    'homePage.search.discoverSearch',
    'homePage.search.findJobs',
    'homePage.search.locationLabel',
    'homePage.search.locationPh',
    'homePage.search.locationSuggestions',
    'homePage.search.skillSuggestions',
    'homePage.search.nearYou',
    'homePage.search.clearSearch',
    'homePage.search.clearLocation',
    'homePage.search.availToday',
    'homePage.search.availTodayTitle',
    'homePage.search.search',
    'homePage.cta.title',
    'homePage.cta.titleEm',
    'homePage.cta.desc',
    'homePage.cta.goToDashboard',
    'homePage.cta.viewDashboard',
    'homePage.cta.listSkills',
    'homePage.cta.postJob',
    'homePage.cta.postJobInstead',
  ];
  const toolKeys = [
    'truckHauling', 'powerDrill', 'ladders', 'pressureWasher',
    'handTools', 'measuringLayout', 'cleanupSupplies', 'phoneInspection',
  ];
  const skillKeys = [
    'sectionTitle', 'sectionSubtitle', 'dontSeeSkill', 'postJobLink',
    'dontSeeEnd', 'showMore', 'showFewer',
    ...['electrical', 'plumbing', 'hvac', 'carpentry', 'painting', 'roofing',
      'flooring', 'landscaping', 'moving', 'cleaning', 'pest-control', 'auto',
      'appliance', 'concrete', 'welding', 'home-repair', 'security', 'pet-care',
      'tutoring'].flatMap((slug) => [
      `tiles.${slug}.name`, `tiles.${slug}.desc`,
    ]),
  ];
  const failures = [];

  for (const language of languages.filter((entry) => entry !== 'en')) {
    const catalog = readJson(`src/locales/${language}.json`);
    for (const key of translatedKeys) {
      const englishValue = resolve(english, key);
      const translatedValue = resolve(catalog, key);
      if (translatedValue === englishValue) {
        failures.push(`${language} ${key} is still English: ${JSON.stringify(translatedValue)}`);
      }
    }
    for (const key of skillKeys) {
      const englishValue = resolve(english, `homePage.skills.${key}`);
      const translatedValue = resolve(catalog, `homePage.skills.${key}`);
      if (translatedValue === englishValue) {
        failures.push(`${language} homePage.skills.${key} is still English: ${JSON.stringify(translatedValue)}`);
      }
    }
  }

  for (const toolKey of toolKeys) {
    const key = `homePage.company.toolList.${toolKey}`;
    for (const language of languages) {
      const value = resolve(readJson(`src/locales/${language}.json`), key);
      if (typeof value !== 'string' || !value.trim()) {
        failures.push(`${language} ${key} is missing or empty`);
      }
    }
  }

  const directCatalogKeys = [
    'skillCategories', 'searchCategories', 'searchCategoriesAria', 'noCategories',
    'directServices', 'availableServices', 'listed', 'searchServices', 'searchServicesAria',
    'quoteRequired', 'scheduleByQuote', 'request', 'selectedService', 'noServices', 'equipment',
    'toolsEquipment', 'searchTools', 'searchToolsAria', 'availableWhenScheduled', 'noTools',
    'serviceCoverage', 'coverageCopy', 'coverageConfiguring', 'checkLocation', 'minimum',
    'heroFallback', 'heroCopyFallback', 'navigation',
    'loading', 'loadError', 'retry',
  ];
  for (const language of languages.filter((entry) => entry !== 'en')) {
    const catalog = readJson(`src/locales/${language}.json`);
    for (const key of directCatalogKeys) {
      const englishValue = resolve(english, `directCatalog.${key}`);
      const translatedValue = resolve(catalog, `directCatalog.${key}`);
      if (typeof translatedValue !== 'string' || !translatedValue.trim()) {
        failures.push(`${language} directCatalog.${key} is missing or empty`);
      } else if (translatedValue === englishValue) {
        failures.push(`${language} directCatalog.${key} is still English: ${JSON.stringify(translatedValue)}`);
      }
    }
  }

  const hardcodedHomepageText = [
    ['src/components/Hero.jsx', 'Local Skills Directory'],
    ['src/components/LiveHelpersHeroCard.tsx', '✓ Verified'],
  ];
  for (const [relativePath, text] of hardcodedHomepageText) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (source.includes(text)) {
      failures.push(`${relativePath} contains hardcoded homepage text: ${text}`);
    }
  }

  const homepageSource = fs.readFileSync(path.join(root, 'src/pages/HomePage.jsx'), 'utf8');
  if (!homepageSource.includes('<DirectCatalogPanels profile={catalogProfile} />')) {
    failures.push('src/pages/HomePage.jsx must render the shared Direct catalog panels');
  }
  if (!homepageSource.includes('function HomeCompanySection()')) {
    failures.push('src/pages/HomePage.jsx must preserve the existing company-card shell');
  }
  for (const obsolete of ['HomeDirectCatalogSection', '<DirectCatalogLanding embedded />']) {
    if (homepageSource.includes(obsolete)) {
      failures.push(`src/pages/HomePage.jsx still contains obsolete homepage catalog wrapper: ${obsolete}`);
    }
  }

  if (failures.length) {
    throw new Error(`Homepage translation coverage failed:\n${failures.join('\n')}`);
  }

  console.log(`ok homepage translation surface is localized across ${languages.join('/')}`);
}

function verifyPageHasNoHardcodedUiText(relativePath, { allowedJsxText = [], allowedAttributes = [] } = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const allowedText = new Set(allowedJsxText);
  const allowedAttributeValues = new Set(allowedAttributes);
  const failures = [];

  const addFailure = (match, value) => {
    const line = source.slice(0, match.index).split('\n').length;
    failures.push(`${relativePath}:${line}: ${value}`);
  };

  for (const match of source.matchAll(/(?<!=)>([^<>{}\n]*[A-Za-z][^<>{}\n]*)<(?![=])/g)) {
    const value = match[1].trim();
    if (value && !allowedText.has(value)) addFailure(match, value);
  }

  for (const match of source.matchAll(/\b(?:title|subtitle|label|placeholder|body|eyebrow|aria-label)="([^"]*[A-Za-z][^"]*)"/g)) {
    const value = match[1].trim();
    if (value && !allowedAttributeValues.has(value)) addFailure(match, value);
  }

  for (const match of source.matchAll(/(?:toast\.(?:error|success)|window\.prompt)\(\s*(['"])([^'"]*[A-Za-z][^'"]*)\1/g)) {
    addFailure(match, match[2].trim());
  }

  if (failures.length) {
    throw new Error(`Hard-coded customer-facing text found:\n${failures.join('\n')}`);
  }

  const legacyEnglish = readJson('src/locales/en.json');
  const missingKeys = [];
  const hasKey = (key) => {
    const resolve = (candidate) => candidate.split('.').reduce((value, part) => value?.[part], legacyEnglish);
    const isLeaf = (value) => value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value));
    return isLeaf(resolve(key)) || isLeaf(resolve(`${key}_one`)) || isLeaf(resolve(`${key}_other`));
  };
  for (const match of source.matchAll(/\bt\(\s*(['"])([A-Za-z0-9_.-]+)\1/g)) {
    if (!hasKey(match[2])) {
      const line = source.slice(0, match.index).split('\n').length;
      missingKeys.push(`${relativePath}:${line}: ${match[2]}`);
    }
  }
  if (missingKeys.length) {
    throw new Error(`Missing translation keys referenced by customer-facing pages:\n${missingKeys.join('\n')}`);
  }

  console.log(`ok ${relativePath} has no unapproved hard-coded UI text or missing static keys`);
}

function verifyCreditTranslationSurface() {
  const creditKeys = new Set(flattenKeys(readJson('src/i18n/locales/en/credit.json')));
  const pages = [
    'src/pages/food/OxsteedCreditPage.jsx',
    'src/pages/food/WalletRestaurantWallets.jsx',
    'src/pages/food/OxsteedCreditTransactionPage.jsx',
    'src/pages/food/OxsteedCreditPartnerManager.jsx',
    'src/pages/food/RestaurantCreditPage.jsx',
    'src/pages/food/OxsteedCreditCardsPage.jsx',
    'src/admin/pages/super/OxsteedCreditCards.jsx',
    'src/admin/pages/super/OxsteedCreditEntitlements.jsx',
    'src/admin/pages/super/oxsteedCredit/shared.jsx',
    'src/admin/pages/super/oxsteedCredit/OverviewPage.jsx',
    'src/admin/pages/super/oxsteedCredit/ApprovalsPage.jsx',
    'src/admin/pages/super/oxsteedCredit/DisputesPage.jsx',
    'src/admin/pages/super/oxsteedCredit/SettlementsPage.jsx',
    'src/admin/pages/super/oxsteedCredit/ReconciliationPage.jsx',
    'src/admin/pages/super/oxsteedCredit/CompliancePage.jsx',
    'src/admin/pages/super/oxsteedCredit/ReservesPage.jsx',
    'src/admin/pages/super/oxsteedCredit/PartnersPage.jsx',
    'src/admin/pages/super/oxsteedCredit/HealthPage.jsx',
    'src/admin/pages/super/oxsteedCredit/AuditPage.jsx',
    'src/admin/pages/super/oxsteedCredit/CustomersPage.jsx',
    'src/admin/pages/super/oxsteedCredit/MoneyOutPage.jsx',
    'src/admin/pages/super/oxsteedCredit/CardsPage.jsx',
    'src/admin/pages/super/oxsteedCredit/LedgerPage.jsx',
  ];
  const failures = [];

  for (const relativePath of pages) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (!source.includes("useTranslation('credit')")) {
      failures.push(`${relativePath} must use the credit translation namespace`);
    }
    for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
      if (!creditKeys.has(match[1])) {
        const line = source.slice(0, match.index).split('\n').length;
        failures.push(`${relativePath}:${line}: missing credit key ${match[1]}`);
      }
    }
  }

  if (failures.length) throw new Error(`Credit translation surface failed:\n${failures.join('\n')}`);
  console.log(`ok Credit customer, receipt, and admin pages use the credit namespace (${creditKeys.size} keys)`);
}

function collectArrays(value, prefix = '') {
  if (Array.isArray(value)) return [[prefix, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    collectArrays(child, prefix ? `${prefix}.${key}` : key));
}

// Audit C2: the old verifier flattened arrays to a single key, so a locale
// with a doubled array (duplicated content) passed key parity. Assert every
// array in en has an array of the SAME length at the same path in every
// locale, and flag arrays whose first half deep-equals the second half.
function verifyArrayParity(label, pathForLanguage) {
  const english = collectArrays(readJson(pathForLanguage('en')));
  const failures = [];
  const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const hasDuplicatedHalves = (array) =>
    array.length >= 2
    && array.length % 2 === 0
    && deepEqual(array.slice(0, array.length / 2), array.slice(array.length / 2));

  for (const language of languages) {
    const catalog = readJson(pathForLanguage(language));
    for (const [arrayPath, englishArray] of english) {
      const value = resolveCatalogKey(catalog, arrayPath);
      if (!Array.isArray(value)) {
        failures.push(`${label} ${language} ${arrayPath}: expected array of length ${englishArray.length}, got ${value === undefined ? 'missing' : typeof value}`);
        continue;
      }
      if (value.length !== englishArray.length) {
        failures.push(`${label} ${language} ${arrayPath}: expected length ${englishArray.length}, got ${value.length}`);
        continue;
      }
      if (hasDuplicatedHalves(value)) {
        failures.push(`${label} ${language} ${arrayPath}: length ${value.length} array is two identical halves (duplicated content)`);
      }
    }
  }

  if (failures.length) {
    throw new Error(`Array parity failed:\n${failures.join('\n')}`);
  }
  console.log(`ok ${label}: ${english.length} arrays have matching lengths across ${languages.join('/')}`);
}

function collectStringEntries(value, prefix = '') {
  if (typeof value === 'string') return [[prefix, value]];
  if (Array.isArray(value)) return value.flatMap((child, index) => collectStringEntries(child, `${prefix}.${index}`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    collectStringEntries(child, prefix ? `${prefix}.${key}` : key));
}

// Audit V2-P1-03 gate: scan EVERY namespace (not just the homepage surface)
// for string values >= 25 chars that are byte-identical to the English
// source. Pure URLs (href/src fields) and strings without any alphabetic
// characters (codes, phone numbers) are legitimately identical and are
// excluded. This is a HARD failure: the V2-P1-03 translation backlog is
// cleared, so any new untranslated long string breaks the build.
//
// A small documented allowlist covers values that are legitimately
// language-independent (technical slugs, pure interpolation templates) or
// whose correct translation is byte-identical to English (French spellings
// that coincide with English). Entries are "catalog:key" for all languages
// or "catalog:key:language" for one language. Keep this list minimal and
// justify every entry; it is not a place to park untranslated copy.
const STILL_ENGLISH_MIN_LENGTH = 25;
const STILL_ENGLISH_URL_PATTERN = /^https?:\/\/\S+$/;
const STILL_ENGLISH_ALLOWLIST = new Set([
  // Technical identifier slugs, never translated.
  'legacy translation:businessHub.beautyOps.targetTemplatesPlaceholder',
  // Pure interpolation templates with no translatable prose.
  'legacy translation:qrGenerator.logoFileDetails',
  'legacy translation:logistics.home.unitsProgress',
  'legacy translation:adminRegionsCountryRegionSummary',
  'legacy translation:superCountryPacks.statusUpdated',
  // Correct French translations that happen to match the English spelling.
  'legacy translation:businessHub.professionalOps.title:fr',
  'legacy translation:productGallery.imageAlt:fr',
  'legacy translation:adminUserActionsAuditPage:fr',
  'credit namespace:adminRestaurants:fr',
]);

function verifyStillEnglishValues() {
  const catalogs = [
    ['legacy translation', (language) => `src/locales/${language}.json`],
    ['common namespace', (language) => `src/i18n/locales/${language}/common.json`],
    ['translator namespace', (language) => `src/i18n/locales/${language}/translator.json`],
    ['credit namespace', (language) => `src/i18n/locales/${language}/credit.json`],
    ['terms content', (language) => `src/locales/terms/${language}.content.json`],
    ['privacy content', (language) => `src/locales/privacy/${language}.content.json`],
  ];
  const warnings = [];

  for (const [label, pathForLanguage] of catalogs) {
    const english = collectStringEntries(readJson(pathForLanguage('en')));
    for (const language of languages.filter((entry) => entry !== 'en')) {
      const catalog = readJson(pathForLanguage(language));
      const samples = [];
      let count = 0;
      for (const [key, englishValue] of english) {
        if (englishValue.length < STILL_ENGLISH_MIN_LENGTH) continue;
        if (STILL_ENGLISH_URL_PATTERN.test(englishValue)) continue;
        if (!/[a-zA-Z]/.test(englishValue)) continue;
        if (STILL_ENGLISH_ALLOWLIST.has(`${label}:${key}`)
          || STILL_ENGLISH_ALLOWLIST.has(`${label}:${key}:${language}`)) continue;
        if (resolveCatalogKey(catalog, key) === englishValue) {
          count += 1;
          if (samples.length < 8) {
            samples.push(`${key} = ${JSON.stringify(englishValue.slice(0, 80))}`);
          }
        }
      }
      if (count) warnings.push({ label, language, count, samples });
    }
  }

  const total = warnings.reduce((sum, warning) => sum + warning.count, 0);
  if (total) {
    const details = warnings.map(({ label, language, count, samples }) =>
      `  ${label} ${language}: ${count}\n${samples.map((sample) => `    - ${sample}`).join('\n')}`).join('\n');
    throw new Error(`Still-English values: ${total} strings >= ${STILL_ENGLISH_MIN_LENGTH} chars identical to en (untranslated copy breaks the build):\n${details}`);
  }
  console.log('ok no still-English values across namespaces');
  return total;
}

function stripJsComments(source) {
  let out = '';
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next || '';
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      index += 1;
    } else if (ch === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
    } else if (ch === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
    } else {
      out += ch;
      index += 1;
    }
  }
  return out;
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (ch === '\\') {
        index += 1;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function listSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') files.push(...listSourceFiles(fullPath));
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

// Map each t-like identifier in a file to its i18next namespace, from
// useTranslation('ns') / useTranslation(['ns']) destructuring (including
// `t: alias` renames) and withTranslation('ns'). Files without any
// translation hook are skipped.
function parseTranslationAliases(source) {
  const aliases = new Map();
  // [^{}]* (not [^}]*) so an earlier block brace cannot swallow the
  // destructure; the optional [...] covers useTranslation(['ns1', 'ns2']).
  const hookPattern = /\{([^{}]*)\}\s*=\s*useTranslation\(\s*(?:\[?\s*(['"])([^'"]*)\2\s*\]?)?/g;
  let match;
  while ((match = hookPattern.exec(source))) {
    const namespace = match[3] || 'translation';
    for (const part of match[1].split(',')) {
      const tMatch = part.match(/^\s*t\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*))?\s*$/);
      if (tMatch && !aliases.has(tMatch[1] || 't')) aliases.set(tMatch[1] || 't', namespace);
    }
  }
  const hocMatch = source.match(/withTranslation\(\s*(['"])([^'"]*)\1\s*\)/);
  if (hocMatch) {
    aliases.set('__withTranslationNs', hocMatch[2] || 'translation');
    // withTranslation injects t as a prop, commonly destructured as bare `t`.
    if (!aliases.has('t')) aliases.set('t', hocMatch[2] || 'translation');
  }
  if (/\bi18n\.t\(/.test(source) && !aliases.has('i18n.t')) aliases.set('i18n.t', 'translation');
  return aliases;
}

function getResolutionCatalogs() {
  const translation = readJson('src/locales/en.json');
  return {
    translation,
    common: readJson('src/i18n/locales/en/common.json'),
    translator: readJson('src/i18n/locales/en/translator.json'),
    credit: readJson('src/i18n/locales/en/credit.json'),
    // The runtime projects these legacy subtrees as explicit namespaces
    // (see src/i18n/index.js getLocaleResources).
    support: resolveCatalogKey(translation, 'support') || {},
    adminQuoteRequests: resolveCatalogKey(translation, 'adminQuoteRequests') || {},
  };
}

const I18N_KNOWN_NAMESPACES = ['translation', 'common', 'translator', 'credit', 'support', 'adminQuoteRequests'];
const I18N_PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

function translationKeyExists(catalogs, namespace, key) {
  const catalog = catalogs[namespace];
  if (catalog) {
    if (resolveCatalogKey(catalog, key) !== undefined) return true;
    if (I18N_PLURAL_SUFFIXES.some((suffix) => resolveCatalogKey(catalog, `${key}${suffix}`) !== undefined)) return true;
  }
  // The app configures fallbackNS: ['common'], so a key absent from the
  // requested namespace still resolves when common defines it.
  if (namespace !== 'common') {
    if (resolveCatalogKey(catalogs.common, key) !== undefined) return true;
    if (I18N_PLURAL_SUFFIXES.some((suffix) => resolveCatalogKey(catalogs.common, `${key}${suffix}`) !== undefined)) return true;
  }
  return false;
}

// Audit V2-P1-03 gate: scan EVERY file under client/src for static t('a.b.c') /
// t("ns:key") calls and assert each resolves in the catalog, respecting the
// file's useTranslation('ns') context, returnObjects parent paths, and
// plural stems. Dynamic keys (template literals, concatenation, variables)
// are skipped. This is a HARD failure: a missing static key renders the raw
// key (or a defaultValue fallback) in production, so new ones break the build.
function verifyStaticTranslationKeyReferences() {
  const catalogs = getResolutionCatalogs();
  const files = listSourceFiles(path.join(root, 'src'));
  const missing = [];
  let checked = 0;
  let skippedDynamic = 0;
  let rawKeyCount = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const source = stripJsComments(raw);
    const relativePath = path.relative(root, file);
    const aliases = parseTranslationAliases(source);
    aliases.delete('__withTranslationNs');
    if (!aliases.size) continue;

    for (const [alias, hookNamespace] of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const callPattern = new RegExp(`\\b${escaped}\\(\\s*(['"])((?:(?!\\1).)+)\\1`, 'g');
      let match;
      while ((match = callPattern.exec(source))) {
        // Skip concatenation like t('a' + b): the char after the closing
        // quote must be , or ). Template literals never match the pattern.
        const after = source.slice(match.index + match[0].length).match(/^\s*(.)/);
        if (!after || (after[1] !== ',' && after[1] !== ')')) {
          skippedDynamic += 1;
          continue;
        }
        const key = match[2];
        if (!key) continue;
        checked += 1;
        const openParen = source.indexOf('(', match.index);
        const closeParen = findMatchingParen(source, openParen);
        const argsSlice = closeParen > 0 ? source.slice(openParen, closeParen) : '';
        // returnObjects parent paths resolve through resolveCatalogKey, which
        // returns objects/arrays as well as leaf strings.
        const hasFallback = /^\s*,\s*['"]/.test(source.slice(match.index + match[0].length))
          || /defaultValue\s*:/.test(argsSlice);

        let namespace = hookNamespace;
        let lookupKey = key;
        const colon = key.indexOf(':');
        if (colon > 0 && I18N_KNOWN_NAMESPACES.includes(key.slice(0, colon))) {
          namespace = key.slice(0, colon);
          lookupKey = key.slice(colon + 1);
        }
        // An unregistered namespace (e.g. useTranslation('somePage')) cannot
        // resolve at runtime either; resolve against the default catalog so
        // it is reported missing instead of silently skipped.
        if (!I18N_KNOWN_NAMESPACES.includes(namespace)) namespace = 'translation';

        if (!translationKeyExists(catalogs, namespace, lookupKey)) {
          const line = raw.slice(0, match.index).split('\n').length;
          missing.push({ relativePath, line, namespace, key: lookupKey, hasFallback });
          if (!hasFallback) rawKeyCount += 1;
        }
      }
    }
  }

  const filesWithMissing = new Set(missing.map((entry) => entry.relativePath)).size;
  if (missing.length) {
    const shown = missing.slice(0, 80);
    const details = shown
      .map(({ relativePath, line, namespace, key, hasFallback }) =>
        `  ${relativePath}:${line}: [${namespace}] ${key}${hasFallback ? ' (defaultValue fallback)' : ' (RAW KEY RENDERED)'}`)
      .join('\n');
    const more = missing.length > shown.length ? `\n  ... and ${missing.length - shown.length} more` : '';
    throw new Error(
      `Static t() key references missing from the catalog: ${missing.length} of ${checked} static calls across ${filesWithMissing} files (${rawKeyCount} render raw keys, ${missing.length - rawKeyCount} have a defaultValue fallback); skipped ${skippedDynamic} dynamic keys:\n${details}${more}`,
    );
  }
  console.log(`ok all ${checked} static t() references resolve in the catalog (skipped ${skippedDynamic} dynamic keys)`);
  return { checked, missing: missing.length, rawKeyCount };
}

// Audit follow-up checks (C2 array parity, M9 still-English scan, H2 static
// t() key references). They run before the legacy suite so their signal is
// visible even when unrelated in-flight edits break older checks.
verifyArrayParity('legacy translation', (language) => `src/locales/${language}.json`);
verifyArrayParity('common namespace', (language) => `src/i18n/locales/${language}/common.json`);
verifyArrayParity('translator namespace', (language) => `src/i18n/locales/${language}/translator.json`);
verifyArrayParity('credit namespace', (language) => `src/i18n/locales/${language}/credit.json`);
verifyArrayParity('terms content', (language) => `src/locales/terms/${language}.content.json`);
verifyArrayParity('privacy content', (language) => `src/locales/privacy/${language}.content.json`);
verifyStillEnglishValues();
verifyStaticTranslationKeyReferences();

compareKeySets('legacy translation', (language) => `src/locales/${language}.json`);
compareKeySets('common namespace', (language) => `src/i18n/locales/${language}/common.json`);
compareKeySets('translator namespace', (language) => `src/i18n/locales/${language}/translator.json`);
compareKeySets('credit namespace', (language) => `src/i18n/locales/${language}/credit.json`);
compareKeySets('terms content', (language) => `src/locales/terms/${language}.content.json`);
compareKeySets('privacy content', (language) => `src/locales/privacy/${language}.content.json`);
verifyInterpolationParity('legacy translation', (language) => `src/locales/${language}.json`);
verifyInterpolationParity('common namespace', (language) => `src/i18n/locales/${language}/common.json`);
verifyInterpolationParity('translator namespace', (language) => `src/i18n/locales/${language}/translator.json`);
verifyInterpolationParity('credit namespace', (language) => `src/i18n/locales/${language}/credit.json`);
verifyInterpolationParity('terms content', (language) => `src/locales/terms/${language}.content.json`);
verifyInterpolationParity('privacy content', (language) => `src/locales/privacy/${language}.content.json`);
verifyI18nIndex();
verifyCanonicalBrands();
verifyHomepageTranslationSurface();
verifyPageHasNoHardcodedUiText('src/pages/DirectPortalPage.jsx', {
  allowedJsxText: ['Cash App', 'Venmo', 'Zelle'],
  allowedAttributes: ['US'],
});
verifyPageHasNoHardcodedUiText('src/pages/DirectCatalogLanding.jsx', {
  allowedJsxText: ['OxSteed', 'OxSteed Direct'],
  allowedAttributes: ['OxSteed Direct'],
});
verifyPageHasNoHardcodedUiText('src/pages/PostJobPage.jsx', {
  allowedJsxText: ['OxS'],
});
verifyPageHasNoHardcodedUiText('src/pages/food/FoodRestaurantPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/HomePage.jsx', {
  allowedJsxText: ['OxS'],
});
verifyPageHasNoHardcodedUiText('src/pages/food/FoodHomePage.jsx', {
  allowedJsxText: ['OpenStreetMap'],
});
verifyPageHasNoHardcodedUiText('src/pages/Login.jsx', {
  allowedJsxText: ['OxSteed', 'OxS'],
});
verifyPageHasNoHardcodedUiText('src/pages/JoinPage.jsx', {
  allowedJsxText: ['OxSteed'],
});
verifyPageHasNoHardcodedUiText('src/pages/ForgotPassword.jsx', {
  allowedJsxText: ['OxSteed'],
  allowedAttributes: ['you@example.com'],
});
verifyPageHasNoHardcodedUiText('src/pages/ResetPassword.jsx', {
  allowedJsxText: ['OxSteed'],
});
verifyPageHasNoHardcodedUiText('src/pages/JobDetailPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/HelpersDirectoryPage.tsx', {
  allowedJsxText: ['0 && h.rating'],
});
verifyPageHasNoHardcodedUiText('src/pages/JobPublicPage.tsx');
verifyPageHasNoHardcodedUiText('src/pages/HelperBusinessProfilePage.tsx', {
  allowedJsxText: ['and'],
});
verifyPageHasNoHardcodedUiText('src/pages/PublicProfile.jsx');
verifyPageHasNoHardcodedUiText('src/pages/BookHelperPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/BookBusinessPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/BookServicePage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/MyBookingsPage.tsx');
verifyPageHasNoHardcodedUiText('src/pages/food/FoodOrderConfirmation.jsx');
verifyPageHasNoHardcodedUiText('src/pages/OrderHistoryPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/OrderDetailsPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/SupportEscalationPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/SupportTicketDetailPage.jsx');
verifyCreditTranslationSurface();
