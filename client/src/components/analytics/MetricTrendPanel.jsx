import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { formatAnalyticsCell } from '../../utils/analyticsFormat';
import './MetricTrendPanel.css';

const DAY_OPTIONS = [30, 90, 180, 365];
const WIDTH = 640;
const HEIGHT = 160;

// Daily trend for one governed metric, read from the nightly snapshot store
// (GET /admin/analytics/query-builder/trend). Scoped and audited server-side.
export default function MetricTrendPanel({ metric, regional = false }) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(90);
  const [currency, setCurrency] = useState('USD');
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    api.get('/admin/analytics/query-builder/trend', { params: { metric, days, currency } })
      .then(({ data }) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch(err => { if (!cancelled) setState({ loading: false, error: err?.response?.data?.code || 'error', data: null }); });
    return () => { cancelled = true; };
  }, [metric, days, currency]);

  const data = state.data;
  const locale = i18n.language;
  const format = value => formatAnalyticsCell(metric, value, { currency_code: data?.currency }, locale);
  const numeric = useMemo(() => (data?.points || []).filter(p => p.value != null).map(p => Number(p.value)), [data]);
  const min = numeric.length ? Math.min(...numeric) : null;
  const max = numeric.length ? Math.max(...numeric) : null;
  const latest = [...(data?.points || [])].reverse().find(p => p.value != null);

  const bars = useMemo(() => {
    const points = data?.points || [];
    if (!points.length) return [];
    const lo = Math.min(0, min ?? 0), hi = Math.max(max ?? 0, lo + 1);
    const step = WIDTH / points.length;
    return points.map((p, i) => {
      const v = p.value == null ? null : Number(p.value);
      const h = v == null ? 0 : Math.max(1, ((v - lo) / (hi - lo)) * (HEIGHT - 8));
      return { key: p.date, x: i * step + step * 0.1, w: Math.max(1, step * 0.8), y: HEIGHT - h, h, missing: v == null, title: `${p.date}: ${v == null ? '—' : format(p.value)}` };
    });
  }, [data, min, max]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = latest
    ? t('queryBuilder.trend.summary', { count: data.points.length, latest: format(latest.value), min: format(String(min)), max: format(String(max)) })
    : null;

  return (
    <section className="qb-results metric-trend" aria-busy={state.loading}>
      <div className="metric-trend-head">
        <h2>{t('queryBuilder.trend.title')}</h2>
        <div className="metric-trend-controls">
          <label htmlFor="metric-trend-days">{t('queryBuilder.trend.daysLabel')}</label>
          <select id="metric-trend-days" value={days} onChange={e => setDays(Number(e.target.value))}>
            {DAY_OPTIONS.map(n => <option key={n} value={n}>{t('queryBuilder.trend.daysOption', { count: n })}</option>)}
          </select>
          {data?.currency && (<>
            <label htmlFor="metric-trend-currency">{t('queryBuilder.trend.currencyLabel')}</label>
            <select id="metric-trend-currency" value={currency} onChange={e => setCurrency(e.target.value)}>
              {(data.currencies?.length ? data.currencies : [currency]).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </>)}
        </div>
      </div>
      <p className="qb-hint">{t('queryBuilder.trend.subtitle')}</p>
      {regional && <p className="qb-region-scoped">{t('queryBuilder.regionScopedNotice')}</p>}
      {data?.valueKind === 'point_in_time' && <p className="qb-hint">{t('queryBuilder.trend.pointInTime')}</p>}
      {data?.definitionChanged && <p className="qb-truncated">{t('queryBuilder.trend.definitionChanged')}</p>}
      {state.loading && <p className="qb-loading">{t('queryBuilder.trend.loading')}</p>}
      {state.error && <p role="alert">{state.error === 'metric_permission_required' ? t('queryBuilder.errorPermissionRequired')
        : state.error === 'region_unknown' ? t('queryBuilder.errorRegionUnknown') : t('queryBuilder.trend.error')}</p>}
      {!state.loading && !state.error && data && !data.points.length && <p>{t('queryBuilder.trend.empty')}</p>}
      {!state.loading && data?.points?.length > 0 && (<>
        <figure className="metric-trend-chart" dir="ltr">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={summary || t('queryBuilder.trend.title')}>
            {bars.map(b => (
              <rect key={b.key} x={b.x} y={b.missing ? HEIGHT - 2 : b.y} width={b.w} height={b.missing ? 2 : b.h}
                className={b.missing ? 'metric-trend-missing' : 'metric-trend-bar'}><title>{b.title}</title></rect>
            ))}
          </svg>
          <figcaption dir="auto">
            <span>{data.points[0].date}</span><span>{data.points[data.points.length - 1].date}</span>
          </figcaption>
        </figure>
        {summary && <p className="metric-trend-summary">{summary}</p>}
        {data.lastComputedAt && <p className="qb-hint">{t('queryBuilder.trend.lastUpdated', { time: new Date(data.lastComputedAt).toLocaleString(locale) })}</p>}
        <details className="metric-trend-data">
          <summary>{t('queryBuilder.trend.showData')}</summary>
          <div className="qb-table-wrap"><table className="qb-table">
            <thead><tr><th>{t('queryBuilder.trend.date')}</th><th>{t('queryBuilder.trend.value')}</th></tr></thead>
            <tbody>{[...data.points].reverse().map(p => <tr key={p.date}><td>{p.date}</td><td>{format(p.value)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>)}
    </section>
  );
}
