import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { listCareerEmployers } from '../api/careers';
import { Empty, Loading, LoadError, useLoad } from '../components/careers/ui';
import { Stars } from '../components/careers/marketplace/shared';
import { pageList } from '../features/careers/marketplaceModel';
import '../styles/CareerSystem.css';

/** Employer directory: every business hiring on OxSteed, searchable. */
export default function CareerEmployersPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ q: '', city: '', verified: false, same_day: false, sort: 'open_jobs' });
  const [query, setQuery] = useState(form);
  const [page, setPage] = useState(1);
  const data = useLoad(() => listCareerEmployers({
    q: query.q || undefined, city: query.city || undefined, verified: query.verified ? 'true' : undefined,
    same_day: query.same_day ? 'true' : undefined, sort: query.sort === 'open_jobs' ? undefined : query.sort, page,
  }), [query, page]);
  useEffect(() => { setPage(1); }, [query]);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const employers = data.data?.employers || [];
  return (
    <PageShell>
      <PageMeta title={t('careers.mk.employers.metaTitle')} description={t('careers.mk.employers.metaDesc')} />
      <div className="ox-careers">
        <Link className="ox-careers-btn" to="/careers">{t('careers.back')}</Link>
        <h1>{t('careers.mk.employers.title')}</h1>
        <p className="ox-careers-lead">{t('careers.mk.employers.lead')}</p>
        <form className="ox-careers-filters" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(form); }} data-track="ui.c0a0f26c4c.1">
          <input aria-label={t('careers.mk.employers.search')} placeholder={t('careers.mk.employers.search')} value={form.q} onChange={(e) => set('q')(e.target.value)} />
          <input aria-label={t('careers.mk.employers.city')} placeholder={t('careers.mk.employers.city')} value={form.city} onChange={(e) => set('city')(e.target.value)} />
          <select aria-label={t('careers.mk.search.sort')} value={form.sort} onChange={(e) => set('sort')(e.target.value)}>
            {['open_jobs', 'rating', 'name'].map((s) => <option key={s} value={s}>{t(`careers.mk.employers.sorts.${s}`)}</option>)}
          </select>
          <label className="ox-careers-check"><input type="checkbox" checked={form.verified} onChange={(e) => set('verified')(e.target.checked)} data-track="ui.c0a0f26c4c.2" /><span>{t('careers.mk.employers.verifiedOnly')}</span></label>
          <label className="ox-careers-check"><input type="checkbox" checked={form.same_day} onChange={(e) => set('same_day')(e.target.checked)} data-track="ui.c0a0f26c4c.3" /><span>{t('careers.mk.badges.sameDay')}</span></label>
          <button type="submit" className="ox-careers-btn primary" data-track="ui.c0a0f26c4c.4">{t('careers.filters.search')}</button>
        </form>
        {data.loading && !data.data ? <Loading /> : null}
        <LoadError error={data.error} onRetry={data.reload} />
        {data.data && !employers.length ? <Empty>{t('careers.mk.employers.none')}</Empty> : null}
        <div className="ox-careers-grid">
          {employers.map((e) => (
            <Link key={e.id} className="ox-careers-card" to={`/careers/employers/${encodeURIComponent(e.slug)}`}>
              <div className="ox-careers-row">
                {e.logo_url ? <img className="ox-careers-logo" src={e.logo_url} alt="" loading="lazy" width="48" height="48" /> : null}
                <h2 className="ox-careers-card-title">{e.name}</h2>
              </div>
              {e.headline ? <p className="ox-careers-subtle">{e.headline}</p> : null}
              <div className="ox-careers-meta">
                <span className="ox-careers-chip ok">{t('careers.mk.employers.openJobs', { count: e.open_jobs })}</span>
                {e.verified ? <span className="ox-careers-chip">{t('careers.verifiedEmployer')}</span> : null}
                {e.same_day_hiring ? <span className="ox-careers-chip ok">{t('careers.mk.badges.sameDay')}</span> : null}
                {[e.city, e.region].filter(Boolean).length ? <span className="ox-careers-chip">{[e.city, e.region].filter(Boolean).join(', ')}</span> : null}
              </div>
              {e.review_count ? <p><Stars value={e.rating} /> · {t('careers.mk.reviews.count', { count: e.review_count })}</p> : null}
            </Link>
          ))}
        </div>
        {(data.data?.pages || 1) > 1 ? (
          <nav className="ox-careers-actions ox-careers-pager" aria-label={t('careers.mk.search.pages')}>
            {pageList(page, data.data.pages).map((n, i) => (n === '…'
              ? <span key={`gap${i}`} aria-hidden="true">…</span>
              : <button key={n} type="button" className={`ox-careers-btn${n === page ? ' primary' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => setPage(n)} data-track="ui.c0a0f26c4c.5">{n}</button>))}
          </nav>
        ) : null}
      </div>
    </PageShell>
  );
}
