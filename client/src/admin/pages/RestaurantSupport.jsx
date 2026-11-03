import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import RsdPager, { serverErrorMessage } from '../lib/RsdPager';
import { adminDateTime } from '../lib/formatters';

// Admin restaurant support queue (finding 7): list with filters, total, and
// pager. Detail lives at /admin/restaurants/support/cases/:caseId.
const PAGE_LIMIT = 50;

export default function RestaurantSupport() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [ownerType, setOwnerType] = useState('');
  const [restaurantId, setRestaurantId] = useState(searchParams.get('restaurantId') || '');
  const [offset, setOffset] = useState(0);

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/restaurants/support/cases', {
      signal,
      timeout: 15000,
      params: {
        ...(status ? { status } : {}),
        ...(ownerType ? { ownerType } : {}),
        ...(restaurantId ? { restaurantId } : {}),
        limit: PAGE_LIMIT,
        offset,
      },
    });
    return { cases: body?.cases || [], total: body?.total ?? 0 };
  }, [status, ownerType, restaurantId, offset]);

  const cases = data?.cases || [];
  const total = data?.total ?? 0;

  const applyFilter = (setter) => (event) => {
    setter(event.target.value);
    setOffset(0);
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminRestaurantSupport.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminRestaurantSupport.subtitle')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <select value={status} onChange={applyFilter(setStatus)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminRestaurantSupport.allStatuses')}</option>
          {['new', 'awaiting_restaurant', 'awaiting_customer', 'awaiting_oxsteed', 'investigating', 'resolution_offered', 'resolved', 'closed', 'reopened', 'escalated'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select value={ownerType} onChange={applyFilter(setOwnerType)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminRestaurantSupport.allOwners')}</option>
          {['restaurant', 'oxsteed', 'runner', 'shared'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <input
          value={restaurantId}
          onChange={applyFilter(setRestaurantId)}
          placeholder={t('adminRestaurantSupport.restaurantIdPlaceholder')}
          inputMode="numeric"
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
        />
      </div>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={serverErrorMessage(loadError, t('adminRestaurantSupport.loadFailed'))} onRetry={reload} />
      )}
      {!loading && !loadError && cases.length === 0 && (
        <p className="text-gray-500">{t('adminRestaurantSupport.empty')}</p>
      )}
      {!loading && !loadError && cases.length > 0 && (
        <div className="space-y-3">
          {cases.map((supportCase) => (
            <Link
              key={supportCase.id}
              to={`/admin/restaurants/support/cases/${supportCase.id}`}
              className="block rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-orange-500/50"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{supportCase.public_case_number || `#${supportCase.id}`} · {supportCase.title || supportCase.issue_type}</span>
                <span className="text-xs text-gray-400">{supportCase.status} · {supportCase.owner_type}</span>
              </div>
              <p className="mt-1 text-sm text-gray-400">
                {supportCase.restaurant_name || t('adminRestaurantSupport.restaurant', { id: supportCase.restaurant_id })}
                {supportCase.customer_email ? ` · ${supportCase.customer_email}` : ''}
              </p>
              <p className="mt-1 text-xs text-gray-500">{adminDateTime(supportCase.created_at)}</p>
            </Link>
          ))}
        </div>
      )}
      {!loading && !loadError && (
        <RsdPager offset={offset} limit={PAGE_LIMIT} total={total} onPage={setOffset} />
      )}
    </div>
  );
}
