import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Shield, AlertTriangle, CheckCircle, XCircle, Flag } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import { useHasGrant } from '../lib/GrantGuard';

const DIALOG_CONFIG = {
  unflag: {
    titleKey: ['admin.moderation.dismissTitle', 'Dismiss - remove admin flag'],
    confirmKey: ['admin.moderation.dismiss', 'Dismiss'],
  },
  flag: {
    titleKey: ['admin.moderation.flagTitle', 'Flag for further review'],
    confirmKey: ['admin.moderation.flag', 'Flag'],
  },
  cancel: {
    titleKey: ['admin.moderation.removeTitle', 'Cancel job - removes from marketplace'],
    confirmKey: ['admin.moderation.remove', 'Remove'],
    danger: true,
    requireReason: true,
  },
};

const FLAG_STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'];

function flaggedText(reason) {
  if (!reason) return '';
  try {
    const parsed = JSON.parse(reason);
    if (parsed && typeof parsed.text === 'string') return parsed.text;
  } catch {
    // Not JSON: the reason is already plain text.
  }
  return String(reason);
}

function reporterName(flag) {
  const name = [flag.reporter_first, flag.reporter_last].filter(Boolean).join(' ').trim();
  return name || flag.reporter_email || '—';
}

// R-6 (PR #804 Track C): mobile content flags landed in moderation_queue
// and the reader endpoints existed, but no admin UI ever called them, so
// the flags were write-only. This section is that UI, on the existing
// /admin/moderation page (grant moderate_content, same as the endpoints).
function ContentFlagsSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [resolutions, setResolutions] = useState({});
  const [acting, setActing] = useState(null);
  const [flagError, setFlagError] = useState(null);

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: res } = await adminApi.get('/admin/moderation-flags', { params: { status, page, limit: 25 }, signal });
    return res;
  }, [status, page]);
  const flags = data?.flags || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / (data?.limit || 25)));

  const review = async (flag, decision) => {
    setActing(flag.id);
    setFlagError(null);
    try {
      await adminApi.post(`/admin/moderation-flags/${flag.id}/review`, {
        decision,
        resolution: resolutions[flag.id] || undefined,
      });
      reload();
    } catch (err) {
      // A 409 means another admin decided the flag first: say so plainly
      // and refresh so the decided row leaves the pending list.
      const httpStatus = err?.response?.status;
      setFlagError(httpStatus === 409
        ? t('admin.moderationFlagsAlreadyDecided')
        : (err?.response?.data?.error || t('admin.moderationFlagsReviewFailed')));
      if (httpStatus === 409) reload();
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 flex-wrap p-4 border-b border-slate-700">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          {t('admin.moderationFlagsStatus')}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white"
          >
            {FLAG_STATUSES.map((value) => (
              <option key={value} value={value} className="capitalize">{value}</option>
            ))}
          </select>
        </label>
        <span className="text-sm text-gray-400">
          {t('admin.moderationFlagsCount', { count: total })}
        </span>
      </div>

      {flagError && (
        <div role="alert" className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="flex-1">{flagError}</div>
          <button type="button" onClick={() => setFlagError(null)} className="shrink-0 text-red-400 hover:text-red-200 underline text-xs">
            {t('common.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-16">{t('admin.moderationFlagsLoading')}</div>
      ) : error ? (
        <div className="p-6">
          <AdminErrorState
            title={t('admin.moderationQueueLoadFailedTitle')}
            message={error?.response?.data?.error || t('admin.moderationQueueLoadFailedMessage')}
            onRetry={reload}
          />
        </div>
      ) : flags.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle className="mx-auto mb-3 text-green-400" size={48} />
          <p className="text-gray-400 font-medium">{t('admin.moderationFlagsEmpty')}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-700">
          {flags.map((flag) => (
            <div key={flag.id} className="p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-white">{flag.type}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-gray-300 capitalize">{flag.priority}</span>
                    <span className="text-xs text-gray-500">{flag.target_type} · {flag.target_id}</span>
                  </div>
                  <p className="text-gray-400 text-sm line-clamp-2">{flaggedText(flag.reason)}</p>
                  {flag.resolution && (
                    <p className="text-gray-400 text-sm mt-1">{flag.resolution}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
                    <span>{t('admin.moderationFlagsReportedBy')} <span className="text-gray-300">{reporterName(flag)}</span></span>
                    <span className="capitalize">{flag.status}</span>
                    <span>{new Date(flag.created_at).toLocaleDateString()}</span>
                  </div>
                </div>

                {status === 'pending' && (
                  <div className="flex flex-col gap-2 shrink-0 w-full sm:w-64">
                    <input
                      type="text"
                      value={resolutions[flag.id] || ''}
                      onChange={(e) => setResolutions((prev) => ({ ...prev, [flag.id]: e.target.value }))}
                      placeholder={t('admin.moderationFlagsResolutionPlaceholder')}
                      aria-label={t('admin.moderationFlagsResolutionLabel')}
                      maxLength={2000}
                      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white placeholder:text-gray-500"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => review(flag, 'resolved')}
                        disabled={!!acting}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle size={14} /> {t('admin.moderationFlagsResolve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => review(flag, 'dismissed')}
                        disabled={!!acting}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-500/20 text-gray-300 rounded-lg hover:bg-slate-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                      >
                        <XCircle size={14} /> {t('admin.moderationFlagsDismiss')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between p-4 border-t border-slate-700">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-gray-200 disabled:opacity-50"
          >
            {t('admin.moderationFlagsPrevious')}
          </button>
          <span className="text-sm text-gray-400">{t('admin.moderationFlagsPage', { page, pages: totalPages })}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-gray-200 disabled:opacity-50"
          >
            {t('admin.moderationFlagsNext')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Moderation() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('jobs');
  const [acting, setActing] = useState(null);
  // { item, action } while the confirmation dialog is open.
  const [dialog, setDialog] = useState(null);
  // ADM-021: a failed moderation decision stays visible on the page, not just
  // inside the dialog, so it cannot be mistaken for success.
  const [actionError, setActionError] = useState(null);
  // ADM-022: the queue is readable with moderate_content, but the action
  // endpoint (POST /admin/jobs/:jobId/action) requires manage_operations.
  // Gate the buttons client-side so the UI matches the server's grant
  // requirements instead of offering buttons that always 403.
  const { loading: grantLoading, allowed: canTakeAction } = useHasGrant('manage_operations');

  // Sequence-guarded + abortable: rapid filter/tab switching can no longer
  // clobber the queue with a stale response, and a failed fetch surfaces an
  // error panel instead of a misleading "queue is clear" empty state.
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: res } = await adminApi.get('/admin/moderation-queue', { signal });
    return res.queue || [];
  }, []);
  const items = data || [];

  const fetchQueue = () => reload();

  const handleConfirm = async (reason) => {
    const { item, action } = dialog;
    setActing(`${item.id}-${action}`);
    setActionError(null);
    try {
      await adminApi.post(`/admin/jobs/${item.id}/action`, {
        action,
        reason: reason || undefined,
      });
      fetchQueue();
    } catch (err) {
      // ADM-021: surface the failure loudly. The dialog stays open with its
      // own inline error (rethrow), and this banner persists on the page so
      // a closed dialog cannot hide the failed decision.
      const message = err?.response?.data?.error || err?.message
        || t('admin.moderation.actionFailed', { defaultValue: 'The moderation action failed. Please try again.' });
      setActionError(message);
      throw err;
    } finally {
      setActing(null);
    }
  };

  const dialogConfig = dialog ? DIALOG_CONFIG[dialog.action] : null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Shield size={22} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">{t('admin.moderation.title', { defaultValue: 'Content Moderation' })}</h1>
          <p className="text-gray-400 text-sm">
            {tab === 'jobs'
              ? t('admin.moderation.queueSubtitle', { defaultValue: '{{count}} job{{plural}} flagged or reported', count: items.length, plural: items.length !== 1 ? 's' : '' })
              : t('admin.moderationFlagsTitle')}
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-6" role="tablist" aria-label={t('admin.moderation.title', { defaultValue: 'Content Moderation' })}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'jobs'}
          onClick={() => setTab('jobs')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'jobs' ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
        >
          {t('admin.moderationJobsTab')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'flags'}
          onClick={() => setTab('flags')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'flags' ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-800 text-gray-300 hover:bg-slate-700'}`}
        >
          {t('admin.moderationFlagsTab')}
        </button>
      </div>

      {actionError && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-red-700 bg-red-900/40 px-4 py-3 text-sm text-red-300"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="flex-1">{actionError}</div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-red-400 hover:text-red-200 underline text-xs"
          >
            {t('common.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </div>
      )}

      {tab === 'jobs' ? (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="text-center text-gray-400 py-16">{t('admin.moderation.loading', { defaultValue: 'Loading…' })}</div>
        ) : error ? (
          <div className="p-6">
            <AdminErrorState
              title={t('admin.moderationQueueLoadFailedTitle')}
              message={error?.response?.data?.error || t('admin.moderationQueueLoadFailedMessage')}
              onRetry={reload}
            />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle className="mx-auto mb-3 text-green-400" size={48} />
            <p className="text-gray-400 font-medium">{t('admin.moderation.emptyQueue', { defaultValue: 'Queue is clear - no flagged or reported jobs.' })}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {items.map(item => (
              <div key={item.id} className="p-4 hover:bg-slate-700/30 transition-colors">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Link
                        to={`/admin/jobs/${item.id}`}
                        className="font-medium text-white hover:text-orange-300 transition-colors truncate"
                      >
                        {item.title}
                      </Link>
                      {item.report_count > 0 && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-900/60 text-red-400 shrink-0">
                          <AlertTriangle size={11} />
                          {t('admin.moderation.reportCount', { defaultValue: '{{count}} report{{plural}}', count: item.report_count, plural: Number(item.report_count) !== 1 ? 's' : '' })}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm line-clamp-2">{item.description}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
                      <span>{t('admin.moderation.by', { defaultValue: 'By:' })} <span className="text-gray-300">{item.client_name}</span></span>
                      {item.category_name && <span>{item.category_name}</span>}
                      <span className="capitalize">{item.status}</span>
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {grantLoading ? (
                    <div className="flex gap-2 shrink-0 items-center">
                      <span className="text-xs text-gray-500">{t('admin.moderation.checkingPermissions', { defaultValue: 'Checking permissions…' })}</span>
                    </div>
                  ) : canTakeAction ? (
                  <div className="flex gap-2 shrink-0">
                    {item.admin_flagged && (
                      <button
                        onClick={() => setDialog({ item, action: 'unflag' })}
                        disabled={!!acting}
                        title={t('admin.moderation.dismissTitle', { defaultValue: 'Dismiss - remove admin flag' })}
                        className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                      >
                        <CheckCircle size={14} /> {t('admin.moderation.dismiss', { defaultValue: 'Dismiss' })}
                      </button>
                    )}
                    <button
                      onClick={() => setDialog({ item, action: 'flag' })}
                      disabled={!!acting}
                      title={t('admin.moderation.flagTitle', { defaultValue: 'Flag for further review' })}
                      className="flex items-center gap-1 px-3 py-1.5 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      <Flag size={14} /> {t('admin.moderation.flag', { defaultValue: 'Flag' })}
                    </button>
                    <button
                      onClick={() => setDialog({ item, action: 'cancel' })}
                      disabled={!!acting}
                      title={t('admin.moderation.removeTitle', { defaultValue: 'Cancel job - removes from marketplace' })}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      <XCircle size={14} /> {t('admin.moderation.remove', { defaultValue: 'Remove' })}
                    </button>
                  </div>
                  ) : (
                    <div
                      className="shrink-0 max-w-[200px] text-xs text-amber-400/90"
                      title={t('admin.moderation.actionsNeedGrant', { defaultValue: 'Moderation actions require the manage_operations grant. You can view the queue but cannot take action.' })}
                    >
                      {t('admin.moderation.actionsNeedGrant', { defaultValue: 'Moderation actions require the manage_operations grant. You can view the queue but cannot take action.' })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      ) : (<ContentFlagsSection />)}

      {dialog && dialogConfig && (
        <ConfirmDialog
          open
          title={t(dialogConfig.titleKey[0], { defaultValue: dialogConfig.titleKey[1] })}
          message={dialog.item.title}
          confirmLabel={t(dialogConfig.confirmKey[0], { defaultValue: dialogConfig.confirmKey[1] })}
          danger={dialogConfig.danger}
          requireReason={dialogConfig.requireReason}
          reasonLabel={dialogConfig.requireReason ? t('admin.jobCancelReason') : undefined}
          onConfirm={handleConfirm}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
