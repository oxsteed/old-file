import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import CountrySelect from '../components/CountrySelect';
import { useAuth } from '../context/AuthContext';
import { listPublicCareerOpenings } from '../api/careers';
import '../styles/CareerSystem.css';

export default function CareersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { businessId } = useParams();
  const [query, setQuery] = useState({ q: '', country: '', workplace: '', employer: businessId ? 'business' : '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    listPublicCareerOpenings({
      ...query,
      business_id: businessId || undefined,
      employer: query.employer || undefined,
      country: query.country || undefined,
      workplace: query.workplace || undefined,
      q: query.q || undefined,
    })
      .then((data) => { if (active) setRows(data.openings || []); })
      .catch(() => { if (active) setError(t('careers.loadError')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, businessId, t]);

  return (
    <PageShell>
      <PageMeta title={t('careers.metaTitle')} description={t('careers.metaDesc')} />
      <div className="ox-careers">
        <p className="ox-careers-kicker">{t('careers.kicker')}</p>
        <h1>{businessId ? t('careers.businessTitle') : t('careers.title')}</h1>
        <p className="ox-careers-lead">{t('careers.subtitle')}</p>
        {user && (
          <div className="ox-careers-actions" style={{ marginTop: 0, marginBottom: '1rem' }}>
            <Link className="ox-careers-btn" to="/careers/me">{t('careers.myApplications')}</Link>
          </div>
        )}
        <div className="ox-careers-filters">
          <input
            value={query.q}
            onChange={(e) => setQuery((prev) => ({ ...prev, q: e.target.value }))}
            placeholder={t('careers.searchPlaceholder')}
          />
          <CountrySelect value={query.country} onChange={(country) => setQuery((prev) => ({ ...prev, country }))} />
          <select value={query.workplace} onChange={(e) => setQuery((prev) => ({ ...prev, workplace: e.target.value }))}>
            <option value="">{t('careers.filters.allWorkplaces')}</option>
            <option value="remote">{t('careers.workplace.remote')}</option>
            <option value="hybrid">{t('careers.workplace.hybrid')}</option>
            <option value="onsite">{t('careers.workplace.onsite')}</option>
          </select>
          {!businessId && (
            <select value={query.employer} onChange={(e) => setQuery((prev) => ({ ...prev, employer: e.target.value }))}>
              <option value="">{t('careers.filters.allEmployers')}</option>
              <option value="platform">{t('careers.filters.oxsteed')}</option>
              <option value="business">{t('careers.filters.businesses')}</option>
            </select>
          )}
        </div>
        {error && <p className="ox-careers-error">{error}</p>}
        {loading ? <p>{t('careers.loading')}</p> : rows.length === 0 ? (
          <p>{t('careers.noOpenings')}</p>
        ) : (
          <div className="ox-careers-grid">
            {rows.map((row) => (
              <Link key={row.id} className="ox-careers-card" to={`/careers/${row.id}`}>
                <p className="ox-careers-kicker">{row.employer_name}</p>
                <h2 style={{ fontSize: '1.15rem', margin: '0.35rem 0' }}>{row.title}</h2>
                <div className="ox-careers-meta">
                  <span className="ox-careers-chip">{t(`careers.workplace.${row.workplace_type}`)}</span>
                  <span className="ox-careers-chip">{t(`careers.employment.${row.employment_type}`)}</span>
                  <span className="ox-careers-chip">{row.city || row.country_code || t('careers.remoteWorldwide')}</span>
                </div>
                <p>{t('careers.viewRole')}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
