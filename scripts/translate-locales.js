#!/usr/bin/env node
/**
 * translate-locales.js
 *
 * Reads client/public/locales/en.json and uses your self-hosted LibreTranslate
 * instance to generate locale files for every supported language.
 *
 * Usage:
 *   node scripts/translate-locales.js                  # all languages
 *   node scripts/translate-locales.js fr es de         # specific languages only
 *   node scripts/translate-locales.js --force fr       # re-translate even if file exists
 *
 * Env vars (reads from server/.env automatically if present):
 *   LIBRETRANSLATE_URL      e.g. https://lange.oxsteed.com
 *   LIBRETRANSLATE_API_KEY  your API key
 *
 * The script:
 *   1. Fetches the language list from LibreTranslate (skips 'en')
 *   2. Loads existing locale files - only translates missing/new keys
 *      (pass --force to retranslate everything)
 *   3. Translates in batches of 50 (LibreTranslate array API)
 *   4. Writes client/public/locales/<lang>.json
 */

'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

// ── Load env from server/.env if not already set ────────────────────────────
const envPath = path.resolve(__dirname, '../server/.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    });
}

const BASE_URL = (process.env.LIBRETRANSLATE_URL || '').replace(/\/$/, '');
const API_KEY  = process.env.LIBRETRANSLATE_API_KEY || '';
const LOCALES_DIR = path.resolve(__dirname, '../client/public/locales');
const EN_FILE     = path.join(LOCALES_DIR, 'en.json');
const BATCH_SIZE  = 50;
const CONCURRENCY = 3; // simultaneous language translations

if (!BASE_URL) {
  console.error('❌  LIBRETRANSLATE_URL is not set. Export it or add it to server/.env');
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const force       = args.includes('--force');
const langFilter  = args.filter(a => !a.startsWith('--'));

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function request(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod    = parsed.protocol === 'https:' ? https : http;
    const req    = mod.request(
      {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   options.method || 'GET',
        headers:  options.headers || {},
      },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          } else {
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error('Non-JSON response')); }
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getLanguages() {
  const langs = await request(`${BASE_URL}/languages`, {});
  return Array.isArray(langs) ? langs.filter(l => l.code !== 'en') : [];
}

async function translateBatch(texts, target) {
  const body = Buffer.from(JSON.stringify({
    q:      texts,
    source: 'en',
    target,
    format: 'text',
    ...(API_KEY ? { api_key: API_KEY } : {}),
  }));
  const result = await request(`${BASE_URL}/translate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
  }, body);

  if (Array.isArray(result.translatedText)) return result.translatedText;
  if (typeof result.translatedText === 'string') return [result.translatedText];
  throw new Error(`Unexpected response: ${JSON.stringify(result).slice(0, 200)}`);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function translateLanguage(lang, enKeys, enValues) {
  const outFile = path.join(LOCALES_DIR, `${lang}.json`);

  // Load existing translations so we only update missing/new keys
  let existing = {};
  if (!force && fs.existsSync(outFile)) {
    try { existing = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch {}
  }

  const toTranslate = { keys: [], values: [] };
  enKeys.forEach((key, i) => {
    if (!existing[key]) {
      toTranslate.keys.push(key);
      toTranslate.values.push(enValues[i]);
    }
  });

  if (toTranslate.keys.length === 0) {
    console.log(`  ✅  ${lang} - already up to date (${enKeys.length} keys)`);
    return;
  }

  console.log(`  🔄  ${lang} - translating ${toTranslate.keys.length} keys…`);

  const batches      = chunk(toTranslate.values, BATCH_SIZE);
  const translated   = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const results = await translateBatch(batch, lang);
      translated.push(...results);
    } catch (err) {
      console.warn(`    ⚠️  batch ${i + 1}/${batches.length} failed (${err.message}) - keeping English`);
      translated.push(...batch);
    }
  }

  // Merge with existing
  const output = { ...existing };
  toTranslate.keys.forEach((key, i) => {
    output[key] = translated[i] ?? enValues[toTranslate.keys.indexOf(key)];
  });

  // Preserve the same key order as en.json
  const ordered = {};
  enKeys.forEach(k => { if (output[k] !== undefined) ordered[k] = output[k]; });

  fs.writeFileSync(outFile, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
  console.log(`  ✅  ${lang} - written ${Object.keys(ordered).length} keys to ${path.basename(outFile)}`);
}

async function pool(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function next() {
    if (i >= tasks.length) return;
    const task = tasks[i++];
    results.push(await task());
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, next));
  return results;
}

async function main() {
  console.log(`\n🌍  OxSteed locale generator`);
  console.log(`    LibreTranslate: ${BASE_URL}`);
  console.log(`    Force retranslate: ${force}\n`);

  if (!fs.existsSync(EN_FILE)) {
    console.error(`❌  ${EN_FILE} not found - create it first`);
    process.exit(1);
  }

  const en       = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
  const enKeys   = Object.keys(en);
  const enValues = Object.values(en);
  console.log(`📖  Loaded en.json - ${enKeys.length} keys\n`);

  console.log('🌐  Fetching language list from LibreTranslate…');
  let languages;
  try {
    languages = await getLanguages();
  } catch (err) {
    console.error(`❌  Could not fetch languages: ${err.message}`);
    process.exit(1);
  }

  if (langFilter.length > 0) {
    languages = languages.filter(l => langFilter.includes(l.code));
    if (languages.length === 0) {
      console.error(`❌  None of [${langFilter.join(', ')}] found in LibreTranslate language list`);
      process.exit(1);
    }
  }

  console.log(`    Found ${languages.length} target language(s): ${languages.map(l => l.code).join(', ')}\n`);

  const tasks = languages.map(lang =>
    () => translateLanguage(lang.code, enKeys, enValues)
  );

  await pool(tasks, CONCURRENCY);

  console.log('\n✨  Done!\n');
}

main().catch(err => {
  console.error('❌  Fatal:', err.message);
  process.exit(1);
});
