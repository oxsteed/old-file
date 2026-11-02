import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import { listMyFoodRestaurants } from '../api/food';
import { createMessageRequestId } from '../lib/messageRequestId';

// Merchant restaurant support surface (finding 7): list and detail for one
// restaurant, calling the merchant endpoints (/:restaurantId/support/cases)
// with respond, assign, offer-resolution, resolve, and escalate actions.
// This is deliberately separate from the customer detail page, which calls
// the customer endpoints and would reject an operator who is not the case's
// customer.
const PAGE_LIMIT = 50;

function serverErrorMessage(err, fallback) {
  const serverError = err?.response?.data?.error;
  if (typeof serverError === 'string' && serverError) return serverError;
  if (serverError?.message) return serverError.message;
  return err?.message || fallback;
}

export default function RestaurantMerchantSupport() {
  const { t } = useTranslation();
  const { caseId } = useParams();
  const [searchParams] = useSearchParams();
  const [restaurants, setRestaurants] = useState([]);
  const [restaurantId, setRestaurantId] = useState(searchParams.get('restaurantId') || '');
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [reply, setReply] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [offerResolution, setOfferResolution] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const [escalateReason, setEscalateReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  // The detail link carries ?restaurantId=, so sync it when navigation
  // changes the query without remounting this component.
  useEffect(() => {
    const queryRestaurantId = searchParams.get('restaurantId');
    if (queryRestaurantId && queryRestaurantId !== restaurantId) setRestaurantId(queryRestaurantId);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listMyFoodRestaurants()
      .then((rows) => {
        setRestaurants(rows || []);
        if (!restaurantId && rows?.length) setRestaurantId(String(rows[0].id));
      })
      .catch(() => setRestaurants([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadList = async (nextOffset) => {
    if (!restaurantId) return;
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.get(`/restaurants/${restaurantId}/support/cases`, {
        timeout: 15000,
        params: { ...(status ? { status } : {}), limit: PAGE_LIMIT, offset: nextOffset },
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

  const loadDetail = async () => {
    if (!restaurantId || !caseId) return;
    setDetailError('');
    try {
      const response = await api.get(`/restaurants/${restaurantId}/support/cases/${caseId}`, { timeout: 15000 });
      setDetail(response.data);
    } catch (err) {
      setDetailError(serverErrorMessage(err, t('restaurantSupport.loadFailed')));
    }
  };

  useEffect(() => { loadList(offset); }, [restaurantId, status, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadDetail(); }, [restaurantId, caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async (path, body, successKey) => {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await api.post(`/restaurants/${restaurantId}/support/cases/${caseId}${path}`, body, {
        ...(path === '/respond' ? { headers: { 'Idempotency-Key': createMessageRequestId() } } : {}),
      });
      setNotice(t(successKey));
      await loadDetail();
    } catch (err) {
      setActionError(serverErrorMessage(err, t('restaurantSupport.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  const supportCase = detail?.case || null;
  const messages = detail?.messages || [];
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_LIMIT, total);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <PageMeta title={t('restaurantSupport.merchantTitle')} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">{t('restaurantSupport.merchantTitle')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('restaurantSupport.merchantSubtitle')}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <select value={restaurantId} onChange={(event) => { setRestaurantId(event.target.value); setOffset(0); }} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>{restaurant.display_name || restaurant.name || `#${restaurant.id}`}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
            <option value="">{t('restaurantSupport.allStatuses')}</option>
            {['new', 'awaiting_restaurant', 'awaiting_customer', 'awaiting_oxsteed', 'investigating', 'resolution_offered', 'resolved', 'closed', 'reopened', 'escalated'].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>

        {caseId ? (
          <div className="mt-6 space-y-6">
            <Link to={`/restaurants/merchant/support?restaurantId=${restaurantId}`} className="text-sm text-orange-400 hover:underline">
              {t('restaurantSupport.backToQueue')}
            </Link>
            {detailError && <p role="alert" className="text-sm text-red-300">{detailError}</p>}
            {!detailError && !supportCase && <p className="text-sm text-slate-400">{t('common.loading')}</p>}
            {supportCase && (
              <>
                <div>
                  <h2 className="text-xl font-bold">{supportCase.public_case_number || `#${supportCase.id}`} · {supportCase.title || supportCase.issue_type}</h2>
                  <p className="mt-1 text-sm text-slate-400">{supportCase.status} · {supportCase.owner_type}</p>
                  <p className="mt-2 text-sm text-slate-300">{supportCase.description}</p>
                </div>
                {actionError && <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</p>}
                {notice && <p role="status" className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</p>}
                <section className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                  <h3 className="font-semibold">{t('restaurantSupport.respondTitle')}</h3>
                  <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} className="mt-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-white" />
                  <button type="button" disabled={busy || !reply.trim()} onClick={() => { runAction('/respond', { message: reply.trim() }, 'restaurantSupport.responded'); setReply(''); }} className="mt-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {t('restaurantSupport.respond')}
                  </button>
                </section>
                <section className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                  <h3 className="font-semibold">{t('restaurantSupport.manageTitle')}</h3>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input value={assignTo} onChange={(event) => setAssignTo(event.target.value)} placeholder={t('restaurantSupport.assignPlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
                    <button type="button" disabled={busy} onClick={() => runAction('/assign', { assignedToUserId: assignTo || null }, 'restaurantSupport.assigned')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold">{t('restaurantSupport.assign')}</button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select value={offerResolution} onChange={(event) => setOfferResolution(event.target.value)} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white">
                      <option value="">{t('restaurantSupport.offerPlaceholder')}</option>
                      {['refund', 'partial_refund', 'store_credit', 'apology_only', 'replacement'].map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                    <input value={offerAmount} onChange={(event) => setOfferAmount(event.target.value.replace(/[^0-9]/g, ''))} placeholder={t('restaurantSupport.amountPlaceholder')} inputMode="numeric" className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
                    <button type="button" disabled={busy || !offerResolution} onClick={() => runAction('/offer-resolution', { resolution: offerResolution, amountCents: offerAmount ? Number(offerAmount) : null }, 'restaurantSupport.offered')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold">{t('restaurantSupport.offer')}</button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input value={resolveNote} onChange={(event) => setResolveNote(event.target.value)} placeholder={t('restaurantSupport.resolveNotePlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm(t('restaurantSupport.confirmResolve'))) runAction('/resolve', { note: resolveNote }, 'restaurantSupport.resolved'); }} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold">{t('restaurantSupport.resolve')}</button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input value={escalateReason} onChange={(event) => setEscalateReason(event.target.value)} placeholder={t('restaurantSupport.escalatePlaceholder')} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white" />
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm(t('restaurantSupport.confirmEscalate'))) runAction('/escalate', { reason: escalateReason }, 'restaurantSupport.escalated'); }} className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold">{t('restaurantSupport.escalate')}</button>
                  </div>
                </section>
                <section className="rounded-3xl border border-white/10 bg-slate-950/75 p-5">
                  <h3 className="font-semibold">{t('restaurantSupport.messagesTitle')}</h3>
                  {messages.length === 0 && <p className="mt-2 text-sm text-slate-400">{t('restaurantSupport.noMessages')}</p>}
                  <div className="mt-2 space-y-3">
                    {messages.map((message) => (
                      <div key={message.id} className="rounded-xl bg-slate-900 p-3">
                        <p className="text-xs text-slate-400">{message.sender_type}{message.internal_note ? ` · ${t('restaurantSupport.internalNote')}` : ''}</p>
                        <p className="mt-1 text-sm text-slate-200">{message.message}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        ) : (
          <section className="mt-6 rounded-3xl border border-white/10 bg-slate-950/75 p-5">
            {loading && <p className="text-sm text-slate-400">{t('common.loading')}</p>}
            {loadError && !loading && (
              <div>
                <p role="alert" className="text-sm text-red-300">{loadError}</p>
                <button type="button" onClick={() => loadList(offset)} className="mt-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold">{t('common.retry')}</button>
              </div>
            )}
            {!loading && !loadError && cases.length === 0 && <p className="text-sm text-slate-400">{t('restaurantSupport.empty')}</p>}
            {!loading && !loadError && cases.length > 0 && (
              <div className="space-y-3">
                {cases.map((supportCase) => (
                  <Link key={supportCase.id} to={`/restaurants/merchant/support/cases/${supportCase.id}?restaurantId=${restaurantId}`} className="block rounded-xl border border-white/10 bg-slate-900 p-4 hover:border-orange-500/50">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{supportCase.public_case_number || `#${supportCase.id}`} · {supportCase.title || supportCase.issue_type}</span>
                      <span className="text-xs text-slate-400">{supportCase.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{supportCase.customer_email || ''}</p>
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
        )}
      </div>
    </div>
  );
}
