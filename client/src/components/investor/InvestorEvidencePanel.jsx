import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import api from '../../api/axios';

// Aggregate-only drill-through for investor KPIs (GET /investor/evidence/:metric).
// Shows how a KPI is made up by period bucket, currency and source. There are
// no records, names or ids in the response; buckets with fewer than
// `min_cell` records come back suppressed and are shown as such.

const METRICS = ['platform_revenue_cents', 'job_completion_rate_pct', 'investor_gmv_cents', 'investor_take_rate_pct'];

export default function InvestorEvidencePanel({ period }) {
  const { t, i18n } = useTranslation();
  const [metric, setMetric] = useState(null);
  const [state, setState] = useState({ status: 'idle', data: null });

  useEffect(() => {
    if (!metric) return undefined;
    const controller = new AbortController();
    setState({ status: 'loading', data: null });
    api.get(`/investor/evidence/${metric}`, { params: { period }, signal: controller.signal })
      .then(({ data }) => setState({ status: 'ready', data }))
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'CanceledError') return;
        setState({ status: 'error', data: null });
      });
    return () => controller.abort();
  }, [metric, period]);

  const money = (cents, code) => {
    if (cents == null) return '—';
    try { return new Intl.NumberFormat(i18n.language, { style: 'currency', currency: code || 'USD' }).format(Number(cents) / 100); }
    catch { return `${(Number(cents) / 100).toFixed(2)} ${code || ''}`; }
  };
  const count = (n) => (n == null ? '—' : new Intl.NumberFormat(i18n.language).format(Number(n)));
  const date = (v) => (v ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(v)) : t('investorDashboard.evidence.allTime'));
  const data = state.data;

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900 p-5" aria-labelledby="investor-evidence-title">
      <div className="flex items-center justify-between mb-2">
        <h2 id="investor-evidence-title" className="font-semibold text-sm text-gray-200">{t('investorDashboard.evidence.title')}</h2>
        <Layers size={15} className="text-gray-500" aria-hidden="true" />
      </div>
      <p className="text-xs text-gray-500 mb-3">{t('investorDashboard.evidence.help')}</p>
      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={t('investorDashboard.evidence.title')}>
        {METRICS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            aria-pressed={metric === m}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${metric === m ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-gray-950 border-gray-800 text-gray-400 hover:text-white'}`}
          >
            {t(`investorDashboard.evidence.metrics.${m}`)}
          </button>
        ))}
      </div>
      {state.status === 'loading' && <p role="status" className="text-xs text-gray-500">{t('investorDashboard.evidence.loading')}</p>}
      {state.status === 'error' && <p role="alert" className="text-xs text-red-400">{t('investorDashboard.evidence.loadError')}</p>}
      {state.status === 'ready' && data && (
        <div className="overflow-x-auto">
          {!data.period_sensitive && <p className="text-xs text-gray-500 mb-2">{t('investorDashboard.evidence.allTimeNote')}</p>}
          <table className="w-full text-xs text-start text-gray-300">
            <thead className="text-gray-500">
              <tr>
                <th scope="col" className="py-1 pe-3 text-start">{t('investorDashboard.evidence.bucket')}</th>
                <th scope="col" className="py-1 pe-3 text-start">{t('investorDashboard.evidence.currency')}</th>
                <th scope="col" className="py-1 pe-3 text-start">{t('investorDashboard.evidence.source')}</th>
                <th scope="col" className="py-1 pe-3 text-end">{t('investorDashboard.evidence.records')}</th>
                <th scope="col" className="py-1 text-end">{t('investorDashboard.evidence.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.length === 0 && (
                <tr><td colSpan={5} className="py-2 text-gray-500">{t('investorDashboard.noData')}</td></tr>
              )}
              {data.buckets.map((row, index) => (
                <tr key={`${row.bucket}-${row.currency_code}-${row.source_type}-${index}`} className="border-t border-gray-800">
                  <td className="py-1 pe-3">{date(row.bucket)}</td>
                  <td className="py-1 pe-3"><bdi>{row.currency_code || '—'}</bdi></td>
                  <td className="py-1 pe-3">{row.source_type ? t(`investorDashboard.evidence.sources.${row.source_type === 'subscription' ? 'subscription' : 'job_fee'}`) : '—'}</td>
                  {row.suppressed ? (
                    <td colSpan={2} className="py-1 text-end text-gray-500">{t('investorDashboard.evidence.suppressed', { count: data.min_cell })}</td>
                  ) : (
                    <>
                      <td className="py-1 pe-3 text-end">{count(row.records)}</td>
                      <td className="py-1 text-end">
                        {row.amount_cents != null && money(row.amount_cents, row.currency_code)}
                        {row.gmv_cents != null && t('investorDashboard.evidence.gmvFee', { gmv: money(row.gmv_cents, row.currency_code), fee: money(row.fee_cents, row.currency_code) })}
                        {row.completed != null && t('investorDashboard.evidence.completedCancelled', { completed: count(row.completed), cancelled: count(row.cancelled) })}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
