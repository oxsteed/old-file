import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './ReconciliationWorkspace.css';

const DATE_WINDOW_DAYS = 3;
const AMOUNT_TOLERANCE_CENTS = 1;

function storageKey(userId, documentKey) {
  return `oxs:recon:${userId || 'anon'}:${documentKey || 'default'}`;
}

// Minimal CSV parser: handles quoted fields and commas inside quotes.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);
  return rows;
}

function parseAmountCents(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, '');
  if (!/^[-+]?(\d+(\.\d{1,2})?|\.\d{1,2})$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function parseDate(raw) {
  if (!raw) return null;
  const time = Date.parse(String(raw).trim());
  return Number.isNaN(time) ? null : new Date(time);
}

function daysBetween(a, b) {
  return Math.abs(a - b) / 86400000;
}

// Suggestions only, never auto-confirm: exact-ish amount within a date window.
function suggestMatches(bankRows, lines, confirmed, rejected) {
  const usedLines = new Set(Object.values(confirmed));
  const suggestions = [];
  for (const bank of bankRows) {
    if (confirmed[bank.rowId] || bank.date === null || bank.amountCents === null) continue;
    let best = null;
    for (const line of lines) {
      if (usedLines.has(line.id)) continue;
      const lineDate = parseDate(line.date);
      if (lineDate === null) continue;
      const amountDiff = Math.abs(Number(line.amountCents) - bank.amountCents);
      const dateDiff = daysBetween(lineDate.getTime(), bank.date.getTime());
      if (amountDiff <= AMOUNT_TOLERANCE_CENTS && dateDiff <= DATE_WINDOW_DAYS) {
        const score = amountDiff * 1000 + dateDiff;
        if (!best || score < best.score) best = { bankRowId: bank.rowId, lineId: line.id, score, dateDiff };
      }
    }
    if (best && !rejected.has(`${best.bankRowId}:${best.lineId}`)) suggestions.push(best);
  }
  return suggestions;
}

function formatMoney(cents, language, currencyCode = 'USD') {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency: currencyCode }).format(cents / 100);
  } catch { return `${(cents / 100).toFixed(2)} ${currencyCode}`; }
}

// Bank/processor reconciliation workspace. The CSV is parsed in the browser
// and never uploaded; matches persist in localStorage per user+document
// (no new table) as {confirmed: {bankRowId: lineId}, rejected: [keys]}.
export default function ReconciliationWorkspace({ userId, documentKey, statementLines = [], currencyCode = 'USD' }) {
  const { t, i18n } = useTranslation('credit');
  const text = (key, options) => t(`statements.reconciliation.${key}`, options);
  const language = (i18n.resolvedLanguage || 'en').split(/[-_]/)[0];
  const [bankRows, setBankRows] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [parseError, setParseError] = useState(false);
  const [confirmed, setConfirmed] = useState({});
  const [rejected, setRejected] = useState(() => new Set());
  const [manualLine, setManualLine] = useState({});

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(userId, documentKey)) || 'null');
      if (saved && typeof saved === 'object') {
        if (saved.confirmed && typeof saved.confirmed === 'object') setConfirmed(saved.confirmed);
        if (Array.isArray(saved.rejected)) setRejected(new Set(saved.rejected));
      }
    } catch { /* corrupted state starts clean */ }
  }, [userId, documentKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId, documentKey),
        JSON.stringify({ confirmed, rejected: [...rejected], savedAt: new Date().toISOString() }));
    } catch { /* storage full or unavailable: matching still works in memory */ }
  }, [confirmed, rejected, userId, documentKey]);

  async function onFile(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setParseError(false);
    try {
      const raw = await selected.text();
      const rows = parseCsv(raw);
      if (!rows.length) { setParseError(true); return; }
      // Header detection: if the amount column of the first row is not a
      // number, treat the row as a header.
      const start = parseAmountCents(rows[0][1]) === null ? 1 : 0;
      const parsed = [];
      let skippedCount = 0;
      rows.slice(start).forEach((cells, index) => {
        const date = parseDate(cells[0]);
        const amountCents = parseAmountCents(cells[1]);
        if (date === null || amountCents === null) { skippedCount += 1; return; }
        parsed.push({
          rowId: `bank-${index}`,
          date, amountCents,
          description: (cells[2] || '').trim(),
          reference: (cells[3] || '').trim(),
        });
      });
      if (!parsed.length) { setParseError(true); return; }
      setBankRows(parsed);
      setSkipped(skippedCount);
      setConfirmed({});
      setRejected(new Set());
    } catch { setParseError(true); }
  }

  const suggestions = useMemo(
    () => suggestMatches(bankRows, statementLines, confirmed, rejected),
    [bankRows, statementLines, confirmed, rejected]);

  const matchedPairs = useMemo(() => Object.entries(confirmed)
    .map(([bankRowId, lineId]) => ({
      bank: bankRows.find(row => row.rowId === bankRowId),
      line: statementLines.find(line => String(line.id) === String(lineId)),
    })).filter(pair => pair.bank && pair.line), [confirmed, bankRows, statementLines]);

  const suggestedBankIds = new Set(suggestions.map(suggestion => suggestion.bankRowId));
  const unmatchedBank = bankRows.filter(row => !confirmed[row.rowId] && !suggestedBankIds.has(row.rowId));
  const usedLineIds = new Set([...Object.values(confirmed), ...suggestions.map(suggestion => suggestion.lineId)]);
  const unmatchedLines = statementLines.filter(line => !usedLineIds.has(String(line.id)) && !usedLineIds.has(line.id));

  function confirm(bankRowId, lineId) {
    setConfirmed(previous => ({ ...previous, [bankRowId]: lineId }));
  }
  function reject(bankRowId, lineId) {
    setRejected(previous => new Set(previous).add(`${bankRowId}:${lineId}`));
  }
  function unmatch(bankRowId) {
    setConfirmed(previous => {
      const next = { ...previous };
      delete next[bankRowId];
      return next;
    });
  }

  const summary = text('summary', {
    matched: matchedPairs.length, bank: bankRows.length, lines: statementLines.length, suggested: suggestions.length,
  });

  return <section className="srw-workspace" aria-labelledby="reconciliation-heading">
    <h2 id="reconciliation-heading">{text('title')}</h2>
    <p className="srw-muted">{text('uploadHelp')}</p>
    <div className="srw-upload">
      <label className="srw-field">
        <span>{text('uploadLabel')}</span>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
      </label>
      {bankRows.length > 0 && <button type="button" onClick={() => { setBankRows([]); setConfirmed({}); setRejected(new Set()); }}>{text('replaceFile')}</button>}
      <button type="button" onClick={() => { setConfirmed({}); setRejected(new Set()); }} disabled={!Object.keys(confirmed).length && !rejected.size}>{text('clearAll')}</button>
    </div>
    {parseError && <p role="alert" className="srw-error">{text('parseError')}</p>}
    {bankRows.length > 0 && <p role="status" aria-live="polite" className="srw-summary">{summary}{skipped > 0 ? ` (${skipped} ${text('noRows')})` : ''}</p>}

    {bankRows.length > 0 && <>
      {matchedPairs.length > 0 && <section aria-label={text('matched')}>
        <h3>{text('matched')} ({matchedPairs.length})</h3>
        <ul className="srw-list">
          {matchedPairs.map(({ bank, line }) => <li key={bank.rowId} className="srw-pair">
            <span className="srw-badge srw-badge-confirmed">{text('confirmedBadge')}</span>
            <span>{bank.description || text('bankRow')} · {formatMoney(bank.amountCents, language, currencyCode)}</span>
            <span aria-hidden="true">→</span>
            <span>{line.description} · {formatMoney(Number(line.amountCents), language, currencyCode)}</span>
            <button type="button" onClick={() => unmatch(bank.rowId)}>{text('unmatch')}</button>
          </li>)}
        </ul>
      </section>}

      <section aria-label={text('suggested')}>
        <h3>{text('suggested')} ({suggestions.length})</h3>
        {suggestions.length === 0
          ? <p className="srw-muted">{text('emptySuggestions')}</p>
          : <ul className="srw-list">
            {suggestions.map(suggestion => {
              const bank = bankRows.find(row => row.rowId === suggestion.bankRowId);
              const line = statementLines.find(item => String(item.id) === String(suggestion.lineId));
              if (!bank || !line) return null;
              return <li key={`${suggestion.bankRowId}:${suggestion.lineId}`} className="srw-pair">
                <span className="srw-badge">{text('suggestedBadge')}</span>
                <span>{bank.description || text('bankRow')} · {formatMoney(bank.amountCents, language, currencyCode)}</span>
                <span aria-hidden="true">→</span>
                <span>{line.description} · {formatMoney(Number(line.amountCents), language, currencyCode)}</span>
                <span className="srw-muted">{text('suggestedBy', { days: DATE_WINDOW_DAYS })}</span>
                <button type="button" onClick={() => confirm(suggestion.bankRowId, suggestion.lineId)}>{text('confirm')}</button>
                <button type="button" onClick={() => reject(suggestion.bankRowId, suggestion.lineId)}>{text('reject')}</button>
              </li>;
            })}
          </ul>}
      </section>

      <section aria-label={text('unmatchedBank')}>
        <h3>{text('unmatchedBank')} ({unmatchedBank.length})</h3>
        {unmatchedBank.length > 0 && <ul className="srw-list">
          {unmatchedBank.map(bank => <li key={bank.rowId} className="srw-pair">
            <span>{bank.description || text('bankRow')} · {formatMoney(bank.amountCents, language, currencyCode)}{bank.reference ? ` · ${bank.reference}` : ''}</span>
            <label><span className="srw-visually-hidden">{text('matchLine')}</span>
              <select value={manualLine[bank.rowId] || ''} onChange={event => setManualLine(previous => ({ ...previous, [bank.rowId]: event.target.value }))}>
                <option value="">{text('chooseLine')}</option>
                {unmatchedLines.map(line => <option key={line.id} value={line.id}>{line.description} · {formatMoney(Number(line.amountCents), language, currencyCode)}</option>)}
              </select>
            </label>
            <button type="button" disabled={!manualLine[bank.rowId]} onClick={() => confirm(bank.rowId, manualLine[bank.rowId])}>{text('confirm')}</button>
          </li>)}
        </ul>}
      </section>

      <section aria-label={text('unmatchedStatement')}>
        <h3>{text('unmatchedStatement')} ({unmatchedLines.length})</h3>
        {unmatchedLines.length > 0 && <ul className="srw-list">
          {unmatchedLines.map(line => <li key={line.id} className="srw-line">
            <span>{line.description} · {formatMoney(Number(line.amountCents), language, currencyCode)}</span>
          </li>)}
        </ul>}
      </section>
    </>}
  </section>;
}
