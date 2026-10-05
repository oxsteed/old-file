'use strict';

// Workstream 7: accessible PDFs + inclusive interfaces.
// - Tagged-PDF structure and metadata (automated checks on the info dict and
//   marked-content operators, not visual inspection).
// - Text extraction fidelity: totals and every row amount, incl. RTL.
// - Accessible HTML: semantic table, heading order, lang/dir.
// - Unsupported-script path: loud failure with an explicit notice, never tofu.
// - Rendition artifact recording (disposable DB only): kind='rendition', the
//   issued original untouched.

const zlib = require('zlib');
const crypto = require('crypto');

jest.unmock('pg');

const {
  renderStatementPdf, renderStatementCsv, amount, glyphFallbackNotice, RENDERER_VERSIONS,
} = require('../services/creditStatementPdf');
const { renderStatementHtml } = require('../services/statementHtmlRenderer');

function fixture(overrides = {}) {
  return {
    id: 'STMT-2026-09-A11Y', kind: 'monthly', product: 'oxsteed', ownerName: 'Emile Jean Philippe',
    accountLabel: 'OxSteed Credit', accountReference: 'OC-****-1042', currencyCode: 'USD',
    period: { from: '2026-09-01', to: '2026-09-30' }, generatedAt: '2026-10-01T12:00:00Z',
    openingBalanceCents: 10000, closingBalanceCents: 10800, totalCreditsCents: 1500, totalDebitsCents: 700,
    transactionCount: 3,
    transactions: [
      { id: 'TX-LOAD-1', date: '2026-09-01T00:00:00Z', type: 'load', description: 'Credit added', debitCents: 0, creditCents: 1000, balanceAfterCents: 11000 },
      { id: 'TX-ORDER-2', date: '2026-09-12T15:45:00Z', type: 'purchase', description: 'Lunch at Café Délice', debitCents: 700, creditCents: 0, balanceAfterCents: 10300 },
      { id: 'TX-REFUND-3', date: '2026-09-30T23:59:59Z', type: 'refund', description: 'Order refund', debitCents: 0, creditCents: 500, balanceAfterCents: 10800 },
    ],
    holds: [], holdsAsOf: null, totalHeldCents: 0, contentHash: 'b'.repeat(64),
    ...overrides,
  };
}

async function extractText(pdf) {
  const PDFParser = require('pdf2json');
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on('pdfParser_dataError', (error) => reject(error.parserError || error));
    parser.on('pdfParser_dataReady', (data) => {
      let text = '';
      for (const page of data.Pages || []) {
        for (const item of page.Texts || []) {
          for (const run of item.R || []) text += `${decodeURIComponent(run.T)} `;
        }
        text += '\n';
      }
      resolve({ text, pages: (data.Pages || []).length });
    });
    // pdf2json re-slices via pdfBuffer.buffer from offset 0 whenever the
    // Buffer is a pooled slice, corrupting xref offsets. Hand it a copy over
    // an exactly-sized ArrayBuffer so its length check passes through.
    const exact = new ArrayBuffer(pdf.length);
    new Uint8Array(exact).set(pdf);
    parser.parseBuffer(Buffer.from(exact));
  });
}

function inflatedStreams(pdf) {
  const raw = pdf.toString('latin1');
  const out = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      out.push(zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'));
    } catch { /* non-deflated stream */ }
  }
  return out;
}

describe('accessible tagged PDF', () => {
  test('extracted text contains the exact totals and every row amount', async () => {
    const statement = fixture();
    const pdf = await renderStatementPdf(statement, { language: 'en' });
    const { text } = await extractText(pdf);
    for (const minor of [statement.openingBalanceCents, statement.closingBalanceCents,
      statement.totalCreditsCents, statement.totalDebitsCents]) {
      expect(text).toContain(amount(minor, statement.currencyCode, 'en'));
    }
    for (const entry of statement.transactions) {
      expect(text).toContain(entry.id);
      for (const minor of [entry.debitCents, entry.creditCents, entry.balanceAfterCents]) {
        if (minor) expect(text).toContain(amount(minor, statement.currencyCode, 'en'));
      }
    }
  });

  test('large, negative, zero-precision and 3-decimal amounts survive extraction', async () => {
    const statement = fixture({
      currencyCode: 'KWD',
      openingBalanceCents: 123456, closingBalanceCents: -5000,
      totalCreditsCents: 0, totalDebitsCents: 128456,
      transactionCount: 1,
      transactions: [
        { id: 'TX-NEG-1', date: '2026-09-03T00:00:00Z', type: 'fee', description: 'Fee overdraw', debitCents: 128456, creditCents: 0, balanceAfterCents: -5000 },
      ],
    });
    const pdf = await renderStatementPdf(statement, { language: 'en' });
    const { text } = await extractText(pdf);
    expect(text).toContain(amount(123456, 'KWD', 'en'));
    expect(text).toContain(amount(-5000, 'KWD', 'en'));
    expect(text).toContain(amount(128456, 'KWD', 'en'));
    // Zero-precision currency keeps every minor unit with no fraction.
    const jpy = fixture({ currencyCode: 'JPY' });
    const jpyPdf = await renderStatementPdf(jpy, { language: 'en' });
    const jpyText = (await extractText(jpyPdf)).text;
    expect(jpyText).toContain(amount(10800, 'JPY', 'en'));
    expect(amount(10800, 'JPY', 'en')).not.toContain('.');
  });

  test('document language, title metadata and structure tags are present', async () => {
    const pdf = await renderStatementPdf(fixture(), { language: 'en' });
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/MarkInfo');
    expect(raw).toContain('/Marked true');
    expect(raw).toContain('/StructTreeRoot');
    for (const tag of ['/S /Table', '/S /TR', '/S /TH', '/S /TD', '/S /H1', '/S /H2',
      '/S /P', '/S /L', '/S /LI', '/S /Lbl', '/S /LBody', '/S /Link', '/S /Span']) {
      expect(raw).toContain(tag);
    }
    // Info dict (Title) and catalog (Lang) declare the document language.
    expect(raw).toContain('(Account statement - OxSteed Credit)');
    expect(raw).toContain('/Lang (en)');
    // Marked content: BDC/EMC sequences exist and repeated page furniture is
    // an artifact, not content.
    const streams = inflatedStreams(pdf);
    expect(streams.length).toBeGreaterThan(0);
    expect(streams.some((stream) => /\/Artifact/.test(stream))).toBe(true);
    expect(streams.some((stream) => /\bBDC\b/.test(stream) && /\bEMC\b/.test(stream))).toBe(true);
    // The support address is a real link annotation, not painted text.
    expect(raw).toContain('/Annots');
    expect(raw).toContain('/URI (mailto:support@oxsteed.com)');
  });

  test('Arabic rendition extracts amounts with correct digits and declares its language', async () => {
    const statement = fixture({
      ownerName: 'إميل جان فيليب',
      accountLabel: 'ائتمان OxSteed',
      transactions: fixture().transactions.map((entry) => ({ ...entry, description: 'شراء وجبة' })),
    });
    const pdf = await renderStatementPdf(statement, { language: 'ar' });
    const { text } = await extractText(pdf);
    for (const minor of [statement.openingBalanceCents, statement.closingBalanceCents,
      statement.totalCreditsCents, statement.totalDebitsCents]) {
      expect(text).toContain(amount(minor, statement.currencyCode, 'ar'));
    }
    for (const entry of statement.transactions) {
      expect(text).toContain(entry.id);
      expect(text).toContain(amount(entry.balanceAfterCents, statement.currencyCode, 'ar'));
    }
    // Info dict and catalog declare Arabic.
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/Lang (ar)');
  });

  test('multi-page statements repeat TH header rows inside one table structure', async () => {
    let balance = 10000;
    const transactions = Array.from({ length: 120 }, (_, i) => ({
      id: `TX-${i}`, date: '2026-09-15T12:00:00Z', type: 'purchase',
      description: 'Row', debitCents: 1, creditCents: 0, balanceAfterCents: --balance,
    }));
    const pdf = await renderStatementPdf(fixture({
      transactions, transactionCount: 120, totalCreditsCents: 0, totalDebitsCents: 120, closingBalanceCents: balance,
    }));
    const raw = pdf.toString('latin1');
    const pages = raw.match(/\/Type \/Page\b/g) || [];
    expect(pages.length).toBeGreaterThan(1);
    // Exactly one Table element. Header rows repeat once per table page: each
    // table page contributes one TR header row and five TH cells.
    expect(raw.match(/\/S \/Table\b/g).length).toBe(1);
    const headerRows = (raw.match(/\/S \/TR\b/g) || []).length - transactions.length;
    expect(headerRows).toBeGreaterThan(1);
    expect((raw.match(/\/S \/TH\b/g) || []).length).toBe(headerRows * 5);
    const { text } = await extractText(pdf);
    for (const entry of transactions) expect(text).toContain(entry.id);
  });
});

describe('accessible HTML rendition', () => {
  test('semantic table with caption, scoped headers and logical heading order', () => {
    const html = renderStatementHtml(fixture(), { language: 'en' });
    expect(html).toContain('<table>');
    expect(html).toContain('<caption>');
    expect(html.match(/<th scope="col">/g).length).toBe(5);
    expect(html.search(/<h1[ >]/)).toBeLessThan(html.search(/<h2[ >]/));
    expect(html).toContain('mailto:support@oxsteed.com');
    expect(html).toContain('<html lang="en" dir="ltr">');
    // Same accounting facts as the PDF/CSV path.
    const statement = fixture();
    expect(html).toContain(amount(statement.closingBalanceCents, statement.currencyCode, 'en'));
    expect(html).toContain(amount(statement.totalCreditsCents, statement.currencyCode, 'en'));
    for (const entry of statement.transactions) expect(html).toContain(entry.id);
  });

  test('Arabic HTML is RTL with an isolated bidi context for Latin references', () => {
    const html = renderStatementHtml(fixture(), { language: 'ar' });
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('<bdi>TX-LOAD-1</bdi>');
    expect(html).toContain(amount(10800, 'USD', 'ar'));
  });

  test('user content is escaped, never injected', () => {
    const html = renderStatementHtml(fixture({
      ownerName: '<script>alert(1)</script>',
      transactions: fixture().transactions.map((entry) => ({ ...entry, description: '<img src=x onerror=alert(2)>' })),
    }), { language: 'en' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img src=x');
  });
});

describe('unsupported-script path', () => {
  test('PDF fails loudly with statement_unsupported_glyph, never tofu', async () => {
    await expect(renderStatementPdf(fixture({ ownerName: '测试' })))
      .rejects.toMatchObject({ code: 'statement_unsupported_glyph' });
  });

  test('the fallback notice names the HTML/CSV recovery path in all five languages', () => {
    const notices = ['en', 'es', 'fr', 'ht', 'ar'].map((language) => glyphFallbackNotice(language));
    for (const notice of notices) {
      expect(notice.code).toBe('statement_unsupported_glyph');
      expect(notice.recovery).toEqual(['html', 'csv']);
      expect(notice.notice.length).toBeGreaterThan(20);
    }
    expect(new Set(notices.map((notice) => notice.notice)).size).toBe(5);
  });

  test('HTML and CSV are the recovery path: they never reject on unshaped scripts', () => {
    const statement = fixture({ ownerName: '测试' });
    expect(() => renderStatementHtml(statement, { language: 'en' })).not.toThrow();
    expect(renderStatementHtml(statement)).toContain('测试');
    expect(() => renderStatementCsv(statement, { language: 'en' })).not.toThrow();
  });
});

describe('rendition artifact recording', () => {
  const DISPOSABLE_PATTERN = (() => {
    const raw = process.env.STATEMENT_TEST_DATABASE_URL
      || 'postgresql://postgres:postgres@127.0.0.1:5432/credit_statement_test?sslmode=disable';
    let url;
    try { url = new URL(raw); } catch { throw new Error('Requires a disposable localhost credit_statement_test database'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.pathname !== '/credit_statement_test'
      || [...url.searchParams].some(([key, value]) => key !== 'sslmode' || value !== 'disable')) {
      throw new Error('Requires a disposable localhost credit_statement_test database; connection overrides are forbidden');
    }
    return raw;
  })();

  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/credit_statement_test?sslmode=disable';

  const fs = require('fs');
  const path = require('path');
  const pool = require('../db');
  const renditions = require('../routes/statementRenditions');

  const ownerId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const originalId = crypto.randomUUID();
  const documentId = crypto.randomUUID();

  beforeAll(async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '684_statement_artifacts.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'synthetic-unusable-hash', 'A11y', 'Fixture', 'customer', TRUE, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [ownerId, `${ownerId}@example.invalid`]);
    await pool.query(
      `INSERT INTO credit_statement_documents
        (id, customer_id, product, account_id, currency_code, period_from, period_to, generated_at, document, content_hash)
       VALUES ($1,$2,'oxsteed',4242,'USD','2026-09-01','2026-09-30', transaction_timestamp(), '{}', $3)
       ON CONFLICT DO NOTHING`,
      [documentId, ownerId, 'c'.repeat(64)]);
    await pool.query(
      `INSERT INTO statement_snapshots
        (id, issuance_key, product, account_id, currency_code, period_from, period_to, cutoff_at,
         schema_version, row_count, total_credits_minor, total_debits_minor, opening_minor,
         closing_minor, source_hash, chunk_count, created_at)
       VALUES ($1, $2, 'oxsteed', 4242, 'USD', '2026-09-01', '2026-09-30', transaction_timestamp(),
         1, 3, 1500, 700, 10000, 10800, $3, 1, transaction_timestamp())
       ON CONFLICT (issuance_key) DO NOTHING`,
      [snapshotId, `stmt:v1:oxsteed:4242:USD:2026-09-01:2026-09-30:${ownerId}`, 'd'.repeat(64)]);
    await pool.query(
      `INSERT INTO statement_artifacts
        (id, snapshot_id, document_id, kind, language, renderer_version, template_version,
         font_version, byte_length, sha256, media_type, object_key, state, created_at)
       VALUES ($1,$2,$3,'original','en','creditStatementPdf/1','statement-template/1','statement-fonts/1',
         1234, $4, 'application/pdf', $5, 'ready', transaction_timestamp())
       ON CONFLICT (id) DO NOTHING`,
      [originalId, snapshotId, documentId, 'e'.repeat(64), `stmt/${crypto.randomUUID()}.pdf`]);
  }, 120000);

  afterAll(async () => { await pool.end(); });

  test('rendition is recorded as kind=rendition with honest versions; the original is untouched', async () => {
    const before = (await pool.query('SELECT * FROM statement_artifacts WHERE id = $1', [originalId])).rows[0];
    const pdf = await renderStatementPdf(fixture(), { language: 'ar' });
    const row = await renditions.recordRendition({
      snapshotId, documentId, language: 'ar', mediaType: 'application/pdf', bytes: pdf,
    });
    expect(row.kind).toBe('rendition');
    expect(row.language).toBe('ar');
    expect(row.document_id).toBe(documentId);
    expect(row.snapshot_id).toBe(snapshotId);
    expect(row.media_type).toBe('application/pdf');
    expect(Number(row.byte_length)).toBe(pdf.length);
    expect(row.sha256).toBe(crypto.createHash('sha256').update(pdf).digest('hex'));
    // Honest versions: the real PDFKit version, the real template/font labels.
    expect(row.renderer_version).toBe(RENDERER_VERSIONS.pdf.rendererVersion);
    expect(row.renderer_version).toMatch(/^pdfkit\/\d+\.\d+\.\d+\+tagged$/);
    expect(row.template_version).toBe('statement-accessible-template/1');
    expect(row.font_version).toBe('noto-sans-ffebf8c1');
    // No PII in the object key: opaque uuid path only.
    expect(row.object_key).toMatch(/^stmt\/renditions\/accessible\/[0-9a-f-]{36}\.pdf$/);
    expect(row.object_key).not.toContain('Emile');
    // The issued original is untouched.
    const after = (await pool.query('SELECT * FROM statement_artifacts WHERE id = $1', [originalId])).rows[0];
    expect(after).toEqual(before);

    // Identical bytes de-duplicate to the same row; new bytes get a new row.
    const same = await renditions.recordRendition({
      snapshotId, documentId, language: 'ar', mediaType: 'application/pdf', bytes: pdf,
    });
    expect(same.id).toBe(row.id);
    const html = Buffer.from(renderStatementHtml(fixture(), { language: 'ar' }), 'utf8');
    const htmlRow = await renditions.recordRendition({
      snapshotId, documentId, language: 'ar', mediaType: 'text/html; charset=utf-8', bytes: html,
    });
    expect(htmlRow.id).not.toBe(row.id);
    expect(htmlRow.kind).toBe('rendition');
    expect(htmlRow.renderer_version).toBe(RENDERER_VERSIONS.html.rendererVersion);
    expect(htmlRow.object_key).toMatch(/\.html$/);
  });

  test('resolveSnapshotId links the rendition to the original snapshot', async () => {
    const resolved = await renditions.resolveSnapshotId({
      id: documentId, product: 'oxsteed', account_id: 4242,
      currency_code: 'USD', period_from: '2026-09-01', period_to: '2026-09-30', customer_id: ownerId,
    });
    expect(resolved).toBe(snapshotId);
  });
});
