'use strict';

/**
 * settlementStatementPdf — tagged-PDF renderer for the settlement statement
 * products (restaurant_settlement, helper_earnings, business).
 *
 * Self-contained: it reuses only the pure helpers from creditStatementPdf
 * (text, languageCopy, amount, decimal, utcDate, visualRuns,
 * RENDERER_VERSIONS, amendmentMoneyKeys) and implements its own tagged-PDF
 * scaffolding following the same patterns (H1/H2 headings, L/LI/Lbl/LBody
 * label-value lists, Table/TR/TH/TD tables, Artifact pagination footers, no
 * silent glyph substitution).
 *
 * Every PDF emitted here is tagged with a logical structure tree mirroring
 * the visual reading order. Like the credit renderer, this is a tagged PDF,
 * not a certified PDF/UA claim.
 *
 * Faithfulness: the renderer never omits rows to fit the page (page breaks
 * fall between rows) and fails closed on shape or money mismatches, so the
 * issued artifact always represents the archived document exactly.
 * Informational sections (partner settlements, payouts, orders) are labeled
 * as such and never enter the reconciled equation.
 *
 * Amended versions: when the document carries an amendment envelope
 * (statementAmendmentService.buildAmendedDocument), the PDF is labeled as an
 * amended statement with its revision, type, reason, supersedes link, and the
 * original/adjustment/revised totals.
 */

const path = require('path');
const PDFDocument = require('pdfkit');
const {
  text, languageCopy, amount, utcDate, visualRuns, RENDERER_VERSIONS, amendmentMoneyKeys,
} = require('./creditStatementPdf');

const PDFKIT_VERSION = require('pdfkit/package.json').version;
const FONT_DIR = path.join(__dirname, '../assets/fonts');
const MAX_ROWS = 5000;
const COLORS = { ink: '#172534', muted: '#536475', accent: '#B74712', line: '#DCE2E8', pale: '#F3F6F8' };
const PAGE = { width: 595.28, height: 841.89, margin: 40, bottom: 758 };
const SUPPORT_EMAIL = 'support@oxsteed.com';
const SUPPORTED = new Set(['restaurant_settlement', 'helper_earnings', 'business']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function integer(value, name) {
  if (!Number.isSafeInteger(value)) fail('statement_invalid_amount', name);
  return value;
}

function isoDate(value) {
  const source = String(value ?? '').slice(0, 10);
  if (!DATE_RE.test(source)) fail('statement_invalid_date');
  return source;
}

function isoDateTime(value) {
  const parsed = new Date(String(value ?? ''));
  if (!Number.isFinite(parsed.getTime())) fail('statement_invalid_date');
  return parsed.toISOString();
}

// --- document normalization ------------------------------------------------
// Validates the settlement document shape per product and reduces it to a
// render model: header fields, summary label-value pairs, labeled sections
// (tables), notes, and the optional amendment envelope. Amounts stay integer
// minor units until the renderers format them.
function normalizeSettlementDocument(document) {
  if (!document || !SUPPORTED.has(document.product)) fail('statement_invalid');
  if (!/^[A-Z]{3}$/.test(document.currencyCode)) fail('statement_invalid_currency');
  if (!['monthly', 'interim'].includes(document.kind)) fail('statement_invalid');
  const period = document.period && typeof document.period === 'object' ? document.period : {};
  const from = isoDate(period.from);
  const to = isoDate(period.to);
  if (to < from) fail('statement_invalid_date');
  const generatedAt = isoDateTime(document.generatedAt);
  const base = {
    id: text(document.id, 256),
    kind: document.kind,
    product: document.product,
    ownerName: text(document.ownerName, 256),
    accountLabel: text(document.accountLabel, 256),
    accountReference: text(document.accountReference, 256),
    currencyCode: document.currencyCode,
    period: { from, to },
    generatedAt,
    contentHash: text(document.contentHash, 128),
    summary: [],
    sections: [],
    notes: [],
    amendment: normalizeAmendment(document),
  };
  if (document.product === 'restaurant_settlement') return normalizeRestaurantSettlement(document, base);
  if (document.product === 'helper_earnings') return normalizeHelperEarnings(document, base);
  return normalizeBusiness(document, base);
}

function normalizeAmendment(document) {
  const amendment = document && typeof document.amendment === 'object' ? document.amendment : null;
  if (!amendment) return null;
  const totals = document.totals && typeof document.totals === 'object' ? document.totals : null;
  const supersedes = document.supersedes && typeof document.supersedes === 'object' ? document.supersedes : null;
  return {
    type: text(amendment.type, 32),
    presentation: text(amendment.presentation, 32),
    reason: text(amendment.reason, 2000),
    decidedAt: amendment.decidedAt ? isoDateTime(amendment.decidedAt) : null,
    revision: Number.isSafeInteger(document.version) ? document.version : null,
    supersedesKind: supersedes ? text(supersedes.kind, 32) : null,
    supersedesRevision: supersedes && Number.isSafeInteger(supersedes.revision) ? supersedes.revision : null,
    totals,
  };
}

function moneyRow(labelKey, minor) {
  return { labelKey, minor: integer(minor, labelKey) };
}

function txActivityLabel(l, tx) {
  const typeLabel = l[tx.type] || l.other;
  const parts = [typeLabel];
  if (tx.description) parts.push(text(tx.description, 280));
  if (tx.referenceId) parts.push(`${l.reference}: ${text(tx.referenceType || '', 64)}:${text(String(tx.referenceId), 64)}`);
  return parts.join(' - ');
}

function normalizeRestaurantSettlement(document, base) {
  const opening = integer(document.openingBalanceCents, 'opening');
  const credits = integer(document.totalCreditsCents, 'credits');
  const debits = integer(document.totalDebitsCents, 'debits');
  const closing = integer(document.closingBalanceCents, 'closing');
  const transactions = Array.isArray(document.transactions) ? document.transactions : [];
  if (transactions.length > MAX_ROWS) fail('statement_export_too_large');
  if (document.transactionCount !== transactions.length) fail('statement_incomplete_export');
  // Exact reconciliation, same bar as the credit renderer.
  let running = BigInt(opening);
  let sumCredits = 0n;
  let sumDebits = 0n;
  const rows = transactions.map((entry) => {
    const debit = integer(entry.debitCents, 'debit');
    const credit = integer(entry.creditCents, 'credit');
    const balance = integer(entry.balanceAfterCents, 'balance');
    if ((debit < 0 || credit < 0) || (debit && credit)) fail('statement_invalid_amount');
    running += BigInt(credit) - BigInt(debit);
    sumCredits += BigInt(credit);
    sumDebits += BigInt(debit);
    if (running !== BigInt(balance)) fail('statement_balance_mismatch');
    return {
      date: isoDateTime(entry.date),
      debitCents: debit,
      creditCents: credit,
      balanceAfterCents: balance,
      type: entry.type,
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
    };
  });
  if (running !== BigInt(closing) || sumCredits !== BigInt(credits) || sumDebits !== BigInt(debits)) {
    fail('statement_balance_mismatch');
  }
  base.summary = [
    moneyRow('opening', opening), moneyRow('credits', credits),
    moneyRow('debits', debits), moneyRow('closing', closing),
  ];
  base.sections.push({
    titleKey: 'journalSection',
    columns: [
      { key: 'date', labelKey: 'date', width: 74 },
      { key: 'activity', labelKey: 'activity', width: 0 },
      { key: 'debit', labelKey: 'debit', width: 70, numeric: true },
      { key: 'credit', labelKey: 'credit', width: 70, numeric: true },
      { key: 'balance', labelKey: 'balance', width: 88, numeric: true },
    ],
    rows,
    emptyKey: 'noActivity',
  });
  const settlements = Array.isArray(document.partnerSettlements) ? document.partnerSettlements : [];
  if (settlements.length > MAX_ROWS) fail('statement_export_too_large');
  if (settlements.length) {
    base.sections.push({
      titleKey: 'settlementsSection',
      columns: [
        { key: 'period', labelKey: 'periodCol', width: 120 },
        { key: 'gross', labelKey: 'grossCol', width: 66, numeric: true },
        { key: 'refund', labelKey: 'refundCol', width: 66, numeric: true },
        { key: 'fee', labelKey: 'feeCol', width: 66, numeric: true },
        { key: 'net', labelKey: 'netCol', width: 66, numeric: true },
        { key: 'status', labelKey: 'jobStatus', width: 0 },
      ],
      rows: settlements.map((s) => ({
        period: `${isoDate(s.periodStart)} - ${isoDate(s.periodEnd)}`,
        grossCents: integer(s.grossCents, 'gross'),
        refundCents: integer(s.refundCents, 'refund'),
        feeCents: integer(s.feeCents, 'fee'),
        netCents: integer(s.netCents, 'net'),
        status: text(s.payoutVerified ? 'verified' : s.payoutStatus, 64),
        payoutStatus: s.payoutStatus,
        payoutVerified: Boolean(s.payoutVerified),
      })),
    });
  }
  const payouts = Array.isArray(document.payouts) ? document.payouts : [];
  if (payouts.length > MAX_ROWS) fail('statement_export_too_large');
  if (payouts.length) {
    base.sections.push({
      titleKey: 'payoutsSection',
      columns: [
        { key: 'payout', labelKey: 'payoutCol', width: 120 },
        { key: 'amount', labelKey: 'amountCol', width: 78, numeric: true },
        { key: 'outcome', labelKey: 'outcomeCol', width: 96 },
        { key: 'status', labelKey: 'jobStatus', width: 0 },
      ],
      rows: payouts.map((p) => ({
        payout: text(p.id, 64),
        amountCents: integer(p.amountCents, 'payout'),
        outcome: text(p.outcome, 64),
        status: text(p.status, 64),
        created: isoDateTime(p.createdAt),
      })),
    });
  }
  const orders = Array.isArray(document.orders) ? document.orders : [];
  if (orders.length > MAX_ROWS) fail('statement_export_too_large');
  if (orders.length) {
    base.sections.push({
      titleKey: 'ordersSection',
      columns: [
        { key: 'order', labelKey: 'orderCol', width: 110 },
        { key: 'created', labelKey: 'createdCol', width: 74 },
        { key: 'total', labelKey: 'amountCol', width: 78, numeric: true },
        { key: 'funding', labelKey: 'fundingCol', width: 0 },
      ],
      rows: orders.map((o) => ({
        order: text(o.id, 64),
        created: isoDateTime(o.createdAt),
        totalCents: integer(o.totalCents, 'order'),
        funding: text(o.funding, 64),
        paymentStatus: text(o.paymentStatus, 64),
      })),
    });
  }
  base.notes = ['payoutHonestyNote', 'customerCreditNote', 'cardProceedsNote', 'restaurantSettlementDisclaimer'];
  return base;
}

function jobRowCells(entry) {
  return {
    job: text(entry.jobId, 64),
    title: text(entry.title, 140),
    status: text(entry.payoutStatus, 64),
    earnedCents: integer(entry.helperPayoutCents, 'earned'),
    feeCents: entry.platformFeeCents === null || entry.platformFeeCents === undefined
      ? null : integer(entry.platformFeeCents, 'fee'),
  };
}

function normalizeHelperEarnings(document, base) {
  const opening = integer(document.openingPayableCents, 'opening');
  const posted = integer(document.postedEarningsCents, 'posted');
  const settled = integer(document.settledPayoutsCents, 'settled');
  const removed = integer(document.statusRemovalsCents, 'removed');
  const closing = integer(document.closingPayableCents, 'closing');
  if (BigInt(opening) + BigInt(posted) - BigInt(settled) - BigInt(removed) !== BigInt(closing)) {
    fail('statement_balance_mismatch');
  }
  base.summary = [
    moneyRow('openingPayable', opening), moneyRow('postedEarnings', posted),
    moneyRow('settledPayouts', settled), moneyRow('removedEarnings', removed),
    moneyRow('closingPayable', closing),
  ];
  const buckets = document.buckets && typeof document.buckets === 'object' ? document.buckets : {};
  base.sections.push({
    titleKey: 'bucketsSection',
    list: [
      moneyRow('accrued', buckets.accruedCents || 0),
      moneyRow('inTransit', buckets.inTransitCents || 0),
      moneyRow('settledBucket', buckets.settledAllTimeCents || 0),
      moneyRow('notOwedBucket', buckets.notOwedCents || 0),
    ],
  });
  const earnings = Array.isArray(document.earnings) ? document.earnings : [];
  const settledRows = Array.isArray(document.settled) ? document.settled : [];
  const removedRows = Array.isArray(document.removed) ? document.removed : [];
  for (const list of [earnings, settledRows, removedRows]) {
    if (list.length > MAX_ROWS) fail('statement_export_too_large');
  }
  const earningColumns = [
    { key: 'job', labelKey: 'payoutCol', width: 110 },
    { key: 'title', labelKey: 'jobTitle', width: 0 },
    { key: 'completed', labelKey: 'completedCol', width: 74 },
    { key: 'status', labelKey: 'jobStatus', width: 80 },
    { key: 'earned', labelKey: 'earnedCol', width: 78, numeric: true },
  ];
  if (earnings.length) {
    base.sections.push({
      titleKey: 'earningsSection',
      columns: earningColumns,
      rows: earnings.map((e) => ({ ...jobRowCells(e), completed: isoDateTime(e.completedAt) })),
    });
  }
  if (settledRows.length) {
    base.sections.push({
      titleKey: 'settledSection',
      columns: [
        { key: 'job', labelKey: 'payoutCol', width: 110 },
        { key: 'title', labelKey: 'jobTitle', width: 0 },
        { key: 'paid', labelKey: 'paidCol', width: 74 },
        { key: 'earned', labelKey: 'earnedCol', width: 78, numeric: true },
      ],
      rows: settledRows.map((e) => ({ ...jobRowCells(e), paid: isoDateTime(e.paidAt) })),
    });
  }
  if (removedRows.length) {
    base.sections.push({
      titleKey: 'removedSection',
      columns: earningColumns,
      rows: removedRows.map((e) => ({ ...jobRowCells(e), completed: isoDateTime(e.removedAt || e.completedAt) })),
    });
  }
  base.notes = [document.sourceHistoryVersion ? 'renditionNote' : 'helperSnapshotNote', 'notTaxForm', 'helperEarningsDisclaimer'];
  return base;
}

function normalizeBusiness(document, base) {
  const r = document.receivables && typeof document.receivables === 'object' ? document.receivables : {};
  const p = document.payables && typeof document.payables === 'object' ? document.payables : {};
  const opening = integer(r.openingOutstandingCents, 'opening');
  const invoiced = integer(r.invoicedCents, 'invoiced');
  const collected = integer(r.collectedOrAdjustedCents, 'collected');
  const cancelled = integer(r.cancelledCents, 'cancelled');
  const closing = integer(r.closingOutstandingCents, 'closing');
  if (BigInt(opening) + BigInt(invoiced) - BigInt(collected) - BigInt(cancelled) !== BigInt(closing)) {
    fail('statement_balance_mismatch');
  }
  base.summary = [
    moneyRow('openingOutstanding', opening), moneyRow('invoicedTotal', invoiced),
    moneyRow('collectedAdjusted', collected), moneyRow('cancelledTotal', cancelled),
    moneyRow('closingOutstanding', closing),
  ];
  const invoices = Array.isArray(r.invoices) ? r.invoices : [];
  if (invoices.length > MAX_ROWS) fail('statement_export_too_large');
  if (invoices.length) {
    base.sections.push({
      titleKey: 'receivablesSection',
      columns: [
        { key: 'invoice', labelKey: 'invoiceNo', width: 92 },
        { key: 'client', labelKey: 'billedTo', width: 0 },
        { key: 'status', labelKey: 'jobStatus', width: 76 },
        { key: 'issued', labelKey: 'issuedCol', width: 74 },
        { key: 'total', labelKey: 'invoiceTotal', width: 70, numeric: true },
        { key: 'paid', labelKey: 'amountPaidCol', width: 70, numeric: true },
        { key: 'outstanding', labelKey: 'outstandingCol', width: 70, numeric: true },
      ],
      rows: invoices.map((inv) => ({
        invoice: text(inv.invoiceNumber || inv.id, 64),
        client: text(inv.clientName, 140),
        status: text(inv.status, 64),
        issued: inv.issueDate ? isoDate(inv.issueDate) : '-',
        totalCents: integer(inv.totalCents, 'invoice'),
        paidCents: integer(inv.paidCents, 'paid'),
        outstandingCents: integer(inv.outstandingCents, 'outstanding'),
      })),
    });
  }
  const expenses = Array.isArray(p.expenses) ? p.expenses : [];
  if (expenses.length > MAX_ROWS) fail('statement_export_too_large');
  base.sections.push({
    titleKey: 'payablesSection',
    list: [moneyRow('amountCol', p.totalExpensesCents || 0)],
    ...(expenses.length ? {
      columns: [
        { key: 'date', labelKey: 'date', width: 74 },
        { key: 'category', labelKey: 'categoryCol', width: 92 },
        { key: 'description', labelKey: 'descriptionCol', width: 0 },
        { key: 'amount', labelKey: 'amountCol', width: 78, numeric: true },
      ],
      rows: expenses.map((e) => ({
        date: isoDate(e.expenseDate),
        category: text(e.category, 64),
        description: text(e.description, 255),
        amountCents: integer(e.amountCents, 'expense'),
      })),
    } : {}),
  });
  const settlements = Array.isArray(document.partnerSettlements) ? document.partnerSettlements : [];
  if (settlements.length > MAX_ROWS) fail('statement_export_too_large');
  if (settlements.length) {
    base.sections.push({
      titleKey: 'settlementsSection',
      columns: [
        { key: 'period', labelKey: 'periodCol', width: 120 },
        { key: 'net', labelKey: 'netCol', width: 78, numeric: true },
        { key: 'currency', labelKey: 'currency', width: 60 },
        { key: 'status', labelKey: 'jobStatus', width: 0 },
      ],
      rows: settlements.map((s) => ({
        period: `${isoDate(s.periodStart)} - ${isoDate(s.periodEnd)}`,
        netCents: integer(s.netCents, 'net'),
        currency: text(s.currencyCode, 8),
        status: text(s.payoutVerified ? 'verified' : s.payoutStatus, 64),
      })),
    });
  }
  const restaurantSections = Array.isArray(document.restaurantPayouts) ? document.restaurantPayouts : [];
  for (const rs of restaurantSections) {
    const payouts = Array.isArray(rs.payouts) ? rs.payouts : [];
    if (!payouts.length) continue;
    if (payouts.length > MAX_ROWS) fail('statement_export_too_large');
    base.sections.push({
      titleKey: 'payoutsSection',
      titleSuffix: text(rs.restaurantName, 120),
      columns: [
        { key: 'payout', labelKey: 'payoutCol', width: 110 },
        { key: 'amount', labelKey: 'amountCol', width: 78, numeric: true },
        { key: 'outcome', labelKey: 'outcomeCol', width: 96 },
        { key: 'created', labelKey: 'createdCol', width: 0 },
      ],
      rows: payouts.map((pay) => ({
        payout: text(pay.id, 64),
        amountCents: integer(pay.amountCents, 'payout'),
        outcome: text(pay.outcome, 64),
        created: isoDateTime(pay.createdAt),
      })),
    });
  }
  base.notes = [document.sourceHistoryVersion ? 'renditionNote' : 'businessLimitationNote', 'notTaxForm', 'businessDisclaimer'];
  return base;
}

// --- tagged PDF writer ------------------------------------------------------
async function renderSettlementStatementPdf(document, { language = 'en' } = {}) {
  const s = normalizeSettlementDocument(document);
  const { lang, labels: l } = languageCopy(language);
  s.labels = l;
  const rtl = lang === 'ar';
  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true, autoFirstPage: false,
    info: {
      Title: `${l.title} - ${l[s.product]}`, Author: 'OxSteed',
      Subject: `${s.id} | ${s.period.from} - ${s.period.to}`,
      CreationDate: new Date(s.generatedAt), ModDate: new Date(s.generatedAt),
    },
    lang, tagged: true,
  });
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

  function struct(tag, draw, attrs = {}) {
    const element = doc.struct(tag, attrs, () => draw(element));
    doc.addStructure(element);
    return element;
  }
  function artifact(type, bbox, draw) {
    doc.markContent('Artifact', { type, bbox });
    try { draw(); } finally { doc.endMarkedContent(); }
  }
  function runs(value, size, bold, direction = rtl) {
    return visualRuns(text(value), direction).map((run) => {
      const font = `${run.family}${bold ? 'Bold' : 'Regular'}`;
      doc.font(font).fontSize(size);
      for (const character of run.text) {
        if (!/\s/u.test(character) && !doc._font.font.hasGlyphForCodePoint(character.codePointAt(0))) {
          fail('statement_unsupported_glyph', `Unsupported glyph U+${character.codePointAt(0).toString(16).toUpperCase()}`);
        }
      }
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
  function ensure(height) { if (y + height > PAGE.bottom) newPage(false); }
  function section(title) {
    const lines = wrap(title, width, 11, true);
    ensure(lines.length * 19 + 16);
    const top = y;
    struct('H2', () => block(title, PAGE.margin, top, width, { size: 11, bold: true }));
    y = top + lines.length * 11 * 1.7 + 9;
  }
  let listElement = null;
  function beginList() {
    listElement = doc.struct('L');
    doc.addStructure(listElement);
  }
  function field(label, value, options = {}) {
    const labelWidth = 150;
    const valueWidth = width - labelWidth - 14;
    const lines = wrap(value, valueWidth, 9, false, options.direction ?? rtl);
    const height = Math.max(lines.length * 16, wrap(label, labelWidth, 8).length * 14) + 8;
    ensure(height);
    const top = y;
    const labelX = rtl ? PAGE.margin + width - labelWidth : PAGE.margin;
    const valueX = rtl ? PAGE.margin : PAGE.margin + labelWidth + 14;
    const item = doc.struct('LI', {}, [
      doc.struct('Lbl', {}, () => block(label, labelX, top, labelWidth, { size: 8, color: COLORS.muted })),
      doc.struct('LBody', {}, () => block(value, valueX, top, valueWidth, { size: 9, ...options })),
    ]);
    listElement.add(item);
    y = top + height;
  }
  function paraLines(value, { size = 9, color = COLORS.muted, advance = 17 } = {}) {
    for (const line of wrap(value, width, size)) {
      ensure(size * 1.7 + 2);
      const top = y;
      struct('P', () => drawLine(line, PAGE.margin, top, width, { size, color }));
      y = top + advance;
    }
  }
  function supportBlock() {
    for (const line of wrap(l.support, width, 9)) {
      ensure(18);
      const top = y;
      const at = line.indexOf(SUPPORT_EMAIL);
      if (at < 0) {
        struct('P', () => drawLine(line, PAGE.margin, top, width, { size: 9, color: COLORS.muted }));
      } else {
        const before = line.slice(0, at);
        const after = line.slice(at + SUPPORT_EMAIL.length);
        const lineWidth = measure(line, 9, false, rtl);
        const startX = rtl ? PAGE.margin + width - lineWidth : PAGE.margin;
        const beforeWidth = measure(before, 9, false, rtl);
        const emailWidth = measure(SUPPORT_EMAIL, 9, false, false);
        const emailX = startX + beforeWidth;
        const afterX = emailX + emailWidth;
        const paragraph = doc.struct('P');
        doc.addStructure(paragraph);
        if (before) paragraph.add(doc.struct('Span', {}, () => drawLine(before, startX, top, beforeWidth, { size: 9, color: COLORS.muted, align: 'left', direction: rtl })));
        const link = doc.struct('Link', {}, () => {
          drawLine(SUPPORT_EMAIL, emailX, top, emailWidth, { size: 9, color: COLORS.muted, align: 'left', direction: false });
          doc.annotate(emailX, top, emailWidth, 14, { Subtype: 'Link', A: { S: 'URI', URI: new String(`mailto:${SUPPORT_EMAIL}`) } });
        });
        paragraph.add(link);
        if (after) paragraph.add(doc.struct('Span', {}, () => drawLine(after, afterX, top, measure(after, 9, false, rtl), { size: 9, color: COLORS.muted, align: 'left', direction: rtl })));
      }
      y = top + 17;
    }
  }
  // Generic table: fixed columns, one TR per row, page breaks between rows
  // (never mid-row). Numeric cells are independently LTR. The structure tree
  // follows the logical column order on every page; only the visual x
  // positions mirror for RTL.
  function renderTable(title, columns, rows, formatCell) {
    const fixed = columns.reduce((sum, c) => sum + c.width, 0);
    const flex = columns.filter((c) => c.width === 0);
    const flexWidth = flex.length ? (width - fixed) / flex.length : 0;
    const cols = columns.map((c) => ({ ...c, width: c.width === 0 ? flexWidth : c.width }));
    const visual = rtl ? [...cols].reverse() : cols;
    let x = PAGE.margin;
    for (const c of visual) { c.x = x; x += c.width; }
    const tableElement = doc.struct('Table', { title });
    doc.addStructure(tableElement);
    const headerHeight = Math.max(...cols.map((c) => wrap(l[c.labelKey] || c.labelKey, c.width - 12, 8, true).length)) * 14 + 15;
    const drawHeader = () => {
      ensure(headerHeight + 10);
      const top = y;
      artifact('Layout', [PAGE.margin, top, PAGE.margin + width, top + headerHeight], () => {
        doc.rect(PAGE.margin, top, width, headerHeight).fill(COLORS.ink);
      });
      tableElement.add(doc.struct('TR', {}, cols.map((c) =>
        doc.struct('TH', {}, () => block(l[c.labelKey] || c.labelKey, c.x + 6, top + 6, c.width - 12, { size: 8, bold: true, color: '#FFFFFF' })))));
      y = top + headerHeight;
    };
    drawHeader();
    rows.forEach((row, index) => {
      const cells = cols.map((c) => formatCell(c, row));
      const height = Math.max(...cells.map((cell, i) => wrap(cell, cols[i].width - 12, 8).length)) * 15 + 12;
      if (y + height > PAGE.bottom) {
        newPage(false);
        drawHeader();
      }
      const top = y;
      artifact('Layout', [PAGE.margin, top, PAGE.margin + width, top + height], () => {
        if (index % 2 === 0) doc.rect(PAGE.margin, top, width, height).fill(COLORS.pale);
      });
      const rowElement = doc.struct('TR', {}, cols.map((c, i) => {
        const cell = cells[i];
        const numeric = c.numeric;
        return doc.struct('TD', {}, () => {
          const lines = wrap(cell, c.width - 12, 8);
          lines.forEach((line, li) => drawLine(line, c.x + 6, top + 6 + li * 15, c.width - 12,
            { size: 8, direction: numeric ? false : rtl, align: numeric ? 'right' : rtl ? 'right' : 'left' }));
        });
      }));
      tableElement.add(rowElement);
      y = top + height;
      artifact('Layout', [PAGE.margin, y - 1, PAGE.margin + width, y + 1], () => {
        doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + width, y).strokeColor(COLORS.line).lineWidth(0.5).stroke();
      });
    });
    y += 14;
  }
  function newPage(first) {
    doc.addPage();
    if (first) {
      struct('P', () => {
        doc.rect(0, 0, PAGE.width, 6).fill(COLORS.accent);
        drawLine('OxSteed', PAGE.margin, 26, width, { size: 22, bold: true, direction: false, align: rtl ? 'right' : 'left' });
      });
      struct('P', () => block(l[s.product], PAGE.margin, 59, width, { size: 10, color: COLORS.muted }));
      struct('H1', () => drawLine(l.title, PAGE.margin, 86, width, { size: 18, bold: true }));
      struct('H2', () => drawLine(l[s.kind], PAGE.margin, 121, width, { size: 9, color: COLORS.accent, bold: true }));
      struct('P', () => drawLine(`${utcDate(s.period.from, lang)} - ${utcDate(s.period.to, lang)} | UTC`, PAGE.margin, 145, width, { size: 9 }));
      if (s.amendment) {
        struct('H2', () => drawLine(`${l.amendedStatement} - ${l.revision} ${s.amendment.revision || ''}`.trim(), PAGE.margin, 162, width, { size: 9, color: COLORS.accent, bold: true }));
      }
    } else {
      artifact('Layout', [PAGE.margin, 14, PAGE.margin + width, 168], () => {
        doc.rect(0, 0, PAGE.width, 6).fill(COLORS.accent);
        drawLine('OxSteed', PAGE.margin, 26, width, { size: 22, bold: true, direction: false, align: rtl ? 'right' : 'left' });
        block(l[s.product], PAGE.margin, 59, width, { size: 10, color: COLORS.muted });
        drawLine(l.title, PAGE.margin, 86, width, { size: 18, bold: true });
        drawLine(l[s.kind], PAGE.margin, 121, width, { size: 9, color: COLORS.accent, bold: true });
        drawLine(`${utcDate(s.period.from, lang)} - ${utcDate(s.period.to, lang)} | UTC`, PAGE.margin, 145, width, { size: 9 });
      });
    }
    y = 186;
  }

  const money = (minor) => `${amount(minor, s.currencyCode, lang)} ${s.currencyCode}`;
  const OUTCOME_LABELS = { verified: 'verified', in_transit: 'inTransit', failed: 'failedPayout', never_executed: 'neverExecuted' };
  function formatCell(column, row) {
    const value = row[column.key];
    if (value === null || value === undefined || value === '-') return '-';
    if (column.key === 'activity') return txActivityLabel(l, row);
    if (column.key === 'date' || column.key === 'created' || column.key === 'completed' || column.key === 'paid') {
      return utcDate(String(value).slice(0, 10), lang);
    }
    if (column.key === 'issued') return utcDate(String(value).slice(0, 10), lang);
    if (typeof value === 'number' && column.numeric) return money(value);
    if (column.key === 'period') return String(value);
    if (column.key === 'outcome') return l[OUTCOME_LABELS[value]] || String(value);
    if (column.key === 'status' && row.payoutVerified) return l.verified;
    if (column.key === 'status' && row.payoutStatus) return l[row.payoutStatus] || String(value);
    return String(value);
  }

  function renderAmendmentSection() {
    const a = s.amendment;
    section(`${l.amendedStatement}${a.revision ? ` - ${l.revision} ${a.revision}` : ''}`);
    beginList();
    field(l.amendmentTypeLabel, l[a.type] || a.type);
    field(l.presentationLabel, a.presentation === 'later_period' ? l.laterPeriod : l[a.presentation] || a.presentation);
    field(l.reasonLabel, a.reason);
    if (a.decidedAt) field(l.decidedAtLabel, utcDate(a.decidedAt, lang, true));
    field(l.supersedesLabel, a.supersedesKind === 'original'
      ? l.monthly
      : `${l.revision} ${a.supersedesRevision || ''}`.trim());
    const totals = a.totals;
    if (totals && typeof totals === 'object') {
      const groups = [
        ['originalTotals', totals.original],
        ['adjustmentTotals', totals.adjustment],
        ['revisedTotals', totals.revised],
      ];
      for (const [groupKey, group] of groups) {
        if (!group || typeof group !== 'object') continue;
        y += 6;
        section(l[groupKey]);
        beginList();
        for (const [moneyKey, labelKey] of amendmentMoneyKeys(s.product)) {
          if (group[moneyKey] === undefined || group[moneyKey] === null) continue;
          field(l[labelKey], money(Number(group[moneyKey])), { bold: groupKey === 'revisedTotals', direction: false });
        }
        const compensating = Array.isArray(group.compensatingTransactions) ? group.compensatingTransactions : [];
        if (compensating.length) {
          y += 6;
          renderTable(l.adjustmentTotals, [
            { key: 'id', labelKey: 'reference', width: 150 },
            { key: 'amount', labelKey: 'amountCol', width: 90, numeric: true },
            { key: 'direction', labelKey: 'jobStatus', width: 0 },
          ], compensating, (column, tx) => {
            if (column.key === 'id') return String(tx.id);
            if (column.key === 'amount') return money(Number(tx.amountCents));
            return `${tx.direction}${tx.effectiveDate ? ` - ${tx.effectiveDate}` : ''}`;
          });
        }
      }
    }
    y += 8;
  }

  try {
    newPage(true);
    beginList();
    field(l.owner, s.ownerName);
    field(l.account, s.accountLabel);
    field(l.reference, s.accountReference, { direction: false });
    field(l.id, s.id, { direction: false });
    field(l.generated, utcDate(s.generatedAt, lang, true));
    field(l.currency, s.currencyCode, { direction: false });
    y += 8;
    if (s.amendment) renderAmendmentSection();
    section(l.summary);
    beginList();
    for (const item of s.summary) {
      const bold = /closing/i.test(item.labelKey);
      field(l[item.labelKey] || item.labelKey, money(item.minor), { bold, direction: false });
    }
    y += 12;
    for (const sec of s.sections) {
      const title = sec.titleSuffix ? `${l[sec.titleKey]} - ${sec.titleSuffix}` : l[sec.titleKey];
      section(title);
      if (sec.list) {
        beginList();
        for (const item of sec.list) field(l[item.labelKey] || item.labelKey, money(item.minor), { direction: false });
        y += 8;
      }
      if (sec.columns && sec.rows) {
        if (sec.rows.length) {
          renderTable(title, sec.columns, sec.rows, formatCell);
        } else if (sec.emptyKey) {
          ensure(30);
          const top = y;
          struct('P', () => block(l[sec.emptyKey], PAGE.margin + 8, top + 8, width - 16, { size: 9 }));
          y = top + 40;
        }
      }
      y += 6;
    }
    y += 8;
    for (const noteKey of s.notes) paraLines(l[noteKey] || noteKey, { size: 9, color: COLORS.muted });
    y += 12;
    supportBlock();
    y += 12;
    beginList();
    field(l.digest, s.contentHash, { size: 7, direction: false });
    ensure(24);
    const endTop = y + 7;
    struct('P', () => drawLine(l.end, PAGE.margin, endTop, width, { size: 9, bold: true, align: 'center' }));
    const pageCount = doc.bufferedPageRange().count;
    for (let page = 0; page < pageCount; page++) {
      doc.switchToPage(page);
      artifact('Pagination', [PAGE.margin, 779, PAGE.margin + width, 806], () => {
        doc.moveTo(PAGE.margin, 781).lineTo(PAGE.margin + width, 781).strokeColor(COLORS.line).stroke();
        const pageTemplate = /\{\{?page\}?\}/.test(String(l.page)) ? String(l.page) : `${l.page} {{page}} / {{total}}`;
        const pageLabel = pageTemplate.replace(/\{\{?page\}?\}/g, new Intl.NumberFormat(lang).format(page + 1)).replace(/\{\{?total\}?\}/g, new Intl.NumberFormat(lang).format(pageCount));
        drawLine(pageLabel, PAGE.margin, 790, width, { size: 8, align: rtl ? 'left' : 'right' });
        const footerReference = `${s.id} | ${s.currencyCode}`;
        drawLine(footerReference, PAGE.margin, 790, width - 115, { size: 7, color: COLORS.muted, direction: false, align: rtl ? 'right' : 'left' });
      });
    }
    doc.end();
  } catch (error) {
    doc.destroy(error);
  }
  return output;
}

module.exports = {
  renderSettlementStatementPdf,
  normalizeSettlementDocument,
  RENDERER_VERSIONS,
  PDFKIT_VERSION,
};
