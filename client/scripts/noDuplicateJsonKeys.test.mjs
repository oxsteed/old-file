import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function parseJson(text, file) {
  let index = 0;
  const duplicates = [];
  const fail = (message) => { throw new Error(`${file}:${index + 1}: ${message}`); };
  const skip = () => { while (/\s/.test(text[index] || '')) index += 1; };
  const string = () => {
    if (text[index] !== '"') fail('expected string');
    const start = index++;
    let escaped = false;
    while (index < text.length) {
      const char = text[index++];
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') return JSON.parse(text.slice(start, index));
    }
    fail('unterminated string');
  };
  const value = () => {
    skip();
    if (text[index] === '{') {
      index += 1;
      skip();
      const keys = new Set();
      if (text[index] === '}') { index += 1; return; }
      while (index < text.length) {
        skip();
        const key = string();
        if (keys.has(key)) duplicates.push(`${file}:${key}`);
        keys.add(key);
        skip();
        if (text[index++] !== ':') fail('expected colon');
        value();
        skip();
        if (text[index] === '}') { index += 1; return; }
        if (text[index++] !== ',') fail('expected comma');
      }
      fail('unterminated object');
    }
    if (text[index] === '[') {
      index += 1;
      skip();
      if (text[index] === ']') { index += 1; return; }
      while (index < text.length) {
        value();
        skip();
        if (text[index] === ']') { index += 1; return; }
        if (text[index++] !== ',') fail('expected comma');
      }
      fail('unterminated array');
    }
    if (text[index] === '"') { string(); return; }
    const literal = text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!literal) fail('invalid value');
    index += literal[0].length;
  };
  value();
  skip();
  if (index !== text.length) fail('trailing data');
  return duplicates;
}

const root = path.resolve(process.cwd(), 'src/i18n/locales');
const files = ['en', 'es', 'fr', 'ht', 'ar'].map((locale) => path.join(root, locale, 'credit.json'));
const duplicates = files.flatMap((file) => parseJson(fs.readFileSync(file, 'utf8'), file));
assert.deepEqual(duplicates, [], `duplicate JSON keys found: ${duplicates.join(', ')}`);
console.log('No duplicate credit locale keys found');
