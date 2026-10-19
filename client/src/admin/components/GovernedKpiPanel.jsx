import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import StatCard from './StatCard';
import { analyticsEvidenceHref } from '../../utils/analyticsEvidenceLink';

// Governed registry metrics for a dashboard, computed server-side with the
// query builder's own SQL, grant and region filter
// (GET /admin/analytics/governed-kpis). Every card links to the builder's
// underlying-record evidence for the same metric, period and filters.
// Ungranted metrics show "permission required" and no value (fail closed).

const UNITS = {
  platform_revenue_cents: 'cents', promo_discount_cents: 'cents', mrr_cents: 'cents', escrow_held_cents: 'cents',
  investor_gmv_cents: 'cents', payout_failure_count: 'count', open_disputes: 'count', support_nps_index: 'index',
  consulting_avg_nps: 'average',
};

export function formatGovernedValue(metric, row, language) {
  if (row?.value == null) return null;
  const unit = UNITS[metric] || 'pct';
  if (unit === 'cents') {
    const code = row.currency_code || 'USD';
    try {
      return new Intl.NumberFormat(language, { style: 'currency', currency: code }).format(row.value / 100);
    } catch {
      return `${(row.value / 100).toFixed(2)} ${code}`;
    }
  }
  if (unit === 'count') return new Intl.NumberFormat(language).format(row.value);
  if (unit === 'index') return `${row.value > 0 ? '+' : ''}${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(row.value)}`;
  if (unit === 'average') return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(row.value);
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 2 }).format(row.value / 100);
}

export default function GovernedKpiPanel({ metrics, period = '30d', customerId = null, titleKey = 'governedKpis.title' }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ status: 'loading', kpis: [] });
  const metricList = metrics.join(',');

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', kpis: [] });
    adminApi.get('/admin/analytics/governed-kpis', {
      params: { metrics: metricList, period, ...(customerId ? { customerId } : {}) },
      signal: controller.signal,
    })
      .then(({ data }) => setState({ status: 'ready', kpis: data?.kpis || [] }))
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'CanceledError') return;
        setState({ status: 'error', kpis: [] });
      });
    return () => controller.abort();
  }, [metricList, period, customerId]);

  const cards = [];
  for (const kpi of state.kpis) {
    const label = t(`queryBuilder.metricNames.${kpi.metric}`);
    if (!kpi.permitted) {
      cards.push(<StatCard key={kpi.metric} label={label} value={t('governedKpis.permissionRequired')} />);
      continue;
    }
    if (kpi.error) {
      cards.push(<StatCard key={kpi.metric} label={label} value={t('governedKpis.unavailable')} />);
      continue;
    }
    const href = analyticsEvidenceHref(kpi.metric, kpi.period, kpi.filters);
    const rows = kpi.values.length ? kpi.values : [{ value: null }];
    rows.forEach((row, index) => {
      const value = formatGovernedValue(kpi.metric, row, i18n.language);
      const subtitle = row.denominator != null
        ? t('governedKpis.ofDenominator', { numerator: row.numerator ?? '-', denominator: row.denominator })
        : (kpi.scope === 'regional' ? t('governedKpis.regional') : t('governedKpis.viewEvidence'));
      cards.push(
        <StatCard
          key={`${kpi.metric}-${row.currency_code || row.cohort || index}`}
          label={row.currency_code ? `${label} · ${row.currency_code}` : label}
          value={value ?? t('governedKpis.noData')}
          subtitle={subtitle}
          href={href}
        />
      );
    });
  }

  return (
    <section aria-labelledby="governed-kpis-title" className="mb-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={15} className="text-emerald-500" aria-hidden="true" />
        <h2 id="governed-kpis-title" className="text-sm font-semibold text-gray-900 dark:text-white">{t(titleKey)}</h2>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t('governedKpis.help', { period: t(`governedKpis.period.${period}`) })}</p>
      {state.status === 'loading' && <p role="status" className="text-xs text-gray-500">{t('governedKpis.loading')}</p>}
      {state.status === 'error' && <p role="alert" className="text-xs text-red-500">{t('governedKpis.loadError')}</p>}
      {state.status === 'ready' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">{cards}</div>
      )}
    </section>
  );
}
