import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadHiringAnalyticsCsv, getHiringAnalytics } from '../../../api/careers';
import { ActionButton, Empty, Loading, LoadError, useLoad } from '../ui';
import { saveBlob } from './shared';

const TOTALS = ['impressions', 'views', 'apply_starts', 'applications', 'interviewed', 'offered', 'hires', 'screened_out'];
const pct = (v) => (v == null ? '—' : `${v}%`);

/** Funnel per opening (views → applies → interviews → offers → hires), with CSV export. */
export default function AnalyticsPanel({ ctx }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const data = useLoad(() => getHiringAnalytics(ctx, days), [ctx.employerType, ctx.businessId, days]);
  const d = data.data;
  const max = Math.max(1, ...((d?.daily || []).map((x) => x.views || 0)));
  return (
    <div className="ox-careers-grid">
      <div className="ox-careers-actions">
        <select aria-label={t('careers.mk.analytics.range')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((n) => <option key={n} value={n}>{t('careers.mk.analytics.lastDays', { count: n })}</option>)}
        </select>
        <ActionButton onClick={async () => saveBlob(await downloadHiringAnalyticsCsv(ctx, days), `hiring-analytics-${days}d.csv`)}>{t('careers.mk.analytics.csv')}</ActionButton>
      </div>
      {data.loading && !d ? <Loading /> : null}
      <LoadError error={data.error} onRetry={data.reload} />
      {d ? (
        <>
          <div className="ox-careers-facts">
            {TOTALS.map((k) => <span key={k} className="ox-careers-chip"><strong>{d.totals?.[k] ?? 0}</strong> {t(`careers.mk.analytics.metric.${k}`)}</span>)}
          </div>
          {(d.daily || []).length ? (
            <section className="ox-careers-section">
              <h3>{t('careers.mk.analytics.dailyViews')}</h3>
              <ol className="ox-careers-bars" aria-label={t('careers.mk.analytics.dailyViews')}>
                {d.daily.map((x) => (
                  <li key={x.day} title={`${String(x.day).slice(0, 10)}: ${x.views}`}>
                    <span className="ox-careers-bar" data-h={Math.round(((x.views || 0) / max) * 10)} />
                    <span className="ox-careers-visually-hidden">{`${String(x.day).slice(0, 10)}: ${x.views}`}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {!(d.openings || []).length ? <Empty>{t('careers.employer.noOpenings')}</Empty> : (
            <div className="ox-careers-scroll">
              <table className="ox-careers-table">
                <thead>
                  <tr>
                    <th scope="col">{t('careers.talent.opening')}</th>
                    {['views', 'apply_starts', 'applications', 'interviewed', 'hires'].map((k) => <th key={k} scope="col">{t(`careers.mk.analytics.metric.${k}`)}</th>)}
                    <th scope="col">{t('careers.mk.analytics.applyRate')}</th>
                    <th scope="col">{t('careers.mk.analytics.firstResponse')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.openings.map((o) => (
                    <tr key={o.id}>
                      <th scope="row">{o.title}</th>
                      {['views', 'apply_starts', 'applications', 'interviewed', 'hires'].map((k) => <td key={k}>{o[k]}</td>)}
                      <td>{pct(o.apply_rate)}</td>
                      <td>{o.median_first_response_hours == null ? '—' : t('careers.mk.analytics.hours', { count: Number(o.median_first_response_hours) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
