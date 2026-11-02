import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import { serverErrorMessage } from '../lib/RsdPager';
import { adminMoney } from '../lib/formatters';

// Admin restaurant detail (finding 20): suspend and verify, reusing the
// tombstone suspension. Restore lands on paused, never active, so a
// suspended restaurant never silently re-lists; the owner re-activates it.
export default function AdminRestaurantDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(null);

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get(`/admin/restaurants/${id}`, { signal, timeout: 15000 });
    return body;
  }, [id]);

  const restaurant = data?.restaurant || null;

  const runAction = async (path, body, successKey) => {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await adminApi.post(`/admin/restaurants/${id}${path}`, body);
      setNotice(t(successKey));
      reload();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('adminRestaurantDetail.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <Link to="/admin/restaurants" className="text-sm text-orange-400 hover:underline">
        {t('adminRestaurantDetail.backToList')}
      </Link>
      {loading && <p className="mt-4 text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <div className="mt-4">
          <AdminErrorState message={serverErrorMessage(loadError, t('adminRestaurantDetail.loadFailed'))} onRetry={reload} />
        </div>
      )}
      {!loading && !loadError && !restaurant && (
        <p className="mt-4 text-gray-500">{t('adminRestaurantDetail.empty')}</p>
      )}
      {!loading && !loadError && restaurant && (
        <div className="mt-4 space-y-6">
          <div>
            <h1 className="text-xl font-bold text-white">{restaurant.display_name}</h1>
            <p className="mt-1 text-sm text-gray-400">
              {restaurant.status}
              {restaurant.is_verified ? ` · ${t('adminRestaurantDetail.verified')}` : ` · ${t('adminRestaurantDetail.unverified')}`}
              {` · ${t('adminRestaurantDetail.business', { name: restaurant.business_name })}`}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {restaurant.address_city || ''}
              {restaurant.address_state ? `, ${restaurant.address_state}` : ''}
              {` · ${restaurant.currency_code || ''}`}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {t('adminRestaurantDetail.supportCounts', { open: data?.support?.open_cases ?? 0, total: data?.support?.total ?? 0 })}
              {` · ${t('adminRestaurantDetail.walletCounts', { count: data?.wallets?.wallets ?? 0, balance: adminMoney(Number(data?.wallets?.total_balance_cents || 0), restaurant.currency_code || 'USD') })}`}
            </p>
          </div>

          {actionError && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
          )}
          {notice && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>
          )}

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 font-semibold text-white">{t('adminRestaurantDetail.actionsTitle')}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirm({ path: '/suspend', title: t('adminRestaurantDetail.suspend'), body: {}, success: 'adminRestaurantDetail.suspended' })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {t('adminRestaurantDetail.suspend')}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm({ path: '/restore', title: t('adminRestaurantDetail.restore'), body: {}, success: 'adminRestaurantDetail.restored' })} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {t('adminRestaurantDetail.restore')}
              </button>
              <button type="button" disabled={busy} onClick={() => runAction('/verify', { verified: !restaurant.is_verified }, 'adminRestaurantDetail.verifyDone')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-200">
                {restaurant.is_verified ? t('adminRestaurantDetail.unverify') : t('adminRestaurantDetail.verify')}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500">{t('adminRestaurantDetail.restoreNote')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('adminRestaurantDetail.suspendNote')}</p>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 font-semibold text-white">{t('adminRestaurantDetail.relatedTitle')}</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <Link to={`/admin/restaurants/support?restaurantId=${restaurant.id}`} className="text-orange-400 hover:underline">
                {t('adminRestaurantDetail.supportLink')}
              </Link>
              <Link to={`/admin/super/business-audit?restaurantId=${restaurant.id}`} className="text-orange-400 hover:underline">
                {t('adminRestaurantDetail.auditLink')}
              </Link>
              <Link to={`/admin/super/restaurant-analytics?restaurantId=${restaurant.id}`} className="text-orange-400 hover:underline">
                {t('adminRestaurantDetail.analyticsLink')}
              </Link>
            </div>
          </section>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          message={t('adminRestaurantDetail.confirmAction')}
          confirmLabel={confirm.title}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await runAction(confirm.path, confirm.body, confirm.success);
          }}
        />
      )}
    </div>
  );
}
