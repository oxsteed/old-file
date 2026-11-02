import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import RsdPager, { serverErrorMessage } from '../lib/RsdPager';
import { adminDateTime } from '../lib/formatters';

// Admin reader over business_audit_log (finding 53). This reads the trail
// pay-run actions, wallet operator actions, and restaurant status changes
// already write to; it does not mirror rows into the admin log.
const PAGE_LIMIT = 50;

export default function BusinessAuditLog() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [businessId, setBusinessId] = useState(searchParams.get('businessId') || '');
  const [restaurantId, setRestaurantId] = useState(searchParams.get('restaurantId') || '');
  const [actionPrefix, setActionPrefix] = useState('');
  const [offset, setOffset] = useState(0);
  const [submitted, setSubmitted] = useState({
    businessId: searchParams.get('businessId') || '',
    restaurantId: searchParams.get('restaurantId') || '',
    actionPrefix: '',
  });

  const { data, loading, error: loadError, reload } = useAbortableFetch(async (signal) => {
    if (!submitted.businessId && !submitted.restaurantId) return { rows: [], total: 0 };
    const { data: body } = await adminApi.get('/admin/super/business-audit', {
      signal,
      timeout: 15000,
      params: {
        ...(submitted.businessId ? { businessId: submitted.businessId } : {}),
        ...(submitted.restaurantId ? { restaurantId: submitted.restaurantId } : {}),
        ...(submitted.actionPrefix ? { actionPrefix: submitted.actionPrefix } : {}),
        limit: PAGE_LIMIT,
        offset,
      },
    });
    return { rows: body?.rows || [], total: body?.total ?? 0 };
  }, [submitted, offset]);

  const rows = data?.rows || [];
  const total = data?.total ?? 0;

  const submit = (event) => {
    event.preventDefault();
    setOffset(0);
    setSubmitted({ businessId, restaurantId, actionPrefix });
  };

  return (
    <div className="p-6">
      <h1 className="mb-1 text-xl font-bold text-white">{t('adminBusinessAudit.title')}</h1>
      <p className="mb-4 text-sm text-gray-400">{t('adminBusinessAudit.subtitle')}</p>

      <form onSubmit={submit} className="mb-4 flex flex-wrap gap-2">
        <input value={businessId} onChange={(event) => setBusinessId(event.target.value)} placeholder={t('adminBusinessAudit.businessIdPlaceholder')} inputMode="numeric" className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)} placeholder={t('adminBusinessAudit.restaurantIdPlaceholder')} inputMode="numeric" className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <input value={actionPrefix} onChange={(event) => setActionPrefix(event.target.value)} placeholder={t('adminBusinessAudit.actionPrefixPlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
        <button type="submit" className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-white">
          {t('adminBusinessAudit.search')}
        </button>
      </form>
      <p className="mb-4 text-xs text-gray-500">{t('adminBusinessAudit.prefixHint')}</p>

      {loading && <p className="text-gray-400">{t('common.loading')}</p>}
      {loadError && !loading && (
        <AdminErrorState message={serverErrorMessage(loadError, t('adminBusinessAudit.loadFailed'))} onRetry={reload} />
      )}
      {!loading && !loadError && submitted.businessId === '' && submitted.restaurantId === '' && (
        <p className="text-gray-500">{t('adminBusinessAudit.emptyPrompt')}</p>
      )}
      {!loading && !loadError && (submitted.businessId || submitted.restaurantId) && rows.length === 0 && (
        <p className="text-gray-500">{t('adminBusinessAudit.empty')}</p>
      )}
      {!loading && !loadError && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{row.action}</span>
                <span className="text-xs text-gray-400">{adminDateTime(row.created_at)}</span>
              </div>
              <p className="mt-1 text-sm text-gray-400">
                {row.target_type ? `${row.target_type}:${row.target_id}` : ''}
                {row.actor_role ? ` · ${row.actor_role}` : ''}
              </p>
              {(row.before_state || row.after_state) && (
                <pre className="mt-2 overflow-x-auto rounded bg-slate-800 p-2 text-xs text-gray-300">
                  {JSON.stringify({ before: row.before_state, after: row.after_state }, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && !loadError && (
        <RsdPager offset={offset} limit={PAGE_LIMIT} total={total} onPage={setOffset} />
      )}
    </div>
  );
}
