import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';

const STATUS_OPTIONS = ['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'];

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'delivered'].includes(s)) return 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300';
  if (['cancelled', 'refunded', 'failed'].includes(s)) return 'border-red-800/60 bg-red-950/40 text-red-300';
  if (['preparing', 'accepted'].includes(s)) return 'border-amber-800/60 bg-amber-950/40 text-amber-300';
  return 'border-gray-700 bg-gray-900/60 text-gray-300';
}

export default function AdminFoodOrders() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get('/api/admin/food-orders', {
        params: { status: status || undefined, limit: 20 },
      });
      setOrders(data.orders || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.response?.data?.error || t('common.error', 'Failed to load orders'));
    } finally {
      setLoading(false);
    }
  }, [status, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">{t('admin.foodOrders.kicker')}</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-100">{t('admin.foodOrders.title')}</h1>
        </div>
        <span className="text-sm text-gray-400">{t('admin.foodOrders.count', '{{count}} orders', { count: total })}</span>
      </div>

      <div className="mb-4">
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="rounded-xl border border-gray-800 bg-gray-900/80 px-3 py-2 text-sm text-gray-200"
          aria-label={t('admin.foodOrders.filterStatus')}
        >
          <option value="">{t('admin.foodOrders.allStatuses')}</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{t(`food.status.${s}`, s)}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-900/60" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-800/60 bg-red-950/40 p-4">
          <p className="text-sm text-red-300">{error}</p>
          <button type="button" onClick={load} className="mt-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800">
            {t('common.retry', 'Retry')}
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
                  <th className="pb-2 pr-3">ID</th>
                  <th className="pb-2 pr-3">{t('admin.foodOrders.restaurant')}</th>
                  <th className="pb-2 pr-3">{t('admin.foodOrders.status')}</th>
                  <th className="pb-2 pr-3">{t('admin.foodOrders.total')}</th>
                  <th className="pb-2 pr-3">{t('admin.foodOrders.payment')}</th>
                  <th className="pb-2">{t('admin.foodOrders.created')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-t border-gray-800/60 hover:bg-gray-900/40">
                    <td className="py-2.5 pr-3">
                      <Link to={`/admin/food-orders/${o.id}`} className="font-medium text-blue-400 hover:text-blue-300">#{o.id}</Link>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-200">{o.restaurant_name || '—'}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(o.status)}`}>
                        {t(`food.status.${o.status}`, o.status)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-200">${(Number(o.total_cents || 0) / 100).toFixed(2)}</td>
                    <td className="py-2.5 pr-3 text-gray-400">{o.payment_status || '—'}</td>
                    <td className="py-2.5 text-gray-400">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orders.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-500">{t('admin.foodOrders.empty')}</p>
          )}
        </>
      )}
    </div>
  );
}
