import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import JsonLd, { buildItemList } from '../components/JsonLd';
import CountrySelect from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';
import { createCareerAlert, listPublicCareerOpenings } from '../api/careers';
import { Loading, LoadError, Empty, useCareerErrors } from '../components/careers/ui';
import OpeningCard from '../components/careers/OpeningCard';
import { DEPARTMENTS, PATH_STAGES, PAY_PERIODS, WORKPLACE_TYPES } from '../features/careers/careersModel';
import {
  alertCriteriaFrom, EXPERIENCE_LEVELS, INDUSTRIES, pageList, POSTED_WITHIN_DAYS, SEARCH_SORTS, searchParamsFrom,
} from '../features/careers/marketplaceModel';
import '../styles/CareerSystem.css';



export default function CareersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { businessId } = useParams();
  const errorText = useCareerErrors();
  const blank = {
    q: '', country: '', workplace: '', employer: '', path: '', department: '', near: '', radius_km: 25,
    industry: '', experience: '', posted_within: '', pay_min: '', pay_period: 'hourly', same_day: false, urgent: false, sponsorship: false,
    sort: 'newest', page_size: 20,
  };
  const [filters, setFilters] = useState(blank);
  const [applied, setApplied] = useState(blank);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [rows, setRows] = useState([]);
  const [promoted, setPromoted] = useState([]);
  const [paging, setPaging] = useState({ total: 0, pages: 1 });
  const [nearFound, setNearFound] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPublicCareerOpenings({
        ...searchParamsFrom(applied),
        page,
        employer: businessId ? 'business' : applied.employer || undefined,
        business_id: businessId || undefined,
      });
      setRows(data.openings || []);
      setPromoted(data.promoted || []);
      setPaging({ total: data.total ?? (data.openings || []).length, pages: data.pages || 1 });
      setNearFound(data.near?.found !== false);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [applied, businessId, page]);

  useEffect(() => { load(); }, [load]);

  const set = (key) => (value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const search = (next = filters) => { setApplied(next); setPage(1); };
  const goTo = (n) => { setPage(n); window.scrollTo?.({ top: 0, behavior: 'smooth' }); };
  const criteria = alertCriteriaFrom(applied);
  const saveAlert = async () => {
    try {
      await createCareerAlert({ name: applied.q.trim() || t('careers.mk.alerts.defaultName'), criteria, frequency: 'daily', channels: ['in_app', 'email'] });
      toast.success(t('careers.mk.alerts.created'));
    } catch (err) { toast.error(errorText(err)); }
  };

  return (
    <PageShell>
      <PageMeta title={t('careers.metaTitle')} description={t('careers.metaDesc')} />
      {/* SEO: ItemList of the openings actually rendered, deduplicated
          across the promoted and main lists. No salary or dates are
          claimed here; the opening page carries the JobPosting. */}
      <JsonLd data={buildItemList(
        [...promoted, ...rows]
          .filter((row, index, all) => row && row.id && all.findIndex((other) => other.id === row.id) === index)
          .map((row) => ({ name: row.title, url: `https://oxsteed.com/careers/${row.id}` })),
      )} />
      <div className="ox-careers">
        <p className="ox-careers-kicker">{t('careers.kicker')}</p>
        <h1>{businessId ? t('careers.businessTitle') : t('careers.title')}</h1>
        <p className="ox-careers-lead">{t('careers.subtitle')}</p>
        <div className="ox-careers-actions">
          {user ? <Link className="ox-careers-btn" to="/careers/me">{t('careers.myCareers')}</Link> : null}
          <Link className="ox-careers-btn" to="/careers/employers">{t('careers.mk.nav.employers')}</Link>
          <Link className="ox-careers-btn" to="/careers/salaries">{t('careers.mk.nav.salaries')}</Link>
          <Link className="ox-careers-btn" to="/careers/interview-tips">{t('careers.mk.nav.tips')}</Link>
        </div>
        <form
          className="ox-careers-filters"
          role="search"
          onSubmit={(e) => { e.preventDefault(); search(); }}
        >
          <input aria-label={t('careers.searchPlaceholder')} value={filters.q} onChange={(e) => set('q')(e.target.value)} placeholder={t('careers.searchPlaceholder')} />
          <CountrySelect value={filters.country} onChange={set('country')} />
          <select aria-label={t('careers.fields.workplace')} value={filters.workplace} onChange={(e) => set('workplace')(e.target.value)}>
            <option value="">{t('careers.filters.allWorkplaces')}</option>
            {WORKPLACE_TYPES.map((w) => <option key={w} value={w}>{t(`careers.workplace.${w}`)}</option>)}
          </select>
          <select aria-label={t('careers.fields.pathStage')} value={filters.path} onChange={(e) => set('path')(e.target.value)}>
            <option value="">{t('careers.filters.allTypes')}</option>
            {PATH_STAGES.map((p) => <option key={p} value={p}>{t(`careers.path.${p}`)}</option>)}
          </select>
          <select aria-label={t('careers.fields.department')} value={filters.department} onChange={(e) => set('department')(e.target.value)}>
            <option value="">{t('careers.filters.allDepartments')}</option>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{t(`careers.department.${d}`)}</option>)}
          </select>
          {!businessId ? (
            <select aria-label={t('careers.filters.employer')} value={filters.employer} onChange={(e) => set('employer')(e.target.value)}>
              <option value="">{t('careers.filters.allEmployers')}</option>
              <option value="platform">{t('careers.filters.oxsteed')}</option>
              <option value="business">{t('careers.filters.businesses')}</option>
            </select>
          ) : null}
          <input aria-label={t('careers.filters.near')} value={filters.near} onChange={(e) => set('near')(e.target.value)} placeholder={t('careers.filters.near')} />
          <select aria-label={t('careers.filters.radius')} value={filters.radius_km} onChange={(e) => set('radius_km')(Number(e.target.value))}>
            {[5, 10, 25, 50, 100].map((r) => <option key={r} value={r}>{t('careers.filters.withinKm', { km: r })}</option>)}
          </select>
          <select aria-label={t('careers.mk.search.sort')} value={filters.sort} onChange={(e) => { const next = { ...filters, sort: e.target.value }; setFilters(next); search(next); }}>
            {SEARCH_SORTS.map((s) => <option key={s} value={s}>{t(`careers.mk.search.sorts.${s}`)}</option>)}
          </select>
          <button type="button" className="ox-careers-btn" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? t('careers.mk.search.fewer') : t('careers.mk.search.more')}</button>
          <button type="submit" className="ox-careers-btn primary">{t('careers.filters.search')}</button>
          {more ? (
            <div className="ox-careers-form-grid">
              <select aria-label={t('careers.mk.search.industry')} value={filters.industry} onChange={(e) => set('industry')(e.target.value)}>
                <option value="">{t('careers.mk.search.allIndustries')}</option>
                {INDUSTRIES.map((x) => <option key={x} value={x}>{t(`careers.mk.industry.${x}`)}</option>)}
              </select>
              <select aria-label={t('careers.mk.search.experience')} value={filters.experience} onChange={(e) => set('experience')(e.target.value)}>
                <option value="">{t('careers.mk.search.anyExperience')}</option>
                {EXPERIENCE_LEVELS.map((x) => <option key={x} value={x}>{t(`careers.mk.experience.${x}`)}</option>)}
              </select>
              <select aria-label={t('careers.mk.search.posted')} value={filters.posted_within} onChange={(e) => set('posted_within')(e.target.value)}>
                <option value="">{t('careers.mk.search.anyTime')}</option>
                {POSTED_WITHIN_DAYS.map((d) => <option key={d} value={d}>{t('careers.mk.search.postedWithin', { count: d })}</option>)}
              </select>
              <input type="number" min="0" step="0.5" inputMode="decimal" aria-label={t('careers.mk.search.payMin')} placeholder={t('careers.mk.search.payMin')} value={filters.pay_min} onChange={(e) => set('pay_min')(e.target.value)} />
              <select aria-label={t('careers.mk.search.payPeriod')} value={filters.pay_period} onChange={(e) => set('pay_period')(e.target.value)}>
                {PAY_PERIODS.map((p) => <option key={p} value={p}>{t(`careers.period.${p}`)}</option>)}
              </select>
              <select aria-label={t('careers.mk.search.perPage')} value={filters.page_size} onChange={(e) => set('page_size')(Number(e.target.value))}>
                {[10, 20, 50].map((n) => <option key={n} value={n}>{t('careers.mk.search.perPageN', { count: n })}</option>)}
              </select>
              {['same_day', 'urgent', 'sponsorship'].map((k) => (
                <label key={k} className="ox-careers-check">
                  <input type="checkbox" checked={filters[k]} onChange={(e) => set(k)(e.target.checked)} />
                  <span>{t(`careers.mk.search.flags.${k}`)}</span>
                </label>
              ))}
              <button type="button" className="ox-careers-btn" onClick={() => { setFilters(blank); search(blank); }}>{t('careers.mk.search.clear')}</button>
            </div>
          ) : null}
        </form>
        {!nearFound ? <p className="ox-careers-error">{t('careers.filters.postalNotFound')}</p> : null}
        <div className="ox-careers-row">
          <p className="ox-careers-subtle" aria-live="polite">{loading ? '' : t('careers.mk.search.results', { count: paging.total })}</p>
          {Object.keys(criteria).length ? (
            user
              ? <button type="button" className="ox-careers-btn" onClick={saveAlert}>{t('careers.mk.alerts.saveSearch')}</button>
              : <Link className="ox-careers-btn" to={`/login?next=${encodeURIComponent('/careers')}`}>{t('careers.mk.alerts.saveSearch')}</Link>
          ) : null}
        </div>
        <LoadError error={error} onRetry={load} />
        {promoted.length ? (
          <section className="ox-careers-section" aria-label={t('careers.promoted')}>
            <div className="ox-careers-grid">
              {promoted.map((row) => <OpeningCard key={`p${row.id}`} opening={row} promoted />)}
            </div>
          </section>
        ) : null}
        {loading && !rows.length ? <Loading /> : !rows.length ? <Empty>{t('careers.noOpenings')}</Empty> : (
          <div className="ox-careers-grid">
            {rows.map((row) => <OpeningCard key={row.id} opening={row} />)}
          </div>
        )}
        {paging.pages > 1 ? (
          <nav className="ox-careers-actions ox-careers-pager" aria-label={t('careers.mk.search.pages')}>
            <button type="button" className="ox-careers-btn" disabled={page <= 1 || loading} onClick={() => goTo(page - 1)}>{t('careers.mk.search.prev')}</button>
            {pageList(page, paging.pages).map((n, i) => (n === '…'
              ? <span key={`gap${i}`} aria-hidden="true">…</span>
              : <button key={n} type="button" className={`ox-careers-btn${n === page ? ' primary' : ''}`} aria-current={n === page ? 'page' : undefined} disabled={loading} onClick={() => goTo(n)}>{n}</button>))}
            <button type="button" className="ox-careers-btn" disabled={page >= paging.pages || loading} onClick={() => goTo(page + 1)}>{t('careers.mk.search.next')}</button>
          </nav>
        ) : null}
      </div>
    </PageShell>
  );
}
