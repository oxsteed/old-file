import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import ReturnsQueueTable from '../components/ReturnsQueueTable';

// G1-B6 (D-675): the merchant return queue. Returns on orders checked
// out from the helper's own carts only (the server scopes by
// shopping_carts.helper_id, so another merchant's returns never reach
// this page). Read-only: deciding a return is the admin queue's job.
const RETURN_STATUSES = ['', 'requested', 'approved', 'declined', 'refunded', 'cancelled'];

export default function MarketplaceReturnsPage() {
  const { t } = useTranslation();
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (status) params.append('status', status);
        params.append('skip', String(skip));
        params.append('limit', String(limit));
        const res = await api.get(`/carts/returns?${params.toString()}`);
        if (cancelled) return;
        setReturns(res.data?.data || []);
        setTotal(res.data?.pagination?.total || 0);
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || t('marketplaceReturns.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [status, skip, t]);

  const statusLabel = (value) => {
    if (!value) return t('marketplaceReturns.statusAll');
    const key = `marketplaceReturns.status${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    return t(key);
  };

  return (
    <>
      <Navbar />
      <div className="p-6">
        <PageMeta title={t('marketplaceReturns.heading')} description={t('marketplaceReturns.subheadingMerchant')} />

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{t('marketplaceReturns.heading')}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t('marketplaceReturns.subheadingMerchant')}</p>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <label htmlFor="merchant-returns-status" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('marketplaceReturns.colStatus')}
          </label>
          <select
            id="merchant-returns-status"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setSkip(0); }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            {RETURN_STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>{statusLabel(value)}</option>
            ))}
          </select>
        </div>

        {error ? (
          <div className="p-8 text-center text-red-600 dark:text-red-400">
            <p>{error}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
            <ReturnsQueueTable
              returns={returns}
              loading={loading}
              emptyText={t('marketplaceReturns.emptyMerchant')}
              renderOrderLink={(row) => (
                <Link to={`/cart/${row.cartId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  #{row.orderId}
                </Link>
              )}
            />
            {total > 0 && (
              <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-700">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {t('adminOrderManagement.paginationShowing', {
                    from: skip + 1,
                    to: Math.min(skip + limit, total),
                    total,
                  })}
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={skip === 0}
                    onClick={() => setSkip(Math.max(0, skip - limit))}
                    className="rounded px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    {t('adminOrderManagement.previous')}
                  </button>
                  <button
                    disabled={skip + limit >= total}
                    onClick={() => setSkip(skip + limit)}
                    className="rounded px-3 py-1 text-sm font-medium disabled:opacity-50 hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    {t('adminOrderManagement.next')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}
