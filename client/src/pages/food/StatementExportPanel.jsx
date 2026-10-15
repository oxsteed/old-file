import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { previousStatementMonth, validStatementPeriod } from '../../api/creditStatements';
import { requestStatementExport, getStatementExport, cancelStatementExport, retryStatementExport, getStatementExportManifest, downloadStatementExportFile, requestBulkStatementExport, downloadBulkStatementPackage, downloadAccountingExport } from '../../api/statementExports';
import ExportHistory from '../../components/statements/ExportHistory';

const TERMINAL = new Set(['complete', 'failed', 'cancelled']);
const ACCOUNTING_FORMATS = new Set(['ofx', 'qfx', 'qbo']);
const BULK_FORMATS = ['csv', 'pdf'];
const BULK_MAX_ITEMS = 20;

function recentStatementPeriods(count = 6) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const month = index + 1;
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - month, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - month + 1, 0));
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
}

function filenameFromDisposition(response, fallback) {
  const header = response.headers?.['content-disposition'] || '';
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] || fallback;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function StatementExportPanel({ product, accounts = [] }) {
  const { t, i18n } = useTranslation('credit');
  const { jobId: routeJobId } = useParams();
  const [search, setSearch] = useSearchParams();
  const jobId = routeJobId || search.get('exportJob');
  const historyView = search.get('view') === 'history';
  const [period, setPeriod] = useState(previousStatementMonth);
  const [accountId, setAccountId] = useState('');
  const [currency, setCurrency] = useState('');
  const [format, setFormat] = useState('csv');
  const [job, setJob] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const requestKey = useRef(null);
  // Bulk download state.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAccounts, setBulkAccounts] = useState(() => new Set());
  const [bulkPeriods, setBulkPeriods] = useState(() => new Set([JSON.stringify(previousStatementMonth())]));
  const [bulkFormat, setBulkFormat] = useState('csv');
  const [bulkJobs, setBulkJobs] = useState([]);
  const [bulkError, setBulkError] = useState(false);
  const text = key => t(`statementCenter.${key}`);
  const bulkText = key => t(`statements.bulkExport.${key}`);
  const accountingText = key => t(`statements.accounting.${key}`);
  const language = (i18n.resolvedLanguage || 'en').split(/[-_]/)[0];
  const periods = recentStatementPeriods();

  useEffect(() => { setAccountId(''); setCurrency(''); requestKey.current = null; }, [product]);
  useEffect(() => {
    if (!jobId) { setJob(null); setManifest(null); return; }
    let active = true; let timer;
    const controller = new AbortController();
    setJob(null); setManifest(null);
    const poll = async () => {
      try {
        const result = await getStatementExport(jobId, { signal: controller.signal });
        if (!active) return;
        setJob(result); setError(false);
        if (result.state === 'complete') {
          const complete = await getStatementExportManifest(jobId, { signal: controller.signal });
          if (!complete?.complete || !Array.isArray(complete.files) || complete.fileCount !== complete.files.length) throw new Error('Incomplete manifest');
          if (active) setManifest(complete);
        } else if (!TERMINAL.has(result.state)) timer = setTimeout(poll, 5000);
      } catch { if (active) setError(true); }
    };
    poll();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [jobId, refresh]);

  // Poll bulk jobs with the same rhythm as single exports.
  useEffect(() => {
    if (!bulkJobs.length || !bulkJobs.some(item => !TERMINAL.has(item.state))) return;
    const timer = setTimeout(async () => {
      try {
        const updated = await Promise.all(bulkJobs.map(item =>
          TERMINAL.has(item.state) ? item : getStatementExport(item.id).catch(() => item)));
        setBulkJobs(updated);
      } catch { /* keep the last known states */ }
    }, 5000);
    return () => clearTimeout(timer);
  }, [bulkJobs]);

  const chosen = accounts.find(account => String(account.accountId) === accountId) || accounts[0];
  const currencyCode = currency || chosen?.currencyCode || '';
  const canRequest = product && chosen && /^[A-Z]{3}$/.test(currencyCode) && validStatementPeriod(period.from, period.to);
  const isAccounting = ACCOUNTING_FORMATS.has(format);

  function buildInput(account, from, to, selectedFormat) {
    return { product, from, to, currencyCode: account.currencyCode || currencyCode, format: selectedFormat, language,
      ...(product === 'business' ? { businessId: account.accountId } : {}),
      ...(['restaurant', 'restaurant_settlement'].includes(product) ? { restaurantId: account.restaurantId || account.accountId } : {}) };
  }

  async function submit(event) {
    event.preventDefault(); if (!canRequest || busy) return;
    setBusy(true); setError(false);
    const input = buildInput(chosen, period.from, period.to, format);
    try {
      if (isAccounting) {
        // Accounting formats stream a single file synchronously; no job.
        const response = await downloadAccountingExport(input);
        if (!(response.data instanceof Blob)) throw new Error('Invalid accounting file');
        saveBlob(response.data, filenameFromDisposition(response, `statement-${product}-${period.from}_${period.to}.${format}`));
        return;
      }
      const signature = JSON.stringify(input);
      if (requestKey.current?.signature !== signature) requestKey.current = { signature, key: crypto.randomUUID() };
      const result = await requestStatementExport(input, requestKey.current.key);
      const next = new URLSearchParams(search); next.set('exportJob', result.id); setSearch(next);
      setJob(result);
    } catch { setError(true); } finally { setBusy(false); }
  }

  async function action(callback) {
    if (!jobId || busy) return; setBusy(true); setError(false);
    try { setJob(await callback(jobId)); setRefresh(value => value + 1); }
    catch { setError(true); } finally { setBusy(false); }
  }

  async function download(file) {
    if (busy) return; setBusy(true); setError(false);
    try {
      const response = await downloadStatementExportFile(jobId, file.id);
      if (!(response.data instanceof Blob) || response.data.size !== file.byteLength) throw new Error('Incomplete file');
      saveBlob(response.data, filenameFromDisposition(response, `statement-export-${file.part}.${file.kind === 'csv' ? 'csv' : 'pdf'}`));
    } catch { setError(true); } finally { setBusy(false); }
  }

  function toggleBulkAccount(id) {
    setBulkAccounts(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleBulkPeriod(key) {
    setBulkPeriods(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const bulkItems = [];
  for (const account of accounts) {
    if (!bulkAccounts.has(String(account.accountId))) continue;
    for (const key of bulkPeriods) {
      const selected = JSON.parse(key);
      bulkItems.push(buildInput(account, selected.from, selected.to, bulkFormat));
    }
  }
  const canBulk = product && bulkItems.length > 0 && bulkItems.length <= BULK_MAX_ITEMS
    && bulkItems.every(item => /^[A-Z]{3}$/.test(item.currencyCode) && validStatementPeriod(item.from, item.to));
  const bulkReady = bulkJobs.length > 0 && bulkJobs.every(item => item.state === 'complete');
  const bulkPendingCount = bulkJobs.filter(item => !TERMINAL.has(item.state)).length;

  async function startBulk() {
    if (!canBulk || busy) return;
    setBusy(true); setBulkError(false);
    try {
      const result = await requestBulkStatementExport(bulkItems, crypto.randomUUID());
      setBulkJobs(result.jobs || []);
    } catch { setBulkError(true); } finally { setBusy(false); }
  }

  async function downloadPackage() {
    if (!bulkReady || busy) return;
    setBusy(true); setBulkError(false);
    try {
      const response = await downloadBulkStatementPackage(bulkJobs.map(item => item.id));
      if (!(response.data instanceof Blob)) throw new Error('Invalid package');
      saveBlob(response.data, filenameFromDisposition(response, 'statement-package.zip'));
    } catch { setBulkError(true); } finally { setBusy(false); }
  }

  async function bulkJobAction(id, callback) {
    if (busy) return; setBusy(true); setBulkError(false);
    try {
      const updated = await callback(id);
      setBulkJobs(previous => previous.map(item => (item.id === id ? updated : item)));
    } catch { setBulkError(true); } finally { setBusy(false); }
  }

  function closeHistory() {
    const next = new URLSearchParams(search); next.delete('view'); setSearch(next);
  }

  if (historyView) {
    return <section className="sa-export sa-item" aria-labelledby="statement-export-history-heading">
      <ExportHistory onBack={closeHistory} />
    </section>;
  }

  return <section className="sa-export sa-item" aria-labelledby="statement-export-heading">
    <h2 id="statement-export-heading">{text('export')}</h2>
    <p><Link to="?view=history">{t('statements.exportHistory.viewHistory')}</Link></p>
    {!routeJobId && <form className="sa-filters" onSubmit={submit}>
      <div className="sa-field"><label htmlFor="export-account">{t('archive.account')}</label>
        <select id="export-account" value={accountId || String(chosen?.accountId || '')} onChange={event => setAccountId(event.target.value)}>
          {accounts.map(account => <option key={account.accountId} value={account.accountId}>{account.name || account.restaurantName || String(account.accountId)}{account.currencyCode ? ` · ${account.currencyCode}` : ''}</option>)}
        </select></div>
      <div className="sa-field"><label htmlFor="export-from">{t('statements.from')}</label><input id="export-from" type="date" required value={period.from} onChange={event => setPeriod(value => ({ ...value, from: event.target.value }))} /></div>
      <div className="sa-field"><label htmlFor="export-to">{t('statements.to')}</label><input id="export-to" type="date" required value={period.to} onChange={event => setPeriod(value => ({ ...value, to: event.target.value }))} /></div>
      <div className="sa-field"><label htmlFor="export-currency">{t('archive.currency')}</label><input id="export-currency" required maxLength={3} value={currencyCode} onChange={event => setCurrency(event.target.value.toUpperCase())} /></div>
      <div className="sa-field"><label htmlFor="export-format">{t('archive.kind')}</label><select id="export-format" value={format} onChange={event => setFormat(event.target.value)}>
        <option value="csv">CSV</option>
        <option value="pdf">PDF</option>
        <option value="ofx">{accountingText('formatOfx')}</option>
        <option value="qfx">{accountingText('formatQfx')}</option>
        <option value="qbo">{accountingText('formatQbo')}</option>
      </select></div>
      <button type="submit" disabled={!canRequest || busy}>{text('export')}</button>
    </form>}
    {isAccounting && !routeJobId && <p className="sa-muted">{accountingText('formatHelp')}</p>}
    {error && <p role="alert">{isAccounting ? accountingText('downloadError') : text('exportError')} <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t('archive.retry')}</button></p>}
    {job && <div role="status" aria-live="polite">
      <p>{text(job.state === 'complete' ? 'exportReady' : job.state === 'failed' ? 'exportError' : job.state === 'cancelled' ? 'exportCancelled' : 'exportPending')}</p>
      {job.rowsTotal != null && <p><bdi>{job.rowsRendered} / {job.rowsTotal}</bdi> {t('archive.transactionsLabel')}</p>}
      {!TERMINAL.has(job.state) && <button type="button" disabled={busy || job.cancelRequested} onClick={() => action(cancelStatementExport)}>{text('cancelExport')}</button>}
      {job.canRetry && <button type="button" disabled={busy} onClick={() => action(retryStatementExport)}>{text('retryExport')}</button>}
    </div>}
    {manifest && <section aria-label={text('exportFiles')}><h3>{text('exportFiles')}</h3><ul className="sa-list">
      {manifest.files.map(file => <li key={file.id}><button type="button" disabled={busy} onClick={() => download(file)}>{t('archive.download')} {file.kind.toUpperCase()} · {file.part}</button><bdi> {file.rowFrom}–{file.rowTo}</bdi></li>)}
    </ul></section>}

    {!routeJobId && product && accounts.length > 0 && <section aria-labelledby="bulk-export-heading" className="sa-bulk">
      <h3 id="bulk-export-heading">
        <button type="button" aria-expanded={bulkOpen} onClick={() => setBulkOpen(open => !open)}>
          {bulkOpen ? bulkText('collapse') : bulkText('title')}
        </button>
      </h3>
      {bulkOpen && <>
        <p>{bulkText('description')}</p>
        <div className="sa-field">
          <span id="bulk-accounts-label">{bulkText('selectAccounts')}</span>
          <div role="group" aria-labelledby="bulk-accounts-label" className="sa-checkbox-list">
            <label><input type="checkbox" checked={bulkAccounts.size === accounts.length && accounts.length > 0}
              onChange={event => setBulkAccounts(new Set(event.target.checked ? accounts.map(account => String(account.accountId)) : []))} /> {bulkText('selectAll')}</label>
            {accounts.map(account => <label key={account.accountId}>
              <input type="checkbox" checked={bulkAccounts.has(String(account.accountId))} onChange={() => toggleBulkAccount(String(account.accountId))} />
              {account.name || account.restaurantName || String(account.accountId)}{account.currencyCode ? ` · ${account.currencyCode}` : ''}
            </label>)}
          </div>
        </div>
        <div className="sa-field">
          <span id="bulk-periods-label">{t('statements.from')} / {t('statements.to')}</span>
          <div role="group" aria-labelledby="bulk-periods-label" className="sa-checkbox-list">
            {periods.map(current => {
              const key = JSON.stringify(current);
              return <label key={key}>
                <input type="checkbox" checked={bulkPeriods.has(key)} onChange={() => toggleBulkPeriod(key)} />
                {current.from} – {current.to}
              </label>;
            })}
          </div>
        </div>
        <div className="sa-field"><label htmlFor="bulk-format">{t('archive.kind')}</label>
          <select id="bulk-format" value={bulkFormat} onChange={event => setBulkFormat(event.target.value)}>
            {BULK_FORMATS.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}
          </select></div>
        <p>{bulkText('selectedCount', { count: bulkItems.length })}</p>
        {bulkItems.length === 0 && <p role="status">{bulkText('noSelection')}</p>}
        <button type="button" disabled={!canBulk || busy} onClick={startBulk}>{busy ? bulkText('starting') : bulkText('startBulk')}</button>
        {bulkError && <p role="alert">{bulkText('startError')}</p>}
        {bulkJobs.length > 0 && <div className="sa-bulk-jobs">
          <h4>{bulkText('jobsTitle')}</h4>
          <ul className="sa-list">
            {bulkJobs.map(item => <li key={item.id}>
              <span>{item.product} · {item.period?.from} – {item.period?.to} · </span>
              <span role="status">{item.state === 'complete' ? bulkText('jobReady') : item.state === 'failed' ? bulkText('jobFailed') : bulkText('jobPending')}</span>
              {!TERMINAL.has(item.state) && <button type="button" disabled={busy || item.cancelRequested} onClick={() => bulkJobAction(item.id, cancelStatementExport)}>{text('cancelExport')}</button>}
              {item.canRetry && <button type="button" disabled={busy} onClick={() => bulkJobAction(item.id, retryStatementExport)}>{text('retryExport')}</button>}
            </li>)}
          </ul>
          {bulkPendingCount > 0 && <p role="status">{bulkText('notAllReady', { count: bulkPendingCount })}</p>}
          {bulkReady && <button type="button" disabled={busy} onClick={downloadPackage}>{busy ? bulkText('downloading') : bulkText('downloadPackage')}</button>}
        </div>}
      </>}
    </section>}
  </section>;
}
