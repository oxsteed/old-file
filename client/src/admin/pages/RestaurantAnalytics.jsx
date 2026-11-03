import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import AdminErrorState from '../lib/AdminErrorState';
import { serverErrorMessage } from '../lib/RsdPager';
import { adminMoney } from '../lib/formatters';

// Admin restaurant analytics roll-up (finding 54, admin half): read-only
// views over the existing merchant report controllers, so an admin can
// compare restaurant performance and verify merchant-reported numbers with
// the same endpoints merchants see. The merchant report surfaces themselves
// are a separate track and are not rebuilt here.
export default function RestaurantAnalytics() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [idsInput, setIdsInput] = useState(searchParams.get('restaurantId') || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [detailError, setDetailError] = useState('');

  const load = async (event) => {
    event?.preventDefault();
    const ids = idsInput.split(',').map((value) => Number.parseInt(value.trim(), 10)).filter((value) => Number.isInteger(value) && value > 0);
    if (!ids.length) {
      setLoadError(t('adminRestaurantAnalytics.idsRequired'));
      return;
    }
    setLoading(true);
    setLoadError('');
    setRows([]);
    setSelected(null);
    try {
      const params = {
        ...(from ? { from_date: from } : {}),
        ...(to ? { to_date: to } : {}),
      };
      const results = await Promise.all(ids.map(async (id) => {
        try {
          const { data } = await adminApi.get(`/admin/super/restaurants/${id}/reports/sales`, { timeout: 15000, params });
          return { id, ok: true, sales: data };
        } catch (err) {
          return { id, ok: false, error: serverErrorMessage(err, t('adminRestaurantAnalytics.loadFailed')) };
        }
      }));
      setRows(results);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id) => {
    setDetailError('');
    try {
      const params = {
        ...(from ? { from_date: from } : {}),
        ...(to ? { to_date: to } : {}),
      };
      const [inventory, operations, loyalty] = await Promise.all([
        adminApi.get(`/admin/super/restaurants/${id}/reports/inventory`, { timeout: 15000, params }).then((res) => res.data),
        adminApi.get(`/admin/super/restaurants/${id}/reports/operations`, { timeout: 15000, params }).then((res) => res.data),
        adminApi.get(`/admin/super/restaurants/${id}/reports/loyalty`, { timeout: 15000, params }).then((res) => res.data),
      ]);
      setSelected({ id, inventory, operations, loyalty });
    } catch (err) {
      setDetailError(serverErrorMessage(err, t('adminRestaurantAnalytics.loadFailed')));
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminRestaurantAnalytics.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminRestaurantAnalytics.subtitle')}</p>

      <form onSubmit={load} className="mb-4 flex flex-wrap gap-2">
        <input value={idsInput} onChange={(event) => setIdsInput(event.target.value)} placeholder={t('adminRestaurantAnalytics.idsPlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <button type="submit" disabled={loading} className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {t('adminRestaurantAnalytics.compare')}
        </button>
      </form>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && <AdminErrorState message={loadError} onRetry={load} />}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="bg-slate-900 text-gray-400">
              <tr>
                <th className="px-3 py-2">{t('adminRestaurantAnalytics.restaurant')}</th>
                <th className="px-3 py-2">{t('adminRestaurantAnalytics.orders')}</th>
                <th className="px-3 py-2">{t('adminRestaurantAnalytics.revenue')}</th>
                <th className="px-3 py-2">{t('adminRestaurantAnalytics.refunds')}</th>
                <th className="px-3 py-2">{t('adminRestaurantAnalytics.avgTicket')}</th>
                <th className="px-3 py-2">{t('adminRestaurantAnalytics.detail')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-gray-200">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">{row.id}</td>
                  {row.ok ? (
                    <>
                      <td className="px-3 py-2">{row.sales?.totals?.orders ?? 0}</td>
                      <td className="px-3 py-2">{adminMoney(Number(row.sales?.totals?.revenue_cents || 0), row.sales?.currency || 'USD')}</td>
                      <td className="px-3 py-2">{adminMoney(Number(row.sales?.totals?.refunds_cents || 0), row.sales?.currency || 'USD')}</td>
                      <td className="px-3 py-2">{adminMoney(Number(row.sales?.totals?.avg_ticket_cents || 0), row.sales?.currency || 'USD')}</td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => loadDetail(row.id)} className="text-orange-400 hover:underline">
                          {t('adminRestaurantAnalytics.viewDetail')}
                        </button>
                      </td>
                    </>
                  ) : (
                    <td colSpan="5" className="px-3 py-2 text-sm text-red-300">{row.error}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailError && (
        <div className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{detailError}</div>
      )}
      {selected && (
        <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 font-semibold text-white">{t('adminRestaurantAnalytics.detailTitle', { id: selected.id })}</h2>
          <p className="text-sm text-gray-300">
            {t('adminRestaurantAnalytics.inventoryCounts', {
              low: selected.inventory?.low_stock_count ?? 0,
              out: selected.inventory?.out_of_stock_count ?? 0,
            })}
          </p>
          <p className="mt-1 text-sm text-gray-300">
            {t('adminRestaurantAnalytics.operationsCounts', {
              checklists: selected.operations?.checklists?.completed ?? 0,
              audits: selected.operations?.audits?.completed ?? 0,
              actions: selected.operations?.audits?.open_corrective_actions ?? 0,
            })}
          </p>
          {selected.loyalty && (
            <pre className="mt-3 overflow-x-auto rounded bg-slate-800 p-2 text-xs text-gray-300">
              {JSON.stringify(selected.loyalty, null, 2)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
