'use strict';

// Accessible HTML statement renderer: the equivalent-access option alongside
// the tagged PDF. A standalone, self-contained document (inline styles only,
// no external resources) with a semantic table (caption, th scope="col"),
// lang/dir attributes per language (dir="rtl" for Arabic), a heading
// hierarchy, a skip link, and a real mailto link for support.
//
// HTML is Unicode-native: unlike the PDF renderer, which fails loudly on
// glyphs the embedded fonts cannot shape, this renderer never emits tofu
// boxes. It is the recovery path named by glyphFallbackNotice().
//
// Accounting facts come from the same normalize()/amount()/decimal()/utcDate()
// helpers as the PDF and CSV renderers, so the numbers are identical in every
// format.

const { normalize, languageCopy, amount, decimal, utcDate, text, amendmentMoneyKeys } = require('./creditStatementPdf');
const { normalizeSettlementDocument } = require('./settlementStatementPdf');

const SUPPORT_EMAIL = 'support@oxsteed.com';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

// Latin identifiers inside RTL prose get an isolated bidi context so mixed
// Arabic/Latin references, amounts and dates extract in the right order.
function bdi(value) {
  return `<bdi>${escapeHtml(text(value))}</bdi>`;
}

// One definition shared by the banner and both renderers: the label is
// escaped, the value is already-escaped HTML.
function fieldRow(label, valueHtml) {
  return `      <div class="field"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
}

// Amended versions are labeled as such in every rendition: revision, type,
// reason, decision date, supersedes link, and the original/adjustment/revised
// totals. Shared by the credit and settlement HTML renderers.
function amendmentBannerHtml({ l, lang, amendment, product, currencyCode }) {
  const money = (minor) => `${escapeHtml(amount(Number(minor), currencyCode, lang))} ${escapeHtml(currencyCode)}`;
  const groups = amendment.totals && typeof amendment.totals === 'object'
    ? [['originalTotals', amendment.totals.original], ['adjustmentTotals', amendment.totals.adjustment], ['revisedTotals', amendment.totals.revised]]
    : [];
  const groupHtml = groups
    .filter(([, group]) => group && typeof group === 'object')
    .map(([groupKey, group]) => {
      const rows = amendmentMoneyKeys(product)
        .filter(([moneyKey]) => group[moneyKey] !== undefined && group[moneyKey] !== null)
        .map(([moneyKey, labelKey]) => fieldRow(l[labelKey] || labelKey, money(group[moneyKey])));
      const compensating = Array.isArray(group.compensatingTransactions) ? group.compensatingTransactions : [];
      const compRows = compensating.map((tx) => `      <tr>
        <td>${bdi(tx.id)}</td>
        <td class="num">${escapeHtml(amount(Number(tx.amountCents), currencyCode, lang))}</td>
        <td>${escapeHtml(`${tx.direction}${tx.effectiveDate ? ` - ${tx.effectiveDate}` : ''}`)}</td>
      </tr>`).join('\n');
      const compTable = compRows ? `
<table>
<caption>${escapeHtml(l.adjustmentTotals)}</caption>
<thead><tr><th scope="col">${escapeHtml(l.reference)}</th><th scope="col">${escapeHtml(l.amountCol)}</th><th scope="col">${escapeHtml(l.jobStatus)}</th></tr></thead>
<tbody>${compRows}</tbody>
</table>` : '';
      return `      <h3>${escapeHtml(l[groupKey])}</h3>
      <dl class="fields">
${rows.join('\n')}
      </dl>${compTable}`;
    }).join('\n');
  const presentation = amendment.presentation === 'later_period' ? l.laterPeriod : l[amendment.presentation] || amendment.presentation;
  return `<section aria-labelledby="amendment-heading" class="amendment">
      <h2 id="amendment-heading">${escapeHtml(l.amendedStatement)}${amendment.revision ? ` &ndash; ${escapeHtml(l.revision)} ${escapeHtml(String(amendment.revision))}` : ''}</h2>
      <dl class="fields">
${fieldRow(l.amendmentTypeLabel, escapeHtml(l[amendment.type] || amendment.type))}
${fieldRow(l.presentationLabel, escapeHtml(presentation))}
${fieldRow(l.reasonLabel, escapeHtml(amendment.reason))}
${amendment.decidedAt ? `${fieldRow(l.decidedAtLabel, escapeHtml(utcDate(amendment.decidedAt, lang, true)))}\n` : ''}${fieldRow(l.supersedesLabel, escapeHtml(amendment.supersedesKind === 'original' ? l.monthly : `${l.revision} ${amendment.supersedesRevision || ''}`.trim()))}
      </dl>
${groupHtml}
    </section>`;
}

function renderStatementHtml(statement, { language = 'en' } = {}) {
  const s = normalize(statement);
  const { lang, labels: l } = languageCopy(language);
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const title = `${l.title} - ${l[s.product]}`;
  const money = (minor) => `${escapeHtml(amount(minor, s.currencyCode, lang))} ${escapeHtml(s.currencyCode)}`;
  const moneyPlain = (minor) => `${amount(minor, s.currencyCode, lang)} ${s.currencyCode}`;


  const transactionRows = s.transactions.map((entry) => {
    const activity = `${escapeHtml(l[entry.type])}${entry.description ? ` &ndash; ${escapeHtml(entry.description)}` : ''}<br><span class="ref">${escapeHtml(l.reference)}: ${bdi(entry.id)}</span>`;
    return `      <tr>
        <td>${escapeHtml(utcDate(entry.date, lang))}</td>
        <td>${activity}</td>
        <td class="num">${entry.debitCents ? escapeHtml(amount(entry.debitCents, s.currencyCode, lang)) : '&ndash;'}</td>
        <td class="num">${entry.creditCents ? escapeHtml(amount(entry.creditCents, s.currencyCode, lang)) : '&ndash;'}</td>
        <td class="num"><strong>${escapeHtml(amount(entry.balanceAfterCents, s.currencyCode, lang))}</strong></td>
      </tr>`;
  }).join('\n');

  const holdsSection = s.kind === 'interim' && s.holdsAsOf ? `
    <section aria-labelledby="holds-heading">
      <h2 id="holds-heading">${escapeHtml(l.holds)}</h2>
      <dl class="fields">
${fieldRow(l.generated, escapeHtml(utcDate(s.holdsAsOf, lang, true)))}
${fieldRow(l.holds, escapeHtml(moneyPlain(s.totalHeldCents)))}
      </dl>
      <p class="note">${escapeHtml(l.holdsNote)}</p>
${s.holds.map((hold) => `      <dl class="fields hold">
${fieldRow(l.reference, bdi(hold.id))}
${hold.description ? `${fieldRow(l.activity, escapeHtml(hold.description))}\n` : ''}${fieldRow(l.holds, escapeHtml(moneyPlain(hold.amountCents)))}
      </dl>`).join('\n')}
    </section>` : '';

  const supportHtml = (() => {
    const parts = String(l.support).split(SUPPORT_EMAIL);
    if (parts.length < 2) return `<p class="note">${escapeHtml(l.support)}</p>`;
    return `<p class="note">${escapeHtml(parts[0])}<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>${escapeHtml(parts.slice(1).join(SUPPORT_EMAIL))}</p>`;
  })();

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: light dark;
  --ink: #172534;
  --muted: #536475;
  --accent: #b74712;
  --line: #dce2e8;
  --pale: #f3f6f8;
  --card: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8eef3;
    --muted: #9fb0bf;
    --accent: #e08a4e;
    --line: #33414f;
    --pale: #1b2530;
    --card: #121a23;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, "Segoe UI", Tahoma, Arial, sans-serif;
  color: var(--ink);
  background: var(--card);
  line-height: 1.6;
  padding: 0 1rem 3rem;
}
.skip {
  position: absolute;
  inset-inline-start: 1rem;
  top: -4rem;
  background: var(--ink);
  color: var(--card);
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  z-index: 10;
  transition: top 0.15s ease;
}
.skip:focus { top: 0.5rem; color: var(--card); }
@media (prefers-reduced-motion: reduce) {
  .skip { transition: none; }
  * { animation: none !important; }
}
.wrap { max-width: 56rem; margin: 0 auto; }
header.doc { border-top: 6px solid var(--accent); padding-top: 1.25rem; }
.brand { font-size: 1.4rem; font-weight: 700; margin: 0; }
.product { color: var(--muted); margin: 0.25rem 0 0; }
h1 { font-size: 1.6rem; margin: 0.75rem 0 0.25rem; }
.kind { color: var(--accent); font-weight: 700; margin: 0; }
.period { margin: 0.25rem 0 0; }
h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; }
.fields { margin: 0; }
.field {
  display: grid;
  grid-template-columns: minmax(9rem, 12rem) 1fr;
  gap: 0.25rem 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--line);
}
.field dt { color: var(--muted); font-size: 0.85rem; margin: 0; }
.field dd { margin: 0; overflow-wrap: anywhere; }
.table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 0.35rem; }
.table-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; min-width: 40rem; }
caption { text-align: start; font-weight: 700; padding: 0.75rem; }
thead th {
  background: var(--ink);
  color: var(--card);
  text-align: start;
  padding: 0.6rem 0.75rem;
  font-size: 0.85rem;
  white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
  thead th { background: #0d141c; }
}
tbody td { padding: 0.6rem 0.75rem; border-top: 1px solid var(--line); vertical-align: top; }
tbody tr:nth-child(even) td { background: var(--pale); }
td.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ref { color: var(--muted); font-size: 0.85rem; }
.note { color: var(--muted); }
code.digest { overflow-wrap: anywhere; font-size: 0.8rem; }
.end { text-align: center; font-weight: 700; margin-top: 2.5rem; }
.rendition { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media print {
  .skip { display: none; }
  body { padding: 0; }
  .table-scroll { overflow: visible; border: none; }
}
</style>
</head>
<body>
<a class="skip" href="#main">${escapeHtml(l.skipToContent)}</a>
<div class="wrap">
<header class="doc">
<p class="brand">OxSteed</p>
<p class="product">${escapeHtml(l[s.product])}</p>
<h1>${escapeHtml(l.title)}</h1>
<p class="kind">${escapeHtml(l[s.kind])}</p>
<p class="period">${escapeHtml(utcDate(s.period.from, lang))} &ndash; ${escapeHtml(utcDate(s.period.to, lang))} | UTC</p>
</header>
<main id="main">
${s.amendment ? `${amendmentBannerHtml({ l, lang, amendment: s.amendment, product: s.product, currencyCode: s.currencyCode })}\n` : ''}<section aria-labelledby="details-heading">
<h2 id="details-heading">${escapeHtml(l.details)}</h2>
<dl class="fields">
${fieldRow(l.owner, escapeHtml(s.ownerName))}
${fieldRow(l.account, escapeHtml(s.accountLabel))}
${fieldRow(l.reference, bdi(s.accountReference))}
${fieldRow(l.id, bdi(s.id))}
${fieldRow(l.generated, escapeHtml(utcDate(s.generatedAt, lang, true)))}
${fieldRow(l.currency, bdi(s.currencyCode))}
</dl>
</section>
<section aria-labelledby="summary-heading">
<h2 id="summary-heading">${escapeHtml(l.summary)}</h2>
<dl class="fields">
${fieldRow(l.opening, money(s.openingBalanceCents))}
${fieldRow(l.credits, money(s.totalCreditsCents))}
${fieldRow(l.debits, money(s.totalDebitsCents))}
${fieldRow(l.closing, `<strong>${money(s.closingBalanceCents)}</strong>`)}
</dl>
</section>
<section aria-labelledby="activity-heading">
<h2 id="activity-heading">${escapeHtml(l.activity)} (${escapeHtml(new Intl.NumberFormat(lang).format(s.transactionCount))})</h2>
${s.transactions.length ? `<div class="table-scroll" role="region" aria-label="${escapeHtml(l.activity)}" tabindex="0">
<table>
<caption>${escapeHtml(l.activity)} (${escapeHtml(new Intl.NumberFormat(lang).format(s.transactionCount))})</caption>
<thead>
<tr><th scope="col">${escapeHtml(l.date)}</th><th scope="col">${escapeHtml(l.activity)}</th><th scope="col">${escapeHtml(l.debit)}</th><th scope="col">${escapeHtml(l.credit)}</th><th scope="col">${escapeHtml(l.balance)}</th></tr>
</thead>
<tbody>
${transactionRows}
</tbody>
</table>
</div>` : `<p>${escapeHtml(l.noActivity)}</p>`}
</section>${holdsSection}
<div class="notes">
<p class="note">${escapeHtml(l.disclaimer)}</p>
${supportHtml}
<dl class="fields">
${fieldRow(l.digest, `<code class="digest">${bdi(s.contentHash)}</code>`)}
</dl>
<p class="end">${escapeHtml(l.end)}</p>
</div>
</main>
<footer class="rendition">
<p class="note">${escapeHtml(l.renditionNote)}</p>
</footer>
</div>
</body>
</html>
`;
}

// Accessible HTML rendition for the settlement products. Same document model
// as the settlement tagged PDF (normalizeSettlementDocument), so the numbers
// are identical in both formats. Amended versions are labeled as such.
function renderSettlementStatementHtml(document, { language = 'en' } = {}) {
  const s = normalizeSettlementDocument(document);
  const { lang, labels: l } = languageCopy(language);
  const rtl = lang === 'ar';
  const dir = rtl ? 'rtl' : 'ltr';
  const title = `${l.title} - ${l[s.product]}`;
  const money = (minor) => `${escapeHtml(amount(minor, s.currencyCode, lang))} ${escapeHtml(s.currencyCode)}`;
  const moneyPlain = (minor) => `${amount(minor, s.currencyCode, lang)} ${s.currencyCode}`;
  const OUTCOME_LABELS = { verified: 'verified', in_transit: 'inTransit', failed: 'failedPayout', never_executed: 'neverExecuted' };


  function formatCell(column, row) {
    const value = row[column.key];
    if (value === null || value === undefined || value === '-') return '&ndash;';
    if (column.key === 'activity') {
      const parts = [escapeHtml(l[row.type] || l.other)];
      if (row.description) parts.push(escapeHtml(text(row.description, 280)));
      if (row.referenceId) parts.push(`<br><span class="ref">${escapeHtml(l.reference)}: ${escapeHtml(text(row.referenceType || '', 64))}:${bdi(row.referenceId)}</span>`);
      return parts.join(' &ndash; ');
    }
    if (['date', 'created', 'completed', 'paid', 'issued'].includes(column.key)) {
      return escapeHtml(utcDate(String(value).slice(0, 10), lang));
    }
    if (typeof value === 'number' && column.numeric) {
      return `<strong>${escapeHtml(amount(value, s.currencyCode, lang))}</strong>`;
    }
    if (column.key === 'outcome') return escapeHtml(l[OUTCOME_LABELS[value]] || String(value));
    if (column.key === 'status' && row.payoutVerified) return escapeHtml(l.verified);
    if (column.key === 'status' && row.payoutStatus) return escapeHtml(l[row.payoutStatus] || String(value));
    return escapeHtml(String(value));
  }

  const sectionHtml = s.sections.map((sec, secIndex) => {
    const heading = sec.titleSuffix ? `${l[sec.titleKey]} - ${escapeHtml(sec.titleSuffix)}` : escapeHtml(l[sec.titleKey]);
    const listHtml = Array.isArray(sec.list) && sec.list.length ? `
      <dl class="fields">
${sec.list.map((item) => fieldRow(l[item.labelKey] || item.labelKey, money(item.minor))).join('\n')}
      </dl>` : '';
    let tableHtml = '';
    if (sec.columns && sec.rows) {
      if (sec.rows.length) {
        const head = sec.columns.map((c) => `<th scope="col">${escapeHtml(l[c.labelKey] || c.labelKey)}</th>`).join('');
        const body = sec.rows.map((row) => `      <tr>${sec.columns.map((c) => `<td${c.numeric ? ' class="num"' : ''}>${formatCell(c, row)}</td>`).join('')}</tr>`).join('\n');
        tableHtml = `
      <div class="table-scroll" role="region" aria-label="${heading}" tabindex="0">
      <table>
      <caption>${heading}</caption>
      <thead><tr>${head}</tr></thead>
      <tbody>
${body}
      </tbody>
      </table>
      </div>`;
      } else if (sec.emptyKey) {
        tableHtml = `<p>${escapeHtml(l[sec.emptyKey])}</p>`;
      }
    }
    return `    <section aria-labelledby="section-${secIndex}">
      <h2 id="section-${secIndex}">${heading}</h2>${listHtml}${tableHtml}
    </section>`;
  }).join('\n');

  const supportHtml = (() => {
    const parts = String(l.support).split(SUPPORT_EMAIL);
    if (parts.length < 2) return `<p class="note">${escapeHtml(l.support)}</p>`;
    return `<p class="note">${escapeHtml(parts[0])}<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>${escapeHtml(parts.slice(1).join(SUPPORT_EMAIL))}</p>`;
  })();

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: light dark;
  --ink: #172534;
  --muted: #536475;
  --accent: #b74712;
  --line: #dce2e8;
  --pale: #f3f6f8;
  --card: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8eef3;
    --muted: #9fb0bf;
    --accent: #e08a4e;
    --line: #33414f;
    --pale: #1b2530;
    --card: #121a23;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, "Segoe UI", Tahoma, Arial, sans-serif;
  color: var(--ink);
  background: var(--card);
  line-height: 1.6;
  padding: 0 1rem 3rem;
}
.skip {
  position: absolute;
  inset-inline-start: 1rem;
  top: -4rem;
  background: var(--ink);
  color: var(--card);
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  z-index: 10;
  transition: top 0.15s ease;
}
.skip:focus { top: 0.5rem; color: var(--card); }
@media (prefers-reduced-motion: reduce) {
  .skip { transition: none; }
  * { animation: none !important; }
}
.wrap { max-width: 56rem; margin: 0 auto; }
header.doc { border-top: 6px solid var(--accent); padding-top: 1.25rem; }
.brand { font-size: 1.4rem; font-weight: 700; margin: 0; }
.product { color: var(--muted); margin: 0.25rem 0 0; }
h1 { font-size: 1.6rem; margin: 0.75rem 0 0.25rem; }
.kind { color: var(--accent); font-weight: 700; margin: 0; }
.amended-kind { color: var(--accent); font-weight: 700; margin: 0.25rem 0 0; }
.period { margin: 0.25rem 0 0; }
h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; }
h3 { font-size: 1rem; margin: 1.5rem 0 0.5rem; }
.fields { margin: 0; }
.field {
  display: grid;
  grid-template-columns: minmax(9rem, 12rem) 1fr;
  gap: 0.25rem 1rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--line);
}
.field dt { color: var(--muted); font-size: 0.85rem; margin: 0; }
.field dd { margin: 0; overflow-wrap: anywhere; }
.table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 0.35rem; }
.table-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
table { border-collapse: collapse; width: 100%; min-width: 40rem; }
caption { text-align: start; font-weight: 700; padding: 0.75rem; }
thead th {
  background: var(--ink);
  color: var(--card);
  text-align: start;
  padding: 0.6rem 0.75rem;
  font-size: 0.85rem;
  white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
  thead th { background: #0d141c; }
}
tbody td { padding: 0.6rem 0.75rem; border-top: 1px solid var(--line); vertical-align: top; }
tbody tr:nth-child(even) td { background: var(--pale); }
td.num { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ref { color: var(--muted); font-size: 0.85rem; }
.note { color: var(--muted); }
code.digest { overflow-wrap: anywhere; font-size: 0.8rem; }
.end { text-align: center; font-weight: 700; margin-top: 2.5rem; }
.rendition { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); }
.amendment { border: 2px solid var(--accent); border-radius: 0.35rem; padding: 0 1rem 1rem; margin-top: 1.5rem; }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media print {
  .skip { display: none; }
  body { padding: 0; }
  .table-scroll { overflow: visible; border: none; }
}
</style>
</head>
<body>
<a class="skip" href="#main">${escapeHtml(l.skipToContent)}</a>
<div class="wrap">
<header class="doc">
<p class="brand">OxSteed</p>
<p class="product">${escapeHtml(l[s.product])}</p>
<h1>${escapeHtml(l.title)}</h1>
<p class="kind">${escapeHtml(l[s.kind])}</p>
${s.amendment ? `<p class="amended-kind">${escapeHtml(l.amendedStatement)} &ndash; ${escapeHtml(l.revision)} ${escapeHtml(String(s.amendment.revision || ''))}</p>` : ''}
<p class="period">${escapeHtml(utcDate(s.period.from, lang))} &ndash; ${escapeHtml(utcDate(s.period.to, lang))} | UTC</p>
</header>
<main id="main">
${s.amendment ? `${amendmentBannerHtml({ l, lang, amendment: s.amendment, product: s.product, currencyCode: s.currencyCode })}\n` : ''}<section aria-labelledby="details-heading">
<h2 id="details-heading">${escapeHtml(l.details)}</h2>
<dl class="fields">
${fieldRow(l.owner, escapeHtml(s.ownerName))}
${fieldRow(l.account, escapeHtml(s.accountLabel))}
${fieldRow(l.reference, bdi(s.accountReference))}
${fieldRow(l.id, bdi(s.id))}
${fieldRow(l.generated, escapeHtml(utcDate(s.generatedAt, lang, true)))}
${fieldRow(l.currency, bdi(s.currencyCode))}
</dl>
</section>
<section aria-labelledby="summary-heading">
<h2 id="summary-heading">${escapeHtml(l.summary)}</h2>
<dl class="fields">
${s.summary.map((item) => fieldRow(l[item.labelKey] || item.labelKey,
    /closing/i.test(item.labelKey) ? `<strong>${money(item.minor)}</strong>` : money(item.minor))).join('\n')}
</dl>
</section>
${sectionHtml}
<div class="notes">
${s.notes.map((noteKey) => `<p class="note">${escapeHtml(l[noteKey] || noteKey)}</p>`).join('\n')}
${supportHtml}
<dl class="fields">
${fieldRow(l.digest, `<code class="digest">${bdi(s.contentHash)}</code>`)}
</dl>
<p class="end">${escapeHtml(l.end)}</p>
</div>
</main>
<footer class="rendition">
<p class="note">${escapeHtml(l.renditionNote)}</p>
</footer>
</div>
</body>
</html>
`;
}

module.exports = { renderStatementHtml, renderSettlementStatementHtml };
