'use strict';

const path = require('path');
const PDFDocument = require('pdfkit');
const bidi = require('bidi-js')();
const copy = require('../locales/statement-copy.json');

const LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const TYPES = new Set(['load', 'purchase', 'refund', 'transfer', 'adjustment', 'settlement', 'fee', 'expiration', 'chargeback',
  'settlement_reversal', 'funding', 'reserve_release', 'conversion_debit', 'conversion_fee', 'conversion_credit', 'cash_out',
  'sub_bank_load', 'sub_bank_redemption', 'sub_bank_refund', 'sub_bank_opening_balance', 'withdrawal_fee', 'transfer_fee', 'sub_bank_conversion']);
const FONT_DIR = path.join(__dirname, '../assets/fonts');
const MAX_ROWS = 5000;
const MAX_TEXT = 4096;
const COLORS = { ink: '#172534', muted: '#536475', accent: '#B74712', line: '#DCE2E8', pale: '#F3F6F8' };
const PAGE = { width: 595.28, height: 841.89, margin: 40, bottom: 758 };

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function text(value, max = MAX_TEXT) {
  const string = String(value ?? '').normalize('NFC');
  if (string.length > max) fail('statement_export_too_large');
  // Strip hidden control/direction overrides supplied in customer text. The
  // renderer, not a user-supplied override, owns the direction of each cell.
  return string.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '').replace(/\t/g, ' ').replace(/[\u2010-\u2015\u2212]/g, '-');
}

function integer(value, name, nonnegative = false) {
  if (!Number.isSafeInteger(value) || (nonnegative && value < 0)) fail('statement_invalid_amount', name);
  return value;
}

function date(value, dayOnly = false) {
  const source = String(value ?? '');
  if (dayOnly && !/^\d{4}-\d{2}-\d{2}$/.test(source)) fail('statement_invalid_date');
  // Do not let local server time reinterpret an unzoned transaction timestamp.
  if (!dayOnly && !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(source)) fail('statement_invalid_date');
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime()) || (dayOnly && parsed.toISOString().slice(0, 10) !== source)) fail('statement_invalid_date');
  return parsed;
}

function normalize(statement) {
  if (!statement || !['monthly', 'interim'].includes(statement.kind) || !['oxsteed', 'restaurant'].includes(statement.product)) fail('statement_invalid');
  if (!/^[A-Z]{3}$/.test(statement.currencyCode)) fail('statement_invalid_currency');
  if (!Array.isArray(statement.transactions) || statement.transactions.length > MAX_ROWS) fail('statement_export_too_large');
  if (statement.transactionCount !== statement.transactions.length) fail('statement_incomplete_export');
  const from = date(statement.period?.from, true);
  const to = date(statement.period?.to, true);
  if (to < from) fail('statement_invalid_date');
  date(statement.generatedAt);
  const opening = integer(statement.openingBalanceCents, 'opening');
  const closing = integer(statement.closingBalanceCents, 'closing');
  const credits = integer(statement.totalCreditsCents, 'credits', true);
  const debits = integer(statement.totalDebitsCents, 'debits', true);
  let running = BigInt(opening);
  let sumCredits = 0n;
  let sumDebits = 0n;
  const transactions = statement.transactions.map((entry) => {
    const posted = date(entry.date);
    if (posted < from || posted >= new Date(to.getTime() + 86400000)) fail('statement_invalid_date');
    const debit = integer(entry.debitCents, 'debit', true);
    const credit = integer(entry.creditCents, 'credit', true);
    const balance = integer(entry.balanceAfterCents, 'balance');
    if (debit && credit) fail('statement_invalid_amount');
    running += BigInt(credit) - BigInt(debit);
    sumCredits += BigInt(credit);
    sumDebits += BigInt(debit);
    if (running !== BigInt(balance)) fail('statement_balance_mismatch');
    return { id: text(entry.id, 256), date: posted.toISOString(), type: TYPES.has(entry.type) ? entry.type : 'other', description: text(entry.description), debitCents: debit, creditCents: credit, balanceAfterCents: balance };
  });
  if (running !== BigInt(closing) || sumCredits !== BigInt(credits) || sumDebits !== BigInt(debits)) fail('statement_balance_mismatch');
  if (statement.kind === 'interim' && (!Array.isArray(statement.holds) || statement.holds.length > MAX_ROWS)) fail('statement_export_too_large');
  const holds = statement.kind === 'interim' && Array.isArray(statement.holds) ? statement.holds.map((hold) => ({
    id: text(hold.id, 256), description: text(hold.description), amountCents: integer(hold.amountCents, 'hold', true),
  })) : [];
  if (holds.length > MAX_ROWS) fail('statement_export_too_large');
  const totalHeld = statement.kind === 'interim' ? integer(statement.totalHeldCents ?? 0, 'held', true) : 0;
  if (holds.reduce((sum, hold) => sum + BigInt(hold.amountCents), 0n) !== BigInt(totalHeld)) fail('statement_balance_mismatch');
  if (holds.length && !statement.holdsAsOf) fail('statement_invalid_date');
  if (statement.kind === 'interim' && statement.holdsAsOf) date(statement.holdsAsOf);
  // Explicit allowlist: internal routing notes, card credentials, fraud fields,
  // and audit-chain metadata are never serialized by the renderers.
  return {
    id: text(statement.id, 256), kind: statement.kind, product: statement.product,
    ownerName: text(statement.ownerName, 256), accountLabel: text(statement.accountLabel, 256),
    accountReference: text(statement.accountReference, 256), currencyCode: statement.currencyCode,
    period: { from: statement.period.from, to: statement.period.to }, generatedAt: statement.generatedAt,
    openingBalanceCents: opening, closingBalanceCents: closing, totalCreditsCents: credits, totalDebitsCents: debits,
    transactionCount: transactions.length, transactions, holds, totalHeldCents: totalHeld,
    holdsAsOf: statement.kind === 'interim' ? statement.holdsAsOf : null,
    contentHash: text(statement.contentHash, 128),
  };
}

function languageCopy(language) {
  const lang = LANGUAGES.has(language) ? language : 'en';
  if (!copy[lang] || !copy.en) fail('statement_localization_unavailable');
  return { lang, labels: { ...copy.en, ...copy[lang] } };
}

function precision(currencyCode) {
  return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits;
}

function decimal(minor, currencyCode) {
  const digits = precision(currencyCode);
  const amount = BigInt(minor);
  const absolute = amount < 0n ? -amount : amount;
  const scale = 10n ** BigInt(digits);
  return `${amount < 0n ? '-' : ''}${absolute / scale}${digits ? `.${String(absolute % scale).padStart(digits, '0')}` : ''}`;
}

function amount(minor, currencyCode, language) {
  const digits = precision(currencyCode);
  const value = decimal(minor, currencyCode);
  const [whole, fraction] = value.split('.');
  // BigInt formatting preserves every minor unit even at MAX_SAFE_INTEGER.
  const grouped = new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(BigInt(whole));
  const separator = new Intl.NumberFormat(language).formatToParts(1.1).find((part) => part.type === 'decimal')?.value || '.';
  const localizedFraction = fraction && [...fraction].map((digit) => new Intl.NumberFormat(language, { useGrouping: false }).format(Number(digit))).join('');
  // Preserve the sign for negative amounts smaller than one major unit.
  const prefix = value.startsWith('-0.') && !grouped.startsWith('-') ? '-' : '';
  return `${prefix}${grouped}${digits ? separator + localizedFraction : ''}`;
}

function utcDate(value, language, includeTime = false) {
  return new Intl.DateTimeFormat(language, {
    year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).format(date(value)) + (includeTime ? ' UTC' : '');
}

function csvCell(value) {
  let string = String(value ?? '').replace(/\u0000/g, '');
  // Formula triggers can hide behind whitespace, BOM, or Unicode direction
  // controls. Quote alone does not stop a spreadsheet executing a formula.
  const candidate = string.replace(/^[\s\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]+/u, '');
  if (/^[=+\-@]/.test(candidate) || /^[\t\r\n]/.test(string)) string = `'${string}`;
  return `"${string.replace(/"/g, '""')}"`;
}

function renderStatementCsv(statement, { language = 'en' } = {}) {
  const s = normalize(statement);
  const { labels: l } = languageCopy(language);
  const rows = [];
  const row = (...values) => rows.push(values.map(csvCell).join(','));
  row(l.title, l[s.product]);
  row(l.id, s.id);
  row(l[s.kind], s.accountLabel);
  row(l.owner, s.ownerName);
  row(l.account, s.accountReference);
  row(l.period, s.period.from, s.period.to, 'UTC');
  row(l.generated, date(s.generatedAt).toISOString());
  row(l.currency, s.currencyCode);
  row(l.opening, decimal(s.openingBalanceCents, s.currencyCode));
  row(l.credits, decimal(s.totalCreditsCents, s.currencyCode));
  row(l.debits, decimal(s.totalDebitsCents, s.currencyCode));
  row(l.closing, decimal(s.closingBalanceCents, s.currencyCode));
  row(l.activity, s.transactionCount);
  row();
  row(l.date, l.activity, l.reference, l.debit, l.credit, l.balance, l.currency);
  for (const entry of s.transactions) row(entry.date, `${l[entry.type]}${entry.description ? ` - ${entry.description}` : ''}`, entry.id,
    decimal(entry.debitCents, s.currencyCode), decimal(entry.creditCents, s.currencyCode), decimal(entry.balanceAfterCents, s.currencyCode), s.currencyCode);
  if (!s.transactions.length) row(l.noActivity);
  if (s.kind === 'interim' && s.holdsAsOf) {
    row();
    row(l.holds, date(s.holdsAsOf).toISOString(), decimal(s.totalHeldCents, s.currencyCode), s.currencyCode);
    row(l.holdsNote);
    for (const hold of s.holds) row(hold.id, hold.description, decimal(hold.amountCents, s.currencyCode), s.currencyCode);
  }
  row();
  row(l.digest, s.contentHash);
  row(l.support, 'support@oxsteed.com');
  row(l.disclaimer);
  row(l.end);
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

/**
 * Unicode bidi is applied to runs, not to individual Arabic letters. Each RTL
 * run remains in logical order for fontkit joining/ligatures; only the runs are
 * positioned in visual order. LTR references and numeric cells stay readable.
 */
function visualRuns(string, rtl) {
  const levels = bidi.getEmbeddingLevels(string, rtl ? 'rtl' : 'ltr');
  // bidi-js 1.1 expects the Uint8Array here, unlike getReorderSegments which
  // accepts the whole embedding result. Passing the result silently fails to
  // mirror parentheses around LTR IDs embedded in Arabic sentences.
  const mirrored = bidi.getMirroredCharactersMap(string, levels.levels);
  const runs = [];
  const runAt = [];
  let previousFamily = 'Latin';
  let index = 0;
  for (const original of string) {
    const arabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u.test(original);
    // Noto Sans Arabic intentionally has a small Latin punctuation repertoire;
    // parentheses, Latin-brand punctuation and references use Noto Sans.
    const family = arabic ? 'Arabic' : /\s/u.test(original) ? previousFamily : 'Latin';
    const level = levels.levels[index];
    let run = runs[runs.length - 1];
    if (!run || run.level !== level || run.family !== family) {
      run = { text: '', family, level, index: runs.length };
      runs.push(run);
    }
    run.text += mirrored.get(index) || original;
    for (let i = 0; i < original.length; i++) runAt[index + i] = run.index;
    previousFamily = family;
    index += original.length;
  }
  const indices = Array.from({ length: string.length }, (_, i) => i);
  for (const [start, end] of bidi.getReorderSegments(string, levels)) {
    for (let left = start, right = end; left < right; left++, right--) [indices[left], indices[right]] = [indices[right], indices[left]];
  }
  const seen = new Set();
  return indices.reduce((result, logicalIndex) => {
    const run = runs[runAt[logicalIndex]];
    if (run && !seen.has(run.index)) {
      seen.add(run.index);
      result.push({ ...run, text: run.level % 2 && run.family === 'Latin' ? [...run.text].reverse().join('') : run.text });
    }
    return result;
  }, []);
}

async function renderStatementPdf(statement, { language = 'en' } = {}) {
  const s = normalize(statement);
  const { lang, labels: l } = languageCopy(language);
  const rtl = lang === 'ar';
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, autoFirstPage: false,
    info: { Title: `${l.title} - ${l[s.product]}`, Author: 'OxSteed', Subject: `${s.id} | ${s.period.from} - ${s.period.to}`, CreationDate: date(s.generatedAt), ModDate: date(s.generatedAt) }, lang });
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  for (const family of ['Latin', 'Arabic']) for (const weight of ['Regular', 'Bold']) {
    doc.registerFont(`${family}${weight}`, path.join(FONT_DIR, `NotoSans${family === 'Arabic' ? 'Arabic' : ''}-${weight}.ttf`));
  }
  const width = PAGE.width - PAGE.margin * 2;
  let y;
  function runs(value, size, bold, direction = rtl) {
    return visualRuns(text(value), direction).map((run) => {
      const font = `${run.family}${bold ? 'Bold' : 'Regular'}`;
      doc.font(font).fontSize(size);
      // Missing glyphs must never silently replace a name or financial value.
      for (const character of run.text) if (!/\s/u.test(character) && !doc._font.font.hasGlyphForCodePoint(character.codePointAt(0))) fail('statement_unsupported_glyph', `Unsupported glyph U+${character.codePointAt(0).toString(16).toUpperCase()}`);
      return { ...run, font, width: doc.widthOfString(run.text, { features: {} }) };
    });
  }
  function measure(value, size = 9, bold = false, direction = rtl) {
    return runs(value, size, bold, direction).reduce((sum, run) => sum + run.width, 0);
  }
  function drawLine(value, x, top, cellWidth, { size = 9, bold = false, color = COLORS.ink, align = rtl ? 'right' : 'left', direction = rtl } = {}) {
    const pieces = runs(value, size, bold, direction);
    const total = pieces.reduce((sum, run) => sum + run.width, 0);
    let cursor = x + (align === 'right' ? cellWidth - total : align === 'center' ? (cellWidth - total) / 2 : 0);
    for (const run of pieces) {
      doc.font(run.font).fontSize(size).fillColor(color).text(run.text, cursor, top, { lineBreak: false, features: {} });
      cursor += run.width;
    }
  }
  function wrap(value, cellWidth, size = 9, bold = false, direction = rtl) {
    const result = [];
    for (const paragraph of text(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/u).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (measure(candidate, size, bold, direction) <= cellWidth) { line = candidate; continue; }
        if (line) { result.push(line); line = ''; }
        // Long references/words wrap instead of falling outside the page.
        for (const character of word) {
          if (line && measure(line + character, size, bold, direction) > cellWidth) { result.push(line); line = ''; }
          line += character;
        }
      }
      result.push(line);
    }
    return result;
  }
  function block(value, x, top, cellWidth, options = {}) {
    const size = options.size || 9;
    const lineHeight = size * 1.7;
    const lines = wrap(value, cellWidth, size, options.bold, options.direction ?? rtl);
    lines.forEach((line, i) => drawLine(line, x, top + i * lineHeight, cellWidth, options));
    return lines.length * lineHeight;
  }
  function newPage() {
    doc.addPage();
    doc.rect(0, 0, PAGE.width, 6).fill(COLORS.accent);
    drawLine('OxSteed', PAGE.margin, 26, width, { size: 22, bold: true, direction: false, align: rtl ? 'right' : 'left' });
    block(l[s.product], PAGE.margin, 59, width, { size: 10, color: COLORS.muted });
    drawLine(l.title, PAGE.margin, 86, width, { size: 18, bold: true });
    drawLine(l[s.kind], PAGE.margin, 121, width, { size: 9, color: COLORS.accent, bold: true });
    drawLine(`${utcDate(s.period.from, lang)} - ${utcDate(s.period.to, lang)} | UTC`, PAGE.margin, 145, width, { size: 9 });
    y = 176;
  }
  function ensure(height) { if (y + height > PAGE.bottom) newPage(); }
  function section(title) {
    const lines = wrap(title, width, 11, true);
    ensure(lines.length * 19 + 16);
    y += block(title, PAGE.margin, y, width, { size: 11, bold: true }) + 9;
  }
  function field(label, value, options = {}) {
    const labelWidth = 118;
    const valueWidth = width - labelWidth - 14;
    const lines = wrap(value, valueWidth, 9, false, options.direction ?? rtl);
    const height = Math.max(lines.length * 16, wrap(label, labelWidth, 8).length * 14) + 8;
    ensure(height);
    block(label, rtl ? PAGE.margin + width - labelWidth : PAGE.margin, y, labelWidth, { size: 8, color: COLORS.muted });
    block(value, rtl ? PAGE.margin : PAGE.margin + labelWidth + 14, y, valueWidth, { size: 9, ...options });
    y += height;
  }
  // Mirror the complete table in Arabic, not just the labels. Numeric cells
  // are independently LTR, so a transaction ID/amount never reads backwards.
  const logicalColumns = [{ key: 'date', width: 69 }, { key: 'activity', width: width - 69 - 68 - 68 - 86 }, { key: 'debit', width: 68 }, { key: 'credit', width: 68 }, { key: 'balance', width: 86 }];
  const columns = rtl ? [...logicalColumns].reverse() : logicalColumns;
  let x = PAGE.margin;
  for (const column of columns) { column.x = x; x += column.width; }
  function tableHeader() {
    const height = Math.max(...columns.map((column) => wrap(l[column.key], column.width - 12, 8, true).length)) * 14 + 15;
    ensure(height + 22);
    doc.rect(PAGE.margin, y, width, height).fill(COLORS.ink);
    for (const column of columns) block(l[column.key], column.x + 6, y + 6, column.width - 12, { size: 8, bold: true, color: '#FFFFFF' });
    y += height;
  }
  function activityRow(entry, index) {
    const activity = columns.find((column) => column.key === 'activity');
    const details = [l[entry.type], entry.description, `${l.reference}: ${entry.id}`].filter(Boolean).flatMap((value) => wrap(value, activity.width - 12, 8));
    const dateColumn = columns.find((column) => column.key === 'date');
    const dates = wrap(utcDate(entry.date, lang), dateColumn.width - 12, 7);
    const values = {
      debit: entry.debitCents ? amount(entry.debitCents, s.currencyCode, lang) : '-',
      credit: entry.creditCents ? amount(entry.creditCents, s.currencyCode, lang) : '-',
      balance: amount(entry.balanceAfterCents, s.currencyCode, lang),
    };
    let consumed = 0;
    let first = true;
    while (consumed < details.length) {
      if (y + 44 > PAGE.bottom) { newPage(); tableHeader(); }
      const lineCount = Math.min(details.length - consumed, Math.floor((PAGE.bottom - y - 12) / 15));
      const height = Math.max(lineCount, first ? dates.length : 1) * 15 + 12;
      if (index % 2 === 0) doc.rect(PAGE.margin, y, width, height).fill(COLORS.pale);
      details.slice(consumed, consumed + lineCount).forEach((line, i) => drawLine(line, activity.x + 6, y + 6 + i * 15, activity.width - 12, { size: 8, color: i + consumed === 0 ? COLORS.accent : COLORS.ink }));
      if (first) {
        dates.forEach((line, i) => drawLine(line, dateColumn.x + 6, y + 6 + i * 15, dateColumn.width - 12, { size: 7 }));
        for (const column of columns.filter((c) => values[c.key] !== undefined)) {
          let size = 8;
          while (size > 5 && measure(values[column.key], size, column.key === 'balance', false) > column.width - 12) size -= 0.5;
          drawLine(values[column.key], column.x + 6, y + 6, column.width - 12, { size, bold: column.key === 'balance', direction: false, align: 'right' });
        }
      }
      y += height;
      doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + width, y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      consumed += lineCount;
      first = false;
    }
  }
  try {
    newPage();
    field(l.owner, s.ownerName);
    field(l.account, s.accountLabel);
    field(l.reference, s.accountReference, { direction: false });
    field(l.id, s.id, { direction: false });
    field(l.generated, utcDate(s.generatedAt, lang, true));
    field(l.currency, s.currencyCode, { direction: false });
    y += 8;
    for (const [label, value] of [[l.opening, s.openingBalanceCents], [l.credits, s.totalCreditsCents], [l.debits, s.totalDebitsCents], [l.closing, s.closingBalanceCents]]) {
      field(label, `${amount(value, s.currencyCode, lang)} ${s.currencyCode}`, { bold: label === l.closing, direction: false });
    }
    y += 12;
    section(`${l.activity} (${new Intl.NumberFormat(lang).format(s.transactionCount)})`);
    tableHeader();
    if (!s.transactions.length) { ensure(30); y += block(l.noActivity, PAGE.margin + 8, y + 8, width - 16, { size: 9 }) + 16; }
    s.transactions.forEach(activityRow);
    y += 18;
    if (s.kind === 'interim' && s.holdsAsOf) {
      section(l.holds);
      field(l.generated, utcDate(s.holdsAsOf, lang, true));
      field(l.holds, `${amount(s.totalHeldCents, s.currencyCode, lang)} ${s.currencyCode}`, { direction: false });
      const noteLines = wrap(l.holdsNote, width, 9);
      for (const line of noteLines) { ensure(18); drawLine(line, PAGE.margin, y, width, { size: 9, color: COLORS.muted }); y += 16; }
      y += 9;
      for (const hold of s.holds) {
        field(l.reference, hold.id, { direction: false });
        if (hold.description) field(l.activity, hold.description);
        field(l.holds, `${amount(hold.amountCents, s.currencyCode, lang)} ${s.currencyCode}`, { direction: false });
      }
    }
    y += 14;
    for (const line of wrap(l.disclaimer, width, 9)) { ensure(18); drawLine(line, PAGE.margin, y, width, { size: 9, color: COLORS.muted }); y += 17; }
    y += 12;
    for (const line of wrap(l.support, width, 9)) { ensure(18); drawLine(line, PAGE.margin, y, width, { size: 9, color: COLORS.muted }); y += 17; }
    y += 12;
    field(l.digest, s.contentHash, { size: 7, direction: false });
    ensure(24);
    drawLine(l.end, PAGE.margin, y + 7, width, { size: 9, bold: true, align: 'center' });
    const pageCount = doc.bufferedPageRange().count;
    for (let page = 0; page < pageCount; page++) {
      doc.switchToPage(page);
      doc.moveTo(PAGE.margin, 781).lineTo(PAGE.margin + width, 781).strokeColor(COLORS.line).stroke();
      // The page label is a translated template: e.g. Page {{page}} of {{total}}.
      const pageTemplate = /\{\{?page\}?\}/.test(String(l.page)) ? String(l.page) : `${l.page} {{page}} / {{total}}`;
      const pageLabel = pageTemplate.replace(/\{\{?page\}?\}/g, new Intl.NumberFormat(lang).format(page + 1)).replace(/\{\{?total\}?\}/g, new Intl.NumberFormat(lang).format(pageCount));
      drawLine(pageLabel, PAGE.margin, 790, width, { size: 8, align: rtl ? 'left' : 'right' });
      const footerReference = wrap(`${s.id} | ${s.currencyCode}`, width - 115, 7, false, false)[0];
      drawLine(footerReference, PAGE.margin, 790, width - 115, { size: 7, color: COLORS.muted, direction: false, align: rtl ? 'right' : 'left' });
    }
    doc.end();
  } catch (error) {
    doc.destroy(error);
  }
  return output;
}

module.exports = { renderStatementPdf, renderStatementCsv };
