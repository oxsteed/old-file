// Restaurant customer top-up approval queue: OxSteed decides which
// restaurants may accept customer card top-ups. Lists applications by status
// (pending first) with Approve / Reject (reason required) / Suspend (reason
// required) actions. Route-gated to the manage_financials grant, matching
// the server money gate on /api/admin/restaurant-topups.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PauseCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { formatCreditDateTime } from '../../../lib/creditDateTime';

const PAGE_SIZE = 25;
const STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

function getErrorMessage(error, fallback, t) {
  return error?.response?.data?.message || error?.response?.data?.error || fallback || t('errors.generic');
}

function dateTime(value, t) {
  return formatCreditDateTime(
    value,
    value ? t('restaurantTopups.admin.unknownTime') : t('restaurantTopups.admin.noActivity'),
  );
}

function statusTone(status) {
  switch (status) {
    case 'approved':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
    case 'pending':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-300';
    case 'rejected':
      return 'border-red-500/30 bg-red-500/10 text-red-300';
    case 'suspended':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
    default:
      return 'border-gray-700 bg-gray-900/70 text-gray-400';
  }
}

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const label = {
    pending: t('restaurantTopups.admin.statusPending'),
    approved: t('restaurantTopups.admin.statusApproved'),
    rejected: t('restaurantTopups.admin.statusRejected'),
    suspended: t('restaurantTopups.admin.statusSuspended'),
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
  const needsReason = modal.kind === 'reject' || modal.kind === 'suspend';
  const canConfirm = !busy && (!needsReason || modal.reason?.trim());
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="topup-decision-dialog-title">
      <div className="w-full max-w-lg rounded-2xl border border-gray-700 bg-[#111318] p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">{t('restaurantTopups.admin.confirmAction')}</p>
            <h2 id="topup-decision-dialog-title" className="mt-2 text-xl font-semibold text-white">{modal.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-white" aria-label={t('restaurantTopups.admin.closeDialog')}>
            <XCircle className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-gray-400">{modal.description}</p>
        {needsReason && (
          <label className="mt-5 block text-sm font-medium text-gray-300">
            {t('restaurantTopups.admin.decisionReasonLabel')} <span className="text-orange-300">*</span>
            <textarea
              value={modal.reason || ''}
              onChange={(event) => onChange({ reason: event.target.value })}
              rows={3}
              maxLength={500}
              placeholder={t('restaurantTopups.admin.decisionReasonPlaceholder')}
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

export default function RestaurantTopupApprovals() {
  const { t } = useTranslation();
  const [applications, setApplications] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextStatus = status, nextPage = page) => {
    setLoading(true);
    setError('');
    try {
      const response = await adminApi.get('/admin/restaurant-topups/applications', {
        params: { status: nextStatus, limit: PAGE_SIZE, offset: (nextPage - 1) * PAGE_SIZE },
      });
      setApplications(response.data?.applications || []);
      setTotal(Number(response.data?.total || 0));
    } catch (err) {
      setError(getErrorMessage(err, t('restaurantTopups.admin.loadFailed'), t));
    } finally {
      setLoading(false);
    }
  }, [status, page, t]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = (next) => {
    setStatus(next);
    setPage(1);
    setNotice('');
  };

  const changePage = (nextPage) => {
    setPage(nextPage);
  };

  const openDecision = (kind, application) => {
    const titles = {
      approve: { title: t('restaurantTopups.admin.approveTitle'), confirmLabel: t('restaurantTopups.admin.approve') },
      reject: { title: t('restaurantTopups.admin.rejectTitle'), confirmLabel: t('restaurantTopups.admin.reject') },
      suspend: { title: t('restaurantTopups.admin.suspendTitle'), confirmLabel: t('restaurantTopups.admin.suspend') },
    }[kind];
    setModal({
      kind,
      application,
      reason: '',
      title: titles.title,
      confirmLabel: titles.confirmLabel,
      description: t('restaurantTopups.admin.decisionDescription', { restaurant: application.restaurantName || application.restaurantId }),
    });
  };

  const confirmDecision = async () => {
    if (!modal) return;
    const { kind, application, reason } = modal;
    if ((kind === 'reject' || kind === 'suspend') && !reason?.trim()) return;
    setBusy(true);
    try {
      await adminApi.post(
        `/admin/restaurant-topups/applications/${application.restaurantId}/${kind}`,
        kind === 'approve' ? undefined : { reason: reason.trim() },
      );
      setNotice(t(`restaurantTopups.admin.${kind}Done`));
      setModal(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, t('restaurantTopups.admin.actionFailed'), t));
    } finally {
      setBusy(false);
    }
  };

  // Valid transitions mirror the server decideApplication flow.
  const actionsFor = (application) => {
    switch (application.status) {
      case 'pending':
        return ['approve', 'reject', 'suspend'];
      case 'approved':
        return ['suspend'];
      case 'rejected':
      case 'suspended':
        return ['approve', 'reject'];
      default:
        return [];
    }
  };

  const actionButtonClass = (kind) => {
    if (kind === 'approve') return 'rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500';
    if (kind === 'reject') return 'rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10';
    return 'rounded-lg border border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/10';
  };

  const actionIcon = (kind) => {
    if (kind === 'approve') return <CheckCircle2 className="h-3.5 w-3.5" />;
    if (kind === 'reject') return <XCircle className="h-3.5 w-3.5" />;
    return <PauseCircle className="h-3.5 w-3.5" />;
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-gray-950 p-4 text-gray-200 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-gray-800 bg-[#111318] p-4 sm:p-5">
          <SectionHeader
            eyebrow={t('restaurantTopups.admin.eyebrow')}
            title={t('restaurantTopups.admin.title')}
            detail={t('restaurantTopups.admin.subtitle')}
            action={(
              <button type="button" onClick={() => load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {t('restaurantTopups.admin.refresh')}
              </button>
            )}
          />

          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={t('restaurantTopups.admin.filterLabel')}>
            {STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={status === value}
                onClick={() => changeStatus(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === value ? 'border-orange-500/60 bg-orange-500/10 text-orange-200' : 'border-gray-700 text-gray-400 hover:bg-gray-800'}`}
              >
                {t(`restaurantTopups.admin.filter${value[0].toUpperCase()}${value.slice(1)}`)}
              </button>
            ))}
          </div>

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

          <div className="mt-5">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500" aria-busy="true">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('restaurantTopups.admin.loading')}
              </div>
            ) : !applications.length ? (
              <div className="rounded-xl border border-gray-800 bg-gray-950/35 p-6 text-center">
                <p className="text-sm font-semibold text-white">{t('restaurantTopups.admin.emptyTitle')}</p>
                <p className="mt-1 text-xs text-gray-500">{t('restaurantTopups.admin.emptyDetail')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {applications.map((application) => (
                  <div key={application.restaurantId} className="rounded-xl border border-gray-800 bg-gray-950/35 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={application.status} />
                          <span className="text-base font-semibold text-white">{application.restaurantName || t('restaurantTopups.admin.unknownRestaurant')}</span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          {t('restaurantTopups.admin.appliedAt', { date: dateTime(application.appliedAt, t) })}
                          {' · '}
                          {t('restaurantTopups.admin.restaurantMeta', { currency: application.restaurantCurrency || 'USD', state: application.restaurantStatus || '-' })}
                        </p>
                        {application.decidedAt && (
                          <p className="mt-1 text-xs text-gray-500">
                            {t('restaurantTopups.admin.decidedAt', { date: dateTime(application.decidedAt, t) })}
                          </p>
                        )}
                        {application.decisionReason && (
                          <p className="mt-2 text-xs leading-5 text-gray-400">
                            <span className="font-semibold text-gray-300">{t('restaurantTopups.admin.reasonLabel')}</span>{' '}
                            {application.decisionReason}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {actionsFor(application).map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => openDecision(kind, application)}
                            className={`inline-flex items-center gap-1.5 ${actionButtonClass(kind)}`}
                          >
                            {actionIcon(kind)}
                            {t(`restaurantTopups.admin.${kind}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pageCount > 1 && (
            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">{t('restaurantTopups.admin.pageOf', { page, pages: pageCount })}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => changePage(page - 1)} disabled={page <= 1} className="rounded-lg border border-gray-700 p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-50" aria-label={t('restaurantTopups.admin.previousPage')}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => changePage(page + 1)} disabled={page >= pageCount} className="rounded-lg border border-gray-700 p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-50" aria-label={t('restaurantTopups.admin.nextPage')}>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
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
