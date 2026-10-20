import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';

// Item 5: AI support chat quality — deflection, handoff and thumbs-down
// rates by page and locale. Collapsed by default; loads on first open.
function pct(v) {
  return v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`;
}

export default function AiChatMetricsPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (span) => {
    setLoading(true);
    setError(false);
    try {
      const { data: d } = await adminApi.get('/admin/support/ai-chat-metrics', { params: { days: span } });
      setData(d);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data) load(days);
  };

  return (
    <section className="rounded-[28px] border border-gray-200 dark:border-gray-800 bg-gray-950/60 p-4" aria-labelledby="ai-chat-metrics-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-chat-metrics-title" className="text-sm font-semibold text-gray-900 dark:text-white">{t('adminSupportTickets.aiMetrics.title')}</h2>
        <div className="flex items-center gap-2">
          {open && (
            <select
              value={days}
              onChange={(e) => { const v = Number(e.target.value); setDays(v); load(v); }}
              aria-label={t('adminSupportTickets.aiMetrics.range')}
              className="rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
            >
              {[7, 30, 90].map((d) => <option key={d} value={d}>{t('adminSupportTickets.aiMetrics.days', { count: d })}</option>)}
            </select>
          )}
          <button type="button" onClick={toggle} aria-expanded={open} className="rounded-lg border border-gray-700 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-800">
            {open ? t('adminSupportTickets.aiMetrics.hide') : t('adminSupportTickets.aiMetrics.show')}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3" aria-busy={loading}>
          {error && <p className="text-xs text-red-400">{t('adminSupportTickets.aiMetrics.failed')}</p>}
          {data && !error && (
            <>
              <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                {[
                  ['replies', data.totals.replies],
                  ['deflection', pct(data.totals.deflection_rate)],
                  ['handoffRate', pct(data.totals.handoff_rate)],
                  ['suggestedRate', pct(data.totals.handoff_suggested_rate)],
                  ['thumbsDownRate', pct(data.totals.thumbs_down_rate)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-gray-800 p-2">
                    <dt className="text-gray-500">{t(`adminSupportTickets.aiMetrics.${k}`)}</dt>
                    <dd className="mt-1 text-base font-semibold text-white" dir="ltr">{v}</dd>
                  </div>
                ))}
              </dl>
              {data.rows.length === 0 ? (
                <p className="mt-3 text-xs text-gray-500">{t('adminSupportTickets.aiMetrics.empty')}</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-start text-xs text-gray-300">
                    <thead className="text-gray-500">
                      <tr>
                        {['page', 'locale', 'replies', 'deflection', 'handoffRate', 'thumbsDownRate'].map((k) => (
                          <th key={k} scope="col" className="px-2 py-1 text-start font-medium">{t(`adminSupportTickets.aiMetrics.${k}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={`${r.page}|${r.locale}`} className="border-t border-gray-800">
                          <td className="px-2 py-1" dir="ltr">{r.page}</td>
                          <td className="px-2 py-1">{r.locale}</td>
                          <td className="px-2 py-1" dir="ltr">{r.replies}</td>
                          <td className="px-2 py-1" dir="ltr">{pct(r.deflection_rate)}</td>
                          <td className="px-2 py-1" dir="ltr">{pct(r.handoff_rate)}</td>
                          <td className="px-2 py-1" dir="ltr">{pct(r.thumbs_down_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.thumbs_down_reasons?.length > 0 && (
                <p className="mt-3 text-xs text-gray-400">
                  {t('adminSupportTickets.aiMetrics.reasons')}{' '}
                  {data.thumbs_down_reasons.map((r) => `${t(`supportWidget.feedbackReason_${r.reason}`)} (${r.count})`).join(' · ')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
