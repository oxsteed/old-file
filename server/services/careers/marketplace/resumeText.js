'use strict';

// Dependency-free text extraction for résumé parsing
// (docs/careers/marketplace.md §8.2). DOCX: a minimal ZIP central-directory
// reader + zlib inflateRaw for word/document.xml. PDF: best-effort text
// operators (Tj/TJ/'/") from uncompressed and FlateDecode content streams.
// Both are bounded (input 5 MB, output 200 kB, inflate caps) and never
// execute anything in the file. Image-only or CID-font PDFs come back as
// `unreadable`, and the UI asks the worker to paste their résumé instead.

const zlib = require('zlib');

const MAX_INPUT = 5 * 1024 * 1024;
const MAX_TEXT = 200_000;
const MAX_INFLATE = 20 * 1024 * 1024;
const MAX_STREAMS = 400;

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&#(\d+);/g, (_, d) => { const n = Number(d); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; })
    .replace(/&amp;/g, '&');
}

/** Read one entry from a ZIP buffer by exact name. Returns Buffer or null. */
function readZipEntry(buf, name) {
  const minEocd = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries && p + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATE });
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function docxText(buf) {
  const xml = readZipEntry(buf, 'word/document.xml');
  if (!xml) return '';
  const s = xml.toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(s);
}

function pdfStringLiteral(src, start) {
  // src[start] === '('; returns [text, endIndex]
  let depth = 0;
  let out = '';
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      if (map[n] !== undefined) { out += map[n]; i += 1; continue; }
      if (/[0-7]/.test(n)) {
        const oct = src.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
        out += String.fromCharCode(parseInt(oct, 8));
        i += oct.length;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '(') { depth += 1; if (depth === 1) continue; }
    if (c === ')') { depth -= 1; if (depth === 0) return [out, i]; }
    out += c;
  }
  return [out, src.length];
}

// WinAnsiEncoding differs from Latin-1 only in 0x80–0x9F (punctuation).
const WIN_ANSI = { 0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™' };
function winAnsi(code) { return WIN_ANSI[code] || String.fromCharCode(code); }

function textFromContent(content) {
  let out = '';
  const n = content.length;
  for (let i = 0; i < n && out.length < MAX_TEXT; i += 1) {
    const c = content[i];
    if (c === '(') {
      const [str, end] = pdfStringLiteral(content, i);
      i = end;
      out += str;
    } else if (c === '<' && content[i + 1] !== '<' && (i === 0 || content[i - 1] !== '<')) {
      // Hex string: single-byte (WinAnsi/standard-14) fonts decode directly;
      // two-byte CID text yields non-letters and is caught by `readable`.
      const end = content.indexOf('>', i + 1);
      if (end < 0) break;
      const hex = content.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
      for (let h = 0; h + 1 < hex.length; h += 2) out += winAnsi(parseInt(hex.slice(h, h + 2), 16));
      i = end;
    } else if (c === 'T' && (content[i + 1] === '*' || content[i + 1] === 'd' || content[i + 1] === 'D')) {
      out += '\n';
    } else if (c === 'E' && content[i + 1] === 'T') {
      out += '\n';
    } else if (c === ']' && content.slice(i + 1, i + 4).trim().startsWith('TJ')) {
      out += ' ';
    }
  }
  return out;
}

function pdfText(buf) {
  const src = buf.toString('latin1');
  let out = '';
  let count = 0;
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(src)) && count < MAX_STREAMS && out.length < MAX_TEXT) {
    count += 1;
    const dictStart = src.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? src.slice(dictStart, m.index) : '';
    const end = src.indexOf('endstream', m.index + m[0].length);
    if (end < 0) break;
    const raw = buf.subarray(m.index + m[0].length, end);
    re.lastIndex = end + 9;
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject|\/Length1|\/FontFile/.test(dict)) continue;
    let content;
    try {
      content = /\/FlateDecode/.test(dict) ? zlib.inflateSync(raw, { maxOutputLength: MAX_INFLATE }).toString('latin1') : raw.toString('latin1');
    } catch {
      continue;
    }
    if (!/\b(Tj|TJ|BT)\b/.test(content)) continue;
    out += `${textFromContent(content)}\n`;
  }
  return out;
}

function tidy(s) {
  return String(s || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, MAX_TEXT);
}

/**
 * @returns {{ text: string, readable: boolean, kind: 'pdf'|'docx'|'text'|'unknown' }}
 */
function extractResumeText(buf, mime = '') {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_INPUT) return { text: '', readable: false, kind: 'unknown' };
  let kind = 'unknown';
  let text = '';
  try {
    if (buf.subarray(0, 5).toString('latin1') === '%PDF-' || /pdf/.test(mime)) { kind = 'pdf'; text = pdfText(buf); }
    else if (buf.readUInt32LE(0) === 0x04034b50 || /wordprocessingml/.test(mime)) { kind = 'docx'; text = docxText(buf); }
    else if (/^text\//.test(mime)) { kind = 'text'; text = buf.toString('utf8'); }
  } catch {
    text = '';
  }
  const clean = tidy(text);
  const letters = (clean.match(/\p{L}/gu) || []).length;
  return { text: clean, readable: letters >= 80, kind };
}

module.exports = { extractResumeText, readZipEntry, docxText, pdfText, tidy };
