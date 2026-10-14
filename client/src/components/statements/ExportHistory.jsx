import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listStatementExports, downloadStatementExportFile } from '../../api/statementExports';
import './ExportHistory.css';

const PAGE_SIZE = 20;

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportHistory({ onBack }) {
  const { t, i18n } = useTranslation('credit');
  const text = key => t(`statements.exportHistory.${key}`);
  const language = (i18n.resolvedLanguage || 'en').split(/[-_]/)[0];
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(null);

  const load = useCallback(async (nextPage) => {
    setLoading(true); setError(false);
    try {
      setResult(await listStatementExports({ page: nextPage, pageSize: PAGE_SIZE }));
    } catch { setError(true); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page); }, [load, page]);

  async function download(job, file) {
    if (downloading) return;
    setDownloading(`${job.id}:${file.part}`); setError(false);
    try {
      const response = await downloadStatementExportFile(job.id, file.id);
      if (!(response.data instanceof Blob)) throw new Error('Invalid file');
      saveBlob(response.data, `statement-${job.product}-${job.period.from}_${job.period.to}-part${file.part}.${file.kind === 'csv' ? 'csv' : 'pdf'}`);
    } catch { setError(true); } finally { setDownloading(null); }
  }

  const formatDate = value => {
    try { return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
    catch { return String(value); }
  };

  const jobs = result?.jobs || [];
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return <div className="seh-history">
    <div className="seh-head">
      <div>
        <h2 id="statement-export-history-heading">{text('title')}</h2>
        <p className="seh-muted">{text('description')}</p>
      </div>
      {onBack && <button type="button" className="seh-back" onClick={onBack}>{text('backToExport')}</button>}
    </div>
    {loading && <p role="status">{text('loading')}</p>}
    {error && <p role="alert">{text('loadError')} <button type="button" onClick={() => load(page)}>{text('retry')}</button></p>}
    {!loading && !error && jobs.length === 0 && <p role="status">{text('noExports')}</p>}
    {!loading && !error && jobs.length > 0 && <>
      <div className="seh-table-wrap">
        <table className="seh-table">
          <caption className="seh-caption">{text('title')}</caption>
          <thead><tr>
            <th scope="col">{text('colStarted')}</th>
            <th scope="col">{text('colProduct')}</th>
            <th scope="col">{text('colPeriod')}</th>
            <th scope="col">{text('colFormat')}</th>
            <th scope="col">{text('colStatus')}</th>
            <th scope="col">{text('colResult')}</th>
          </tr></thead>
          <tbody>
            {jobs.map(job => <tr key={job.id}>
              <td>{formatDate(job.createdAt)}</td>
              <td>{job.product}</td>
              <td><bdi>{job.period.from} – {job.period.to}</bdi></td>
              <td>{String(job.format).toUpperCase()}</td>
              <td><span className={`seh-status seh-status-${job.state}`}>{text(`status${job.state[0].toUpperCase()}${job.state.slice(1)}`)}</span></td>
              <td>
                {job.files ? job.files.map(file => <button key={`${job.id}-${file.part}`} type="button"
                  className="seh-download" disabled={!!downloading}
                  onClick={() => download(job, file)}>
                  {downloading === `${job.id}:${file.part}` ? `${text('download')}…` : `${text('download')} ${String(file.kind).toUpperCase()} · ${file.part}`}
                </button>) : <span className="seh-muted">{job.errorCode || text('noFiles')}</span>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="seh-pager" role="navigation" aria-label={text('page')}>
        <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{text('previous')}</button>
        <span role="status">{text('page')} {page} {text('of')} {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>{text('next')}</button>
      </div>
    </>}
  </div>;
}
