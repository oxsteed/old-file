import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import api from '../api/axios';
import { formatDate } from '../lib/format';
import './HelperReputationPanel.css';

// Group 4 rest, items 192 (review response) and 195 (quality feedback
// summary). Reads GET /helpers/me/reviews and /helpers/me/quality-summary;
// responding uses the existing PUT /reviews/:id/respond (reviewee-only,
// once, enforced on the server).
export default function HelperReputationPanel() {
  const { user } = useAuth();
  return user?.id ? <ReputationWorkspace key={user.id} /> : null;
}

function ReputationWorkspace() {
  const { t, i18n } = useTranslation();
  const c = (key, opts) => t(`helperG4.reputation.${key}`, opts);
  const [state, setState] = useState({ loading: true, error: false, reviews: [], summary: null });
  const [retry, setRetry] = useState(0);
  const [drafts, setDrafts] = useState({});
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get('/helpers/me/reviews', { signal: controller.signal }),
      api.get('/helpers/me/quality-summary', { signal: controller.signal }),
      api.get('/helpers/me/endorsements', { signal: controller.signal }).catch(() => ({ data: { skills: [] } })),
    ]).then(([reviews, summary, endorsed]) => {
      if (!controller.signal.aborted) setState({ loading: false, error: false, reviews: reviews.data.reviews || [], summary: summary.data, endorsements: endorsed.data.skills || [] });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ loading: false, error: true, reviews: [], summary: null });
    });
    return () => controller.abort();
  }, [retry]);

  async function post(review) {
    const text = (drafts[review.id] || '').trim();
    if (!text || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const { data } = await api.put(`/reviews/${encodeURIComponent(review.id)}/respond`, { response: text });
      setState((prev) => ({ ...prev, reviews: prev.reviews.map((r) => (r.id === review.id
        ? { ...r, response: data.review?.response || text, respondedAt: data.review?.response_at || new Date().toISOString() } : r)) }));
      setOpen(null);
      setNotice(c('posted'));
    } catch {
      setNotice(c('postFailed'));
    } finally {
      setBusy(false);
    }
  }

  const s = state.summary?.reviews;
  const jobs = state.summary?.jobs;
  return <section className="helper-reputation" aria-labelledby="helper-reputation-title" aria-busy={state.loading}>
    <h2 id="helper-reputation-title">{c('title')}</h2>
    {state.loading && <p role="status">{c('loading')}</p>}
    {state.error && <div role="alert"><p>{c('loadFailed')}</p>
      <button type="button" onClick={() => setRetry((n) => n + 1)} data-track="ui.helperG4.reputation.retry">{c('retry')}</button></div>}
    {s && <>
      <dl className="helper-reputation-totals">
        <div><dt>{c('average')}</dt><dd>{s.average == null ? '—' : c('stars', { rating: s.average })}</dd></div>
        <div><dt>{c('total')}</dt><dd>{s.total}</dd></div>
        <div><dt>{c('recent')}</dt><dd>{s.recentAverage == null ? '—' : c('stars', { rating: s.recentAverage })}</dd></div>
        <div><dt>{c('responseRate')}</dt><dd>{s.responseRate == null ? '—' : `${s.responseRate}%`}</dd></div>
        <div><dt>{c('completed')}</dt><dd>{jobs.completed}</dd></div>
        <div><dt>{c('changesRequested')}</dt><dd>{jobs.changesRequested}</dd></div>
        <div><dt>{c('noShows')}</dt><dd>{jobs.noShowsReported}</dd></div>
      </dl>
      <p className="helper-reputation-trend">{c(`trend.${s.trend}`)}</p>
      <ul className="helper-reputation-dist" aria-label={c('total')}>
        {[5, 4, 3, 2, 1].map((n) => <li key={n}><span>{c('stars', { rating: n })}</span><strong>{s.distribution[n] || 0}</strong></li>)}
      </ul>
      {s.lowRatingsAwaitingResponse > 0 && <p role="status">{c('lowAwaiting', { count: s.lowRatingsAwaitingResponse })}</p>}
    </>}
    {state.endorsements && <section aria-labelledby="helper-endorsements-title">
      <h3 id="helper-endorsements-title">{t('helperG4.endorsements.recordTitle')}</h3>
      {state.endorsements.every((e) => e.count === 0)
        ? <p>{t('helperG4.endorsements.recordEmpty')}</p>
        : <ul className="helper-reputation-dist">{state.endorsements.map((e) => <li key={e.helperSkillId}>
            <span>{e.skill}</span><strong>{t('helperG4.endorsements.recordCount', { count: e.count })}</strong>
          </li>)}</ul>}
    </section>}
    {notice && <p role="status">{notice}</p>}
    {!state.loading && !state.error && state.reviews.length === 0 && <p>{c('empty')}</p>}
    {state.reviews.length > 0 && <ul className="helper-reputation-list">
      {state.reviews.map((review) => <li key={review.id}>
        <header>
          <strong>{c('stars', { rating: review.rating })}</strong>
          <span>{review.reviewerFirstName || c('anonymous')}</span>
          <time dateTime={review.createdAt}>{formatDate(review.createdAt, { locale: i18n.language })}</time>
          {review.jobId && <Link to={`/jobs/${encodeURIComponent(review.jobId)}`}>{review.jobTitle || review.jobId}</Link>}
        </header>
        {review.comment && <p dir="auto">{review.comment}</p>}
        {review.response
          ? <blockquote dir="auto"><span>{c('yourResponse')}</span> {review.response}</blockquote>
          : open === review.id
            ? <div className="helper-reputation-respond">
                <label htmlFor={`respond-${review.id}`}>{c('yourResponse')}</label>
                <textarea id={`respond-${review.id}`} dir="auto" maxLength={2000} value={drafts[review.id] || ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [review.id]: e.target.value }))} />
                <p>{c('respondHint')}</p>
                <button type="button" disabled={busy || !(drafts[review.id] || '').trim()} onClick={() => post(review)} data-track="ui.helperG4.reputation.post">{c('post')}</button>
                <button type="button" onClick={() => setOpen(null)} data-track="ui.helperG4.reputation.cancel">{c('cancel')}</button>
              </div>
            : <button type="button" onClick={() => setOpen(review.id)} data-track="ui.helperG4.reputation.respond">{c('respond')}</button>}
      </li>)}
    </ul>}
  </section>;
}
