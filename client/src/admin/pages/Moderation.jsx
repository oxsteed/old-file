import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Shield, AlertTriangle, CheckCircle, XCircle, Flag } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

export default function Moderation() {
  const { t } = useTranslation();
  const [acting, setActing] = useState(null);

  // Sequence-guarded + abortable: rapid filter/tab switching can no longer
  // clobber the queue with a stale response, and a failed fetch surfaces an
  // error panel instead of a misleading "queue is clear" empty state.
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: res } = await adminApi.get('/admin/moderation-queue', { signal });
    return res.queue || [];
  }, []);
  const items = data || [];

  const fetchQueue = () => reload();

  const handleAction = async (jobId, action) => {
    const reason =
      action === 'cancel'
        ? window.prompt(t('admin.jobCancelReason')) || ''
        : window.prompt(t('admin.auditNote')) || '';
    if (action === 'cancel' && !reason.trim()) {
      toast.error(t('admin.cancelReasonRequired'));
      return;
    }
    setActing(`${jobId}-${action}`);
    try {
      await adminApi.post(`/admin/jobs/${jobId}/action`, {
        action,
        reason: reason.trim() || undefined,
      });
      fetchQueue();
    } catch (err) {
      toast.error(
        err?.response?.data?.error ||
          t('admin.moderationActionFailed', { defaultValue: 'Moderation action failed.' })
      );
    } finally {
      setActing(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Shield size={22} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">{t('admin.moderation.title', { defaultValue: 'Content Moderation' })}</h1>
          <p className="text-gray-400 text-sm">
            {t('admin.moderation.queueSubtitle', { defaultValue: '{{count}} job{{plural}} flagged or reported', count: items.length, plural: items.length !== 1 ? 's' : '' })}
          </p>
        </div>
      </div>

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

                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleAction(item.id, 'unflag')}
                      disabled={!!acting}
                      title={t('admin.moderation.dismissTitle', { defaultValue: 'Dismiss - remove admin flag' })}
                      className="flex items-center gap-1 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle size={14} /> {t('admin.moderation.dismiss', { defaultValue: 'Dismiss' })}
                    </button>
                    <button
                      onClick={() => handleAction(item.id, 'flag')}
                      disabled={!!acting}
                      title={t('admin.moderation.flagTitle', { defaultValue: 'Flag for further review' })}
                      className="flex items-center gap-1 px-3 py-1.5 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      <Flag size={14} /> {t('admin.moderation.flag', { defaultValue: 'Flag' })}
                    </button>
                    <button
                      onClick={() => handleAction(item.id, 'cancel')}
                      disabled={!!acting}
                      title={t('admin.moderation.removeTitle', { defaultValue: 'Cancel job - removes from marketplace' })}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 text-xs font-medium disabled:opacity-50 transition-colors"
                    >
                      <XCircle size={14} /> {t('admin.moderation.remove', { defaultValue: 'Remove' })}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
