import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const languages = ['en', 'es', 'fr', 'ht', 'ar'];

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    throw new Error(`${relativePath}: ${error.message}`);
  }
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
    'network.restaurants.title': 'OxSteed Restaurants',
    'footer.restaurants': 'OxSteed Restaurants',
    'restaurants.nav.entry': 'OxSteed Restaurants',
    'food.nav.entry': 'OxSteed Food',
    'dashboard.customer.foodEyebrow': 'OxSteed Restaurants',
    'food.merchant.landing.eyebrow': 'OxSteed Restaurants',
  };
  const includes = {
    'publicSeo.help.restaurant.title': 'OxSteed Restaurants',
    'publicSeo.help.restaurant.description': 'OxSteed Restaurants',
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
    const isLeaf = (value) => value !== undefined && (value === null || typeof value !== 'object');
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

compareKeySets('legacy translation', (language) => `src/locales/${language}.json`);
compareKeySets('common namespace', (language) => `src/i18n/locales/${language}/common.json`);
compareKeySets('translator namespace', (language) => `src/i18n/locales/${language}/translator.json`);
compareKeySets('terms content', (language) => `src/locales/terms/${language}.content.json`);
compareKeySets('privacy content', (language) => `src/locales/privacy/${language}.content.json`);
verifyI18nIndex();
verifyCanonicalBrands();
verifyPageHasNoHardcodedUiText('src/pages/DirectPortalPage.jsx', {
  allowedJsxText: ['Cash App', 'Venmo', 'Zelle'],
  allowedAttributes: ['US'],
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
verifyPageHasNoHardcodedUiText('src/pages/JobListPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/CustomerRegister.tsx', {
  allowedJsxText: ['OxSteed'],
});
verifyPageHasNoHardcodedUiText('src/pages/HelperRegister.tsx', {
  allowedJsxText: ['OxSteed'],
});
verifyPageHasNoHardcodedUiText('src/pages/ResetPassword.jsx', {
  allowedJsxText: ['OxSteed'],
});
verifyPageHasNoHardcodedUiText('src/pages/JobDetailPage.jsx');
verifyPageHasNoHardcodedUiText('src/pages/HelpersDirectoryPage.tsx', {
  allowedJsxText: ['0 && h.rating'],
});
verifyPageHasNoHardcodedUiText('src/pages/JobPublicPage.tsx');
verifyPageHasNoHardcodedUiText('src/pages/HelperPublicProfilePage.tsx');
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
