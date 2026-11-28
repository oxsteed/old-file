import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import api from '../../api/axios';

// Slice 5f, item 726 (D-769): the entity summary for the investor
// reporting dashboard. One card per entity in the viewer's audience
// scope: the business identity, its live/total raises, and the viewer's
// own live stakes in it. A position holder sees exactly their audience
// entities; an admin sees the platform-wide list, labeled as such.
// The section is best-effort like the rest of the dashboard: a load
// failure shows a line, never a page error.

const BUSINESS_TYPES = ['llc', 'sole_prop', 'corp', 'partnership'];

export default function EntityReportingSection() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    const controller = new AbortController();
    api.get('/investor/reporting/entities', { signal: controller.signal })
      .then(({ data }) => setState({ status: 'ready', data }))
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'CanceledError') return;
        setState({ status: 'error', data: null });
      });
    return () => controller.abort();
  }, []);

  const count = (n) => new Intl.NumberFormat(i18n.language).format(Number(n ?? 0));
  const date = (v) => (v ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(v)) : null);
  const data = state.data;
  const entities = data?.entities ?? [];
  const audience = data?.audience ?? null;
  const platformWide = data?.scope?.type === 'platform_wide';

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5" aria-labelledby="entity-reporting-title">
      <div className="flex items-center justify-between mb-2">
        <h2 id="entity-reporting-title" className="font-semibold text-sm text-gray-200">{t('investorDashboard.entityReporting.title')}</h2>
        <Building2 size={15} className="text-gray-500" aria-hidden="true" />
      </div>
      <p className="text-xs text-gray-500 mb-3">{t('investorDashboard.entityReporting.help')}</p>
      {platformWide && (
        <p className="text-xs text-gray-400 mb-3">{t('investorDashboard.scope.platformWide')}</p>
      )}
      {audience && (
        <p className="text-xs text-gray-400 mb-3">
          {t('investorDashboard.entityReporting.audienceKey', { key: audience.key || '—' })}
          {' · '}
          {audience.expiresAt
            ? t('investorDashboard.entityReporting.audienceExpires', { date: date(audience.expiresAt) })
            : t('investorDashboard.entityReporting.audienceNoExpiry')}
        </p>
      )}
      {state.status === 'loading' && <p role="status" className="text-xs text-gray-500">{t('investorDashboard.entityReporting.loading')}</p>}
      {state.status === 'error' && <p role="alert" className="text-xs text-red-400">{t('investorDashboard.entityReporting.loadError')}</p>}
      {state.status === 'ready' && entities.length === 0 && (
        <p className="text-xs text-gray-500">{t('investorDashboard.entityReporting.empty')}</p>
      )}
      {state.status === 'ready' && entities.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {entities.map((entity) => (
            <li key={entity.entityId} className="rounded-xl bg-gray-800/50 border border-gray-800 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-white">{entity.businessName}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${entity.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                  {entity.isActive ? t('investorDashboard.entityReporting.active') : t('investorDashboard.entityReporting.inactive')}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {entity.businessType && BUSINESS_TYPES.includes(entity.businessType)
                  ? t(`investorDashboard.entityReporting.types.${entity.businessType}`)
                  : t('investorDashboard.entityReporting.types.unknown')}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                {t('investorDashboard.entityReporting.opportunities', {
                  live: count(entity.opportunities?.live),
                  total: count(entity.opportunities?.total),
                })}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {t('investorDashboard.entityReporting.stakesPositions', { count: Number(entity.stakes?.positions ?? 0) })}
                {' · '}
                {t('investorDashboard.entityReporting.stakesCommitments', { count: Number(entity.stakes?.commitments ?? 0) })}
                {' · '}
                {t('investorDashboard.entityReporting.stakesApplications', { count: Number(entity.stakes?.applications ?? 0) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
