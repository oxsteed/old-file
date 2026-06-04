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

compareKeySets('legacy translation', (language) => `src/locales/${language}.json`);
compareKeySets('common namespace', (language) => `src/i18n/locales/${language}/common.json`);
compareKeySets('translator namespace', (language) => `src/i18n/locales/${language}/translator.json`);
compareKeySets('terms content', (language) => `src/locales/terms/${language}.content.json`);
compareKeySets('privacy content', (language) => `src/locales/privacy/${language}.content.json`);
verifyI18nIndex();
