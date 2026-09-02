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
    if (!source.includes(`${language}: {`)) {
      throw new Error(`src/i18n/index.js is missing resources entry for ${language}`);
    }
  }
  console.log(`ok i18n index declares ${languages.join('/')}`);
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

  for (const match of source.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)) {
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

  console.log(`ok ${relativePath} has no unapproved hard-coded UI text`);
}

compareKeySets('legacy translation', (language) => `src/locales/${language}.json`);
compareKeySets('common namespace', (language) => `src/i18n/locales/${language}/common.json`);
compareKeySets('translator namespace', (language) => `src/i18n/locales/${language}/translator.json`);
compareKeySets('terms content', (language) => `src/locales/terms/${language}.content.json`);
compareKeySets('privacy content', (language) => `src/locales/privacy/${language}.content.json`);
verifyI18nIndex();
verifyPageHasNoHardcodedUiText('src/pages/DirectPortalPage.jsx', {
  allowedJsxText: ['Cash App', 'Venmo', 'Zelle'],
  allowedAttributes: ['US'],
});
verifyPageHasNoHardcodedUiText('src/pages/PostJobPage.jsx', {
  allowedJsxText: ['OxS'],
});
