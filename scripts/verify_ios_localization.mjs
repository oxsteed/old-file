import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const appDir = path.join(root, 'build-atom');
const projectPath = path.join(root, 'build-atom.xcodeproj', 'project.pbxproj');
const localizationManagerPath = path.join(appDir, 'Localization', 'LocalizationManager.swift');
const languages = ['en', 'es', 'fr', 'ht', 'ar'];

function fail(message) {
  console.error(`iOS localization verification failed: ${message}`);
  process.exit(1);
}

function parseStrings(language) {
  const relativePath = `build-atom/${language}.lproj/Localizable.strings`;
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) fail(`${relativePath} is missing`);

  try {
    const output = execFileSync('plutil', ['-convert', 'json', '-o', '-', '--', fullPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(output);
  } catch (error) {
    fail(`${relativePath} is not parseable: ${error.message}`);
  }
}

function checkStringKeys() {
  const localized = Object.fromEntries(languages.map((language) => [language, parseStrings(language)]));
  const baseKeys = new Set(Object.keys(localized.en));

  if (!baseKeys.size) fail('English Localizable.strings has no keys');

  for (const language of languages) {
    const keys = new Set(Object.keys(localized[language]));
    const missing = [...baseKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !baseKeys.has(key));
    const empty = [...keys].filter((key) => String(localized[language][key] ?? '').trim() === '');

    if (missing.length || extra.length || empty.length) {
      const details = [
        missing.length ? `missing ${missing.length}: ${missing.slice(0, 20).join(', ')}` : null,
        extra.length ? `extra ${extra.length}: ${extra.slice(0, 20).join(', ')}` : null,
        empty.length ? `empty ${empty.length}: ${empty.slice(0, 20).join(', ')}` : null,
      ].filter(Boolean).join('; ');
      fail(`${language}.lproj key parity failed; ${details}`);
    }
  }

  console.log(`ok Localizable.strings: ${baseKeys.size} keys across ${languages.join('/')}`);
}

function checkProjectRegions() {
  const project = fs.readFileSync(projectPath, 'utf8');
  const knownRegionsBlock = project.match(/knownRegions = \(([^)]*)\);/s)?.[1] || '';

  for (const language of languages) {
    if (!knownRegionsBlock.includes(language)) {
      fail(`Xcode project knownRegions is missing ${language}`);
    }
    if (!project.includes(`path = ${language}.lproj/Localizable.strings;`)) {
      fail(`Xcode project resources are missing ${language}.lproj/Localizable.strings`);
    }
  }

  console.log(`ok Xcode knownRegions/resources include ${languages.join('/')}`);
}

function checkRuntimeLanguageManager() {
  const source = fs.readFileSync(localizationManagerPath, 'utf8');

  for (const language of languages) {
    if (!source.includes(`case ${language} = "${language}"`)) {
      fail(`LocalizationManager AppLanguage is missing ${language}`);
    }
  }

  if (!source.includes('case .ar: return .rightToLeft')) {
    fail('LocalizationManager does not mark Arabic as right-to-left');
  }

  console.log(`ok LocalizationManager supports ${languages.join('/')} with Arabic RTL`);
}

checkStringKeys();
checkProjectRegions();
checkRuntimeLanguageManager();
