import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import { moneyMinor } from '../lib/moneyExact';
import { formatDate } from '../lib/format';
import './HelperJobEarnings.css';

export default function HelperJobEarnings() {
  const { user } = useAuth();
  return user?.id ? <HelperEarningsWorkspace key={user.id} userId={user.id} /> : null;
}

function HelperEarningsWorkspace({ userId }) {
  const { t, i18n } = useTranslation();
  const [currency, setCurrency] = useState('');
  const [offset, setOffset] = useState(0);
  const [period, setPeriod] = useState('weekly');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ key: '', data: null, error: false });
  const key = `${userId}:${currency}:${offset}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    api.get('/main-app/earnings', { signal: controller.signal,
      params: { currencyCode: currency || undefined, offset, limit: 20 } })
      .then(res => { if (!controller.signal.aborted) setState({ key, data: res.data, error: false }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, data: null, error: true }); });
    return () => controller.abort();
  }, [userId, key, currency, offset]);
  const data = state.key === key ? state.data : null;
  const error = state.key === key && state.error;
  const summary = data?.summary || {};
  const money = value => moneyMinor(value, summary.currencyCode, i18n.language);
  const oldCopy = name => t(`helperDashboard.jobEarnings.${name}`);
  const copy = name => t(`helperEarningsV2.${name}`);
  const series = [...(data?.[period] || [])].reverse();
  const max = Math.max(0, ...series.map(row => Number(row.amountCents || 0)));
  const totals = [ ['lifetime', 'lifetimeCents'], ['thisWeek', 'weekCents'], ['thisMonth', 'monthCents'],
    ['completedJobs', 'completedJobs'], ['available', 'availableCents'], ['pendingPayout', 'pendingCents'], ['paidOut', 'paidCents'] ];
  return <section className="helper-job-earnings" lang={i18n.language} aria-labelledby="helper-earnings-title" aria-busy={!data && !error}>
    <h2 id="helper-earnings-title">{oldCopy('title')}</h2>
    {!data && !error && <p role="status">{oldCopy('loading')}</p>}
    {error && <div role="alert"><p>{oldCopy('loadFailed')}</p><button onClick={() => setRetry(value => value + 1)}>{oldCopy('retry')}</button></div>}
    {data && <>
      <label>{copy('currency')} <select aria-label={copy('currency')} value={summary.currencyCode} onChange={event => { setCurrency(event.target.value); setOffset(0); }}>
        {(data.accounts?.length ? data.accounts : [{ currencyCode: summary.currencyCode }]).map(account =>
          <option key={account.currencyCode} value={account.currencyCode}>{account.currencyCode}</option>)}
      </select></label>
      <p>{copy('recordedOnly')}</p>
      {summary.unpricedJobs > 0 && <p role="status">{t('helperEarningsV2.unpriced', { count: summary.unpricedJobs })}</p>}
      <dl className="helper-earnings-totals">{totals.map(([label, field]) => <div key={field}>
        <dt>{oldCopy(label)}</dt><dd>{field === 'completedJobs' ? summary[field] : money(summary[field])}</dd>
      </div>)}</dl>
      <label>{copy('trend')} <select aria-label={copy('trend')} value={period} onChange={event => setPeriod(event.target.value)}>
        <option value="weekly">{copy('weekly')}</option><option value="monthly">{copy('monthly')}</option>
      </select></label>
      {series.length > 0 && <ul className="helper-earnings-series">{series.map(row => <li key={row.period}>
        <time>{formatDate(row.period, { locale: i18n.language, timeZone: 'UTC' })}</time><span className="helper-earnings-bar" aria-hidden="true" style={{ inlineSize: `${max ? Math.max(1, Number(row.amountCents) / max * 100) : 0}%` }} />
        <strong>{money(row.amountCents)}</strong>
      </li>)}</ul>}
      <h3>{oldCopy('recentJobs')}</h3>
      {!data.jobs?.length && <p>{oldCopy('noJobs')}</p>}
      <ul className="helper-earnings-jobs">{data.jobs?.map(job => <li key={job.id}>
        <Link to={`/jobs/${encodeURIComponent(job.id)}`}>{job.title || copy('untitled')}</Link>
        <time>{formatDate(job.completedAt, { locale: i18n.language })}</time>
        <span>{oldCopy({ earned: 'statusEarned', pending: 'statusPending', processing: 'statusProcessing', paid: 'statusPaid' }[job.payoutStatus] || 'statusNotReady')}</span>
        <strong>{job.amountCents == null ? copy('notRecorded') : money(job.amountCents)}</strong>
      </li>)}</ul>
      <nav aria-label={copy('pagination')}>
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{copy('previous')}</button>
        <span>{data.pagination?.total || 0} · {summary.currencyCode}</span>
        <button disabled={!data.pagination?.hasMore} onClick={() => setOffset(offset + 20)}>{copy('next')}</button>
      </nav>
    </>}
  </section>;
}
