import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';

// Customer restaurant support surface (finding 7): list my cases with a
// total and pager, and create a case. Detail lives on the existing
// customer detail route, which calls the customer endpoints.
const PAGE_LIMIT = 50;
const ISSUE_TYPES = ['missing_item', 'wrong_item', 'food_quality', 'late_order', 'payment_problem', 'restaurant_closed', 'delivery_issue', 'other'];
const RESOLUTIONS = ['', 'refund', 'partial_refund', 'store_credit', 'apology_only', 'replacement'];

function serverErrorMessage(err, fallback) {
  const serverError = err?.response?.data?.error;
  if (typeof serverError === 'string' && serverError) return serverError;
  if (serverError?.message) return serverError.message;
  return err?.message || fallback;
}

export default function RestaurantSupportCases() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdId, setCreatedId] = useState(null);
  const [form, setForm] = useState({
    restaurantId: searchParams.get('restaurantId') || '',
    orderId: searchParams.get('orderId') || '',
    issueType: 'other',
    requestedResolution: '',
    description: '',
  });

  const load = async (nextOffset) => {
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get('/restaurants/support/cases/my', {
        timeout: 15000,
        params: { limit: PAGE_LIMIT, offset: nextOffset },
      });
      setCases(response.data?.cases || []);
      setTotal(response.data?.total ?? 0);
    } catch (err) {
      setLoadError(serverErrorMessage(err, t('restaurantSupport.loadFailed')));
      setCases([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(offset); }, [offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (event) => {
    event.preventDefault();
    if (!form.description.trim() || !form.restaurantId.trim()) {
      setCreateError(t('restaurantSupport.createRequired'));
      return;
    }
    setCreating(true);
    setCreateError('');
    setCreatedId(null);
    try {
      const response = await api.post('/restaurants/support/cases', {
        restaurantId: Number(form.restaurantId),
        ...(form.orderId.trim() ? { orderId: Number(form.orderId) } : {}),
        issueType: form.issueType,
        ...(form.requestedResolution ? { requestedResolution: form.requestedResolution } : {}),
        description: form.description.trim(),
      }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      setCreatedId(response.data?.case?.id || null);
      setForm((current) => ({ ...current, description: '', requestedResolution: '' }));
      await load(0);
      setOffset(0);
    } catch (err) {
      setCreateError(serverErrorMessage(err, t('restaurantSupport.createFailed')));
    } finally {
      setCreating(false);
    }
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_LIMIT, total);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PageMeta title={t('restaurantSupport.title')} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">{t('restaurantSupport.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('restaurantSupport.subtitle')}</p>

        <section className="mt-6 rounded-3xl border border-white/10 bg-slate-950/75 p-5">
          <h2 className="text-lg font-semibold">{t('restaurantSupport.createTitle')}</h2>
          {createError && <p role="alert" className="mt-3 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{createError}</p>}
          {createdId && <p role="status" className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{t('restaurantSupport.created')}</p>}
          <form onSubmit={create} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                {t('restaurantSupport.restaurantId')}
                <input value={form.restaurantId} onChange={(event) => setForm((current) => ({ ...current, restaurantId: event.target.value }))} inputMode="numeric" className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-white" />
              </label>
              <label className="block text-sm">
                {t('restaurantSupport.orderId')}
                <input value={form.orderId} onChange={(event) => setForm((current) => ({ ...current, orderId: event.target.value }))} inputMode="numeric" className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-white" />
              </label>
              <label className="block text-sm">
                {t('restaurantSupport.issueType')}
                <select value={form.issueType} onChange={(event) => setForm((current) => ({ ...current, issueType: event.target.value }))} className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-white">
                  {ISSUE_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                {t('restaurantSupport.requestedResolution')}
                <select value={form.requestedResolution} onChange={(event) => setForm((current) => ({ ...current, requestedResolution: event.target.value }))} className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-white">
                  {RESOLUTIONS.map((value) => <option key={value || 'none'} value={value}>{value || t('restaurantSupport.noPreference')}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-sm">
              {t('restaurantSupport.description')}
              <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={4} maxLength={5000} className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2 text-white" />
            </label>
            <button type="submit" disabled={creating} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {creating ? t('common.saving') : t('restaurantSupport.create')}
            </button>
          </form>
        </section>

        <section className="mt-6 rounded-3xl border border-white/10 bg-slate-950/75 p-5">
          <h2 className="text-lg font-semibold">{t('restaurantSupport.myCases')}</h2>
          {loading && <p className="mt-3 text-sm text-slate-400">{t('common.loading')}</p>}
          {loadError && !loading && (
            <div className="mt-3">
              <p role="alert" className="text-sm text-red-300">{loadError}</p>
              <button type="button" onClick={() => load(offset)} className="mt-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold">{t('common.retry')}</button>
            </div>
          )}
          {!loading && !loadError && cases.length === 0 && <p className="mt-3 text-sm text-slate-400">{t('restaurantSupport.empty')}</p>}
          {!loading && !loadError && cases.length > 0 && (
            <div className="mt-3 space-y-3">
              {cases.map((supportCase) => (
                <Link key={supportCase.id} to={`/restaurants/support/cases/${supportCase.id}`} className="block rounded-xl border border-white/10 bg-slate-900 p-4 hover:border-orange-500/50">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{supportCase.public_case_number || `#${supportCase.id}`} · {supportCase.title || supportCase.issue_type}</span>
                    <span className="text-xs text-slate-400">{supportCase.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-400">{supportCase.restaurant_name || ''}</p>
                </Link>
              ))}
            </div>
          )}
          {!loading && !loadError && total > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-400">{t('restaurantSupport.showing', { from, to, total })}</span>
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_LIMIT))} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold disabled:opacity-40">{t('common.previous')}</button>
              <button type="button" disabled={offset + PAGE_LIMIT >= total} onClick={() => setOffset(offset + PAGE_LIMIT)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold disabled:opacity-40">{t('common.next')}</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
