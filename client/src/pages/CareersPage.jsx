import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import CountrySelect from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';
import { listPublicCareerOpenings } from '../api/careers';
import { Loading, LoadError, Empty } from '../components/careers/ui';
import OpeningCard from '../components/careers/OpeningCard';
import { cleanFilters, DEPARTMENTS, PATH_STAGES, WORKPLACE_TYPES } from '../features/careers/careersModel';
import '../styles/CareerSystem.css';



export default function CareersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { businessId } = useParams();
  const [filters, setFilters] = useState({ q: '', country: '', workplace: '', employer: '', path: '', department: '', near: '', radius_km: 25 });
  const [applied, setApplied] = useState(filters);
  const [rows, setRows] = useState([]);
  const [promoted, setPromoted] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [nearFound, setNearFound] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (append = false, from = null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPublicCareerOpenings({
        ...cleanFilters(applied),
        employer: businessId ? 'business' : applied.employer || undefined,
        business_id: businessId || undefined,
        cursor: append ? from : undefined,
      });
      setRows((prev) => (append ? [...prev, ...(data.openings || [])] : data.openings || []));
      if (!append) setPromoted(data.promoted || []);
      setCursor(data.nextCursor || null);
      setNearFound(data.near?.found !== false);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [applied, businessId]);

  useEffect(() => { load(false); }, [load]);

  const set = (key) => (value) => setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <PageShell>
      <PageMeta title={t('careers.metaTitle')} description={t('careers.metaDesc')} />
      <div className="ox-careers">
        <p className="ox-careers-kicker">{t('careers.kicker')}</p>
        <h1>{businessId ? t('careers.businessTitle') : t('careers.title')}</h1>
        <p className="ox-careers-lead">{t('careers.subtitle')}</p>
        {user ? (
          <div className="ox-careers-actions">
            <Link className="ox-careers-btn" to="/careers/me">{t('careers.myCareers')}</Link>
          </div>
        ) : null}
        <form
          className="ox-careers-filters"
          role="search"
          onSubmit={(e) => { e.preventDefault(); setApplied(filters); }}
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
          <button type="submit" className="ox-careers-btn primary">{t('careers.filters.search')}</button>
        </form>
        {!nearFound ? <p className="ox-careers-error">{t('careers.filters.postalNotFound')}</p> : null}
        <LoadError error={error} onRetry={() => load(false)} />
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
        {cursor ? (
          <div className="ox-careers-actions">
            <button type="button" className="ox-careers-btn" disabled={loading} onClick={() => load(true, cursor)}>{t('careers.loadMore')}</button>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
