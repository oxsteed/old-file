import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { previousStatementMonth, validStatementPeriod } from '../../api/creditStatements';
import { requestStatementExport, getStatementExport, cancelStatementExport, retryStatementExport, getStatementExportManifest, downloadStatementExportFile } from '../../api/statementExports';

const TERMINAL = new Set(['complete', 'failed', 'cancelled']);

export default function StatementExportPanel({ product, accounts = [] }) {
  const { t, i18n } = useTranslation('credit');
  const { jobId: routeJobId } = useParams();
  const [search, setSearch] = useSearchParams();
  const jobId = routeJobId || search.get('exportJob');
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
  const text = key => t(`statementCenter.${key}`);
  const language = (i18n.resolvedLanguage || 'en').split(/[-_]/)[0];

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

  const chosen = accounts.find(account => String(account.accountId) === accountId) || accounts[0];
  const currencyCode = currency || chosen?.currencyCode || '';
  const canRequest = product && chosen && /^[A-Z]{3}$/.test(currencyCode) && validStatementPeriod(period.from, period.to);

  async function submit(event) {
    event.preventDefault(); if (!canRequest || busy) return;
    setBusy(true); setError(false);
    const input = { product, from: period.from, to: period.to, currencyCode, format, language,
      ...(product === 'business' ? { businessId: chosen.accountId } : {}),
      ...(['restaurant', 'restaurant_settlement'].includes(product) ? { restaurantId: chosen.restaurantId || chosen.accountId } : {}) };
    const signature = JSON.stringify(input);
    if (requestKey.current?.signature !== signature) requestKey.current = { signature, key: crypto.randomUUID() };
    try {
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
      const url = URL.createObjectURL(response.data); const link = document.createElement('a');
      link.href = url; link.download = `statement-export-${file.part}.${file.kind === 'csv' ? 'csv' : 'pdf'}`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(true); } finally { setBusy(false); }
  }

  return <section className="sa-export sa-item" aria-labelledby="statement-export-heading">
    <h2 id="statement-export-heading">{text('export')}</h2>
    {!routeJobId && <form className="sa-filters" onSubmit={submit}>
      <div className="sa-field"><label htmlFor="export-account">{t('archive.account')}</label>
        <select id="export-account" value={accountId || String(chosen?.accountId || '')} onChange={event => setAccountId(event.target.value)}>
          {accounts.map(account => <option key={account.accountId} value={account.accountId}>{account.name || account.restaurantName || String(account.accountId)}{account.currencyCode ? ` · ${account.currencyCode}` : ''}</option>)}
        </select></div>
      <div className="sa-field"><label htmlFor="export-from">{t('statements.from')}</label><input id="export-from" type="date" required value={period.from} onChange={event => setPeriod(value => ({ ...value, from: event.target.value }))} /></div>
      <div className="sa-field"><label htmlFor="export-to">{t('statements.to')}</label><input id="export-to" type="date" required value={period.to} onChange={event => setPeriod(value => ({ ...value, to: event.target.value }))} /></div>
      <div className="sa-field"><label htmlFor="export-currency">{t('archive.currency')}</label><input id="export-currency" required maxLength={3} value={currencyCode} onChange={event => setCurrency(event.target.value.toUpperCase())} /></div>
      <div className="sa-field"><label htmlFor="export-format">{t('archive.kind')}</label><select id="export-format" value={format} onChange={event => setFormat(event.target.value)}><option value="csv">CSV</option><option value="pdf">PDF</option></select></div>
      <button type="submit" disabled={!canRequest || busy}>{text('export')}</button>
    </form>}
    {error && <p role="alert">{text('exportError')} <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t('archive.retry')}</button></p>}
    {job && <div role="status" aria-live="polite">
      <p>{text(job.state === 'complete' ? 'exportReady' : job.state === 'failed' ? 'exportError' : job.state === 'cancelled' ? 'exportCancelled' : 'exportPending')}</p>
      {job.rowsTotal != null && <p><bdi>{job.rowsRendered} / {job.rowsTotal}</bdi> {t('archive.transactionsLabel')}</p>}
      {!TERMINAL.has(job.state) && <button type="button" disabled={busy || job.cancelRequested} onClick={() => action(cancelStatementExport)}>{text('cancelExport')}</button>}
      {job.canRetry && <button type="button" disabled={busy} onClick={() => action(retryStatementExport)}>{text('retryExport')}</button>}
    </div>}
    {manifest && <section aria-label={text('exportFiles')}><h3>{text('exportFiles')}</h3><ul className="sa-list">
      {manifest.files.map(file => <li key={file.id}><button type="button" disabled={busy} onClick={() => download(file)}>{t('archive.download')} {file.kind.toUpperCase()} · {file.part}</button><bdi> {file.rowFrom}–{file.rowTo}</bdi></li>)}
    </ul></section>}
  </section>;
}
