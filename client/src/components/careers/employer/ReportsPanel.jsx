import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getHiringReport } from '../../../api/careers';
import { Empty, Loading, LoadError, useLoad } from '../ui';

const pct = (v) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);

export default function ReportsPanel({ ctx }) {
  const { t } = useTranslation();
  const [since, setSince] = useState('');
  const report = useLoad(() => getHiringReport(ctx.businessId, since ? { since } : {}), [ctx.businessId, since]);
  const r = report.data;
  const funnel = r?.funnel || {};
  return (
    <div className="ox-careers-grid">
      <div className="ox-careers-row">
        <label htmlFor="rep-since">{t('careers.reports.since')}</label>
        <input id="rep-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
      </div>
      {report.loading && !r ? <Loading /> : null}
      <LoadError error={report.error} onRetry={report.reload} />
      {r ? (
        <>
          <section className="ox-careers-panel">
            <h2>{t('careers.reports.funnel')}</h2>
            {Object.keys(funnel).length ? (
              <table className="ox-careers-table">
                <tbody>{Object.entries(funnel).map(([stage, n]) => <tr key={stage}><td>{t(`careers.stage.${stage}`)}</td><td>{n}</td></tr>)}</tbody>
              </table>
            ) : <Empty>{t('careers.reports.empty')}</Empty>}
          </section>
          <section className="ox-careers-panel">
            <h2>{t('careers.reports.stores')}</h2>
            {r.stores?.length ? (
              <table className="ox-careers-table">
                <thead><tr><th>{t('careers.reports.store')}</th><th>{t('careers.reports.hires')}</th><th>{t('careers.reports.days')}</th><th>{t('careers.reports.acceptance')}</th><th>{t('careers.reports.retention')}</th></tr></thead>
                <tbody>
                  {r.stores.map((s) => (
                    <tr key={s.location_id ?? 'none'}>
                      <td>{s.location_name || t('careers.reports.noStore')}</td>
                      <td>{s.hires}</td>
                      <td>{s.median_days_to_hire ?? '—'}</td>
                      <td>{pct(s.offer_acceptance_rate)}</td>
                      <td>{pct(s.retention_90d)}{s.retention_90d_sample ? ` (n=${s.retention_90d_sample})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>{t('careers.reports.empty')}</Empty>}
          </section>
          {r.regions?.length ? (
            <section className="ox-careers-panel">
              <h2>{t('careers.reports.regions')}</h2>
              <table className="ox-careers-table">
                <thead><tr><th>{t('careers.scopes.region')}</th><th>{t('careers.reports.hires')}</th><th>{t('careers.reports.retention')}</th></tr></thead>
                <tbody>{r.regions.map((g) => <tr key={g.region_id ?? 'none'}><td>{g.region_name || t('careers.reports.noRegion')}</td><td>{g.hires}</td><td>{pct(g.retention_90d)}</td></tr>)}</tbody>
              </table>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
