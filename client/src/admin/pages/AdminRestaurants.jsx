import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import RsdPager, { serverErrorMessage } from '../lib/RsdPager';

// Admin restaurant list (finding 20): the food_restaurants entity finally
// has a list surface with search, status and verification filters, a total,
// and a pager. Detail, suspend, verify, and restore live on the detail page.
const PAGE_LIMIT = 25;

export default function AdminRestaurants() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [verified, setVerified] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    const { data: body } = await adminApi.get('/admin/restaurants', {
      signal,
      timeout: 15000,
      params: {
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(verified ? { verified } : {}),
        limit: PAGE_LIMIT,
        offset,
      },
    });
    return { restaurants: body?.restaurants || [], total: body?.total ?? 0 };
  }, [search, status, verified, offset]);

  const restaurants = data?.restaurants || [];
  const total = data?.total ?? 0;
  const applyFilter = (setter) => (event) => {
    setter(event.target.value);
    setOffset(0);
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminRestaurants.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminRestaurants.subtitle')}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={applyFilter(setSearch)}
          placeholder={t('adminRestaurants.searchPlaceholder')}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
        />
        <select value={status} onChange={applyFilter(setStatus)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminRestaurants.allStatuses')}</option>
          {['draft', 'active', 'paused', 'suspended'].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select value={verified} onChange={applyFilter(setVerified)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
          <option value="">{t('adminRestaurants.allVerified')}</option>
          <option value="true">{t('adminRestaurants.verifiedOnly')}</option>
          <option value="false">{t('adminRestaurants.unverifiedOnly')}</option>
        </select>
      </div>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={serverErrorMessage(loadError, t('adminRestaurants.loadFailed'))} onRetry={reload} />
      )}
      {!loading && !loadError && restaurants.length === 0 && (
        <p className="text-gray-500">{t('adminRestaurants.empty')}</p>
      )}
      {!loading && !loadError && restaurants.length > 0 && (
        <div className="space-y-3">
          {restaurants.map((restaurant) => (
            <Link
              key={restaurant.id}
              to={`/admin/restaurants/${restaurant.id}`}
              className="block rounded-xl border border-slate-800 bg-slate-900 p-4 hover:border-orange-500/50"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{restaurant.display_name}</span>
                <span className="text-xs text-gray-400">
                  {restaurant.status}
                  {restaurant.is_verified ? ` · ${t('adminRestaurants.verified')}` : ` · ${t('adminRestaurants.unverified')}`}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-400">
                {restaurant.business_name}
                {restaurant.address_city ? ` · ${restaurant.address_city}` : ''}
                {` · ${t('adminRestaurants.openCases', { count: restaurant.open_support_cases ?? 0 })}`}
              </p>
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
