// Featured placement review queue: businesses request featured placement
// for their restaurants from the promote page, and an admin fulfills the
// request here. Lists requests by status (requested first) with Contact /
// Approve (restaurant + rank + duration) / Decline (reason required) /
// Revoke actions, plus a live view of currently featured restaurants.
// Plain admin route: the server owns authorization on
// /api/admin/featured-placements.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Megaphone,
  RefreshCw,
  Star,
  Undo2,
  XCircle,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { formatCreditDateTime } from '../../../lib/creditDateTime';

const STATUSES = ['requested', 'contacted', 'approved', 'declined', 'closed', 'all'];

function getErrorMessage(error, fallback, t) {
  return error?.response?.data?.message || error?.response?.data?.error || fallback || t('errors.generic');
}

function dateTime(value, t) {
  return formatCreditDateTime(
    value,
    value ? t('featuredPlacements.admin.unknownTime') : t('featuredPlacements.admin.unknownTime'),
  );
}

function statusTone(status) {
  switch (status) {
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'requested':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    case 'contacted':
      return 'border-violet-500/30 bg-violet-500/10 text-violet-300';
    case 'declined':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    case 'closed':
      return 'border-gray-600/40 bg-gray-800/40 text-gray-400';
    default:
      return 'border-gray-700 bg-gray-900/70 text-gray-400';
  }
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const label = {
    requested: t('featuredPlacements.admin.statusRequested'),
    contacted: t('featuredPlacements.admin.statusContacted'),
    approved: t('featuredPlacements.admin.statusApproved'),
    declined: t('featuredPlacements.admin.statusDeclined'),
    closed: t('featuredPlacements.admin.statusClosed'),
  }[status] || String(status || '').replace(/_/g, ' ');
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusTone(status)}`}>
      {label}
    </span>
  );
}

function SectionHeader({ eyebrow, title, detail, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-orange-300">{eyebrow}</p>}
        <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
        {detail && <p className="mt-1 text-sm leading-6 text-gray-500">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function DecisionDialog({ modal, busy, onChange, onClose, onConfirm }) {
  const { t } = useTranslation();
  if (!modal) return null;
  const needsReason = modal.kind === 'decline';
  const needsPick = modal.kind === 'approve';
  const rank = Number(modal.rank);
  const days = Number(modal.days);
  const rankOk = Number.isInteger(rank) && rank >= 0 && rank <= 1000;
  const daysOk = Number.isInteger(days) && days >= 1 && days <= 365;
  const canConfirm = !busy
    && (!needsReason || modal.reason?.trim())
    && (!needsPick || (modal.restaurantId && rankOk && daysOk));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="featured-decision-dialog-title">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-[#111318] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">{t('featuredPlacements.admin.confirmAction')}</p>
            <h2 id="featured-decision-dialog-title" className="mt-2 text-xl font-semibold text-white">{modal.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-white" aria-label={t('featuredPlacements.admin.closeDialog')}>
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-400">{modal.description}</p>

        {needsPick && (
          <div className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-gray-300">
              {t('featuredPlacements.admin.restaurantLabel')} <span className="text-orange-300">*</span>
              <div className="relative mt-2">
                <select
                  value={modal.restaurantId || ''}
                  onChange={(event) => onChange({ restaurantId: event.target.value })}
                  className="w-full appearance-none rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 pr-10 text-white outline-none focus:border-orange-400"
                >
                  {(modal.restaurants || []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || r.id}
                      {r.is_featured ? ` ${t('featuredPlacements.admin.alreadyFeatured')}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              </div>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm font-medium text-gray-300">
                {t('featuredPlacements.admin.rankLabel')} <span className="text-orange-300">*</span>
                <input
                  type="number"
                  min={0}
                  max={1000}
                  step={1}
                  value={modal.rank}
                  onChange={(event) => onChange({ rank: event.target.value })}
                  className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white outline-none focus:border-orange-400"
                />
              </label>
              <label className="block text-sm font-medium text-gray-300">
                {t('featuredPlacements.admin.daysLabel')} <span className="text-orange-300">*</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={modal.days}
                  onChange={(event) => onChange({ days: event.target.value })}
                  className="mt-2 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white outline-none focus:border-orange-400"
                />
              </label>
            </div>
            <p className="text-xs leading-5 text-gray-500">{t('featuredPlacements.admin.rankDaysHint')}</p>
            {needsPick && (!rankOk || !daysOk) && (
              <p className="text-xs text-red-300" role="alert">{t('featuredPlacements.admin.rankDaysInvalid')}</p>
            )}
          </div>
        )}

        {needsReason && (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            {t('featuredPlacements.admin.declineReasonLabel')} <span className="text-orange-300">*</span>
            <textarea
              value={modal.reason || ''}
              onChange={(event) => onChange({ reason: event.target.value })}
              rows={3}
              maxLength={500}
              placeholder={t('featuredPlacements.admin.declineReasonPlaceholder')}
              className="mt-2 w-full resize-y rounded-xl border border-gray-700 bg-gray-950 px-3 py-3 text-white placeholder:text-gray-600 outline-none focus:border-orange-400"
            />
          </label>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">{t('common.cancel')}</button>
          <button type="button" onClick={onConfirm} disabled={!canConfirm} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {modal.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function currentlyFeatured(restaurants) {
  return (restaurants || []).filter((r) => r.is_featured);
}

export default function FeaturedPlacementReview() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [approvedLookup, setApprovedLookup] = useState([]);
  const [status, setStatus] = useState('requested');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (nextStatus = status) => {
    setLoading(true);
    setError('');
    try {
      const needApproved = nextStatus !== 'approved' && nextStatus !== 'all';
      const [listRes, featuredRes, approvedRes] = await Promise.all([
        adminApi.get('/admin/featured-placements', { params: { status: nextStatus } }),
        adminApi.get('/admin/featured-placements/featured'),
        needApproved ? adminApi.get('/admin/featured-placements', { params: { status: 'approved' } }) : null,
      ]);
      setRequests(listRes.data?.items || []);
      setApprovedLookup(approvedRes?.data?.items || []);
      setFeatured(featuredRes.data?.items || []);
    } catch (err) {
      setError(getErrorMessage(err, t('featuredPlacements.admin.loadFailed'), t));
    } finally {
      setLoading(false);
    }
  }, [status, t]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = (next) => {
    setStatus(next);
    setNotice('');
  };

  const runAction = async (id, action, body) => {
    setBusyId(`${action}:${id}`);
    setError('');
    try {
      await adminApi.post(`/admin/featured-placements/${id}/${action}`, body || {});
      setNotice(t(`featuredPlacements.admin.${action}Done`));
      await load();
    } catch (err) {
      setError(getErrorMessage(err, t('featuredPlacements.admin.actionFailed'), t));
    } finally {
      setBusyId(null);
    }
  };

  const openApprove = (request) => {
    const restaurants = request.restaurants || [];
    const preselect = currentlyFeatured(restaurants)[0] || restaurants[0];
    setModal({
      kind: 'approve',
      request,
      restaurants,
      restaurantId: preselect ? String(preselect.id) : '',
      rank: '10',
      days: '30',
      title: t('featuredPlacements.admin.approveTitle'),
      confirmLabel: t('featuredPlacements.admin.approve'),
      description: t('featuredPlacements.admin.approveDescription', { business: request.business_name || t('featuredPlacements.admin.unknownBusiness') }),
    });
  };

  const openDecline = (request) => {
    setModal({
      kind: 'decline',
      request,
      reason: '',
      title: t('featuredPlacements.admin.declineTitle'),
      confirmLabel: t('featuredPlacements.admin.decline'),
      description: t('featuredPlacements.admin.declineDescription', { business: request.business_name || t('featuredPlacements.admin.unknownBusiness') }),
    });
  };

  const openRevoke = (request) => {
    const live = currentlyFeatured(request.restaurants);
    setModal({
      kind: 'revoke',
      request,
      title: t('featuredPlacements.admin.revokeTitle'),
      confirmLabel: t('featuredPlacements.admin.revoke'),
      description: t('featuredPlacements.admin.revokeDescription', {
        business: request.business_name || t('featuredPlacements.admin.unknownBusiness'),
        restaurant: live.map((r) => r.name || r.id).join(', '),
      }),
    });
  };

  const confirmDecision = async () => {
    if (!modal || busy) return;
    const { kind, request, reason, restaurantId, rank, days } = modal;
    if (kind === 'decline' && !reason?.trim()) return;
    setBusy(true);
    try {
      if (kind === 'approve') {
        await adminApi.post(`/admin/featured-placements/${request.id}/approve`, {
          restaurantId,
          rank: Number(rank),
          days: Number(days),
        });
      } else if (kind === 'decline') {
        await adminApi.post(`/admin/featured-placements/${request.id}/decline`, { note: reason.trim() });
      } else if (kind === 'revoke') {
        await adminApi.post(`/admin/featured-placements/${request.id}/revoke`, {});
      }
      setNotice(t(`featuredPlacements.admin.${kind}Done`));
      setModal(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, t('featuredPlacements.admin.actionFailed'), t));
    } finally {
      setBusy(false);
    }
  };

  const actionsFor = (request) => {
    switch (request.status) {
      case 'requested':
        return ['contact', 'approve', 'decline'];
      case 'contacted':
        return ['approve', 'decline'];
      case 'approved':
        return currentlyFeatured(request.restaurants).length > 0 ? ['revoke'] : [];
      default:
        return [];
    }
  };

  const actionButtonClass = (kind) => {
    if (kind === 'approve') return 'rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500';
    if (kind === 'contact') return 'rounded-lg border border-violet-500/30 px-3 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/10';
    if (kind === 'decline') return 'rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10';
    return 'rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10';
  };

  const actionIcon = (kind) => {
    if (kind === 'approve') return <CheckCircle2 className="h-3.5 w-3.5" />;
    if (kind === 'contact') return <Megaphone className="h-3.5 w-3.5" />;
    if (kind === 'decline') return <XCircle className="h-3.5 w-3.5" />;
    return <Undo2 className="h-3.5 w-3.5" />;
  };

  const openAction = (kind, request) => {
    if (kind === 'approve') return openApprove(request);
    if (kind === 'decline') return openDecline(request);
    if (kind === 'revoke') return openRevoke(request);
    return runAction(request.id, 'contact');
  };

  const placementForFeatured = (restaurantId) => [...requests, ...approvedLookup].find(
    (r) => String(r.featured_restaurant_id) === String(restaurantId)
      || currentlyFeatured(r.restaurants).some((x) => String(x.id) === String(restaurantId)),
  );

  return (
    <div className="min-h-screen bg-gray-950 p-4 text-gray-200 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          <SectionHeader
            eyebrow={t('featuredPlacements.admin.eyebrow')}
            title={t('featuredPlacements.admin.title')}
            detail={t('featuredPlacements.admin.subtitle')}
            action={(
              <button type="button" onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {t('featuredPlacements.admin.refresh')}
              </button>
            )}
          />

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-300" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300" role="status">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          <div className="mt-6">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Star className="h-4 w-4 text-amber-300" />
              {t('featuredPlacements.admin.featuredNowTitle')}
            </h3>
            {loading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-gray-500" aria-busy="true">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('featuredPlacements.admin.loading')}
              </div>
            ) : !featured.length ? (
              <p className="mt-3 rounded-xl border border-gray-800 bg-gray-950/35 p-4 text-sm text-gray-500">{t('featuredPlacements.admin.featuredNowEmpty')}</p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {featured.map((restaurant) => {
                  const placement = placementForFeatured(restaurant.id);
                  const revoking = busyId === `revoke:${placement?.id}`;
                  return (
                    <div key={restaurant.id} className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{restaurant.name || restaurant.display_name || restaurant.id}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {t('featuredPlacements.admin.featuredRank', { rank: restaurant.featured_rank ?? '—' })}
                          {restaurant.featured_until && ` · ${t('featuredPlacements.admin.featuredUntil', { date: dateTime(restaurant.featured_until, t) })}`}
                        </p>
                        {placement?.business_name && (
                          <p className="mt-1 truncate text-xs text-gray-500">{placement.business_name}</p>
                        )}
                      </div>
                      {placement && (
                        <button
                          type="button"
                          onClick={() => openRevoke(placement)}
                          disabled={!!busyId}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
                        >
                          {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                          {t('featuredPlacements.admin.revoke')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          <SectionHeader
            title={t('featuredPlacements.admin.requestsTitle')}
            detail={t('featuredPlacements.admin.requestsDetail')}
          />

          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t('featuredPlacements.admin.filterLabel')}>
            {STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={status === value}
                onClick={() => changeStatus(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === value ? 'border-orange-500/60 bg-orange-500/10 text-orange-200' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}
              >
                {t(`featuredPlacements.admin.filter${value[0].toUpperCase()}${value.slice(1)}`)}
              </button>
            ))}
          </div>

          <div className="mt-5">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500" aria-busy="true">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('featuredPlacements.admin.loading')}
              </div>
            ) : !requests.length ? (
              <div className="rounded-xl border border-gray-800 bg-gray-950/35 p-6 text-center">
                <p className="text-sm font-semibold text-white">{t('featuredPlacements.admin.emptyTitle')}</p>
                <p className="mt-1 text-xs text-gray-500">{t('featuredPlacements.admin.emptyDetail')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {requests.map((request) => {
                  const live = currentlyFeatured(request.restaurants);
                  const actions = actionsFor(request);
                  return (
                    <div key={request.id} className="rounded-xl border border-gray-800 bg-gray-950/35 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={request.status} />
                            <span className="text-base font-semibold text-white">{request.business_name || t('featuredPlacements.admin.unknownBusiness')}</span>
                          </div>
                          <p className="mt-2 text-xs text-gray-500">
                            {t('featuredPlacements.admin.requestedAt', { date: dateTime(request.created_at, t) })}
                            {request.requested_by_email && ` · ${request.requested_by_email}`}
                            {request.category && ` · ${request.category}`}
                            {request.zip && ` · ${request.zip}`}
                          </p>
                          {request.note && (
                            <p className="mt-2 text-xs leading-5 text-gray-400">
                              <span className="font-semibold text-gray-300">{t('featuredPlacements.admin.noteLabel')}</span>{' '}
                              {request.note}
                            </p>
                          )}
                          {request.decided_at && (
                            <p className="mt-1 text-xs text-gray-500">
                              {t('featuredPlacements.admin.decidedAt', { date: dateTime(request.decided_at, t) })}
                            </p>
                          )}
                          {request.decision_note && (
                            <p className="mt-1 text-xs leading-5 text-gray-400">
                              <span className="font-semibold text-gray-300">{t('featuredPlacements.admin.decisionNoteLabel')}</span>{' '}
                              {request.decision_note}
                            </p>
                          )}
                          {live.length > 0 && (
                            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                              <Star className="h-3 w-3" />
                              {t('featuredPlacements.admin.currentlyFeatured', { names: live.map((r) => r.name || r.id).join(', ') })}
                            </p>
                          )}
                        </div>
                        {actions.length > 0 && (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            {actions.map((kind) => {
                              const running = busyId === `${kind}:${request.id}`;
                              return (
                                <button
                                  key={kind}
                                  type="button"
                                  onClick={() => openAction(kind, request)}
                                  disabled={!!busyId}
                                  className={`inline-flex items-center gap-1.5 ${actionButtonClass(kind)} disabled:opacity-50`}
                                >
                                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : actionIcon(kind)}
                                  {t(`featuredPlacements.admin.${kind}`)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <DecisionDialog
        modal={modal}
        busy={busy}
        onChange={(patch) => setModal((prev) => (prev ? { ...prev, ...patch } : prev))}
        onClose={() => { if (!busy) setModal(null); }}
        onConfirm={confirmDecision}
      />
    </div>
  );
}
