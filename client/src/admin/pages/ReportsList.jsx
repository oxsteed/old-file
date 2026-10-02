import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { adminRoute } from '../adminRouteManifest';
import adminApi              from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState       from '../lib/AdminErrorState';
import { adminDateTime } from '../lib/formatters';

const STATUS_TABS = ['pending','reviewed','escalated','dismissed'];

const REASON_COLORS = {
  spam:          'bg-yellow-900 text-yellow-400',
  fraud:         'bg-red-900   text-red-400',
  inappropriate: 'bg-orange-900 text-orange-400',
  other:         'bg-gray-700   text-gray-400'
};

export default function ReportsList() {
  const { t } = useTranslation();
  const [tab,     setTab]      = useState('pending');
  const [acting,  setActing]   = useState(null);
  const [message, setMessage]  = useState(null);

  // Sequence-guarded + abortable: a failed fetch surfaces an error panel
  // instead of a misleading "queue is clear" empty state.
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data: res } = await adminApi.get('/admin/reports', {
      params: { status: tab },
      signal,
    });
    return { reports: res.reports || [], total: res.total || 0 };
  }, [tab]);
  const reports = data?.reports || [];
  const total = data?.total || 0;

  const fetchReports = () => reload();

  const handleAction = async (reportId, action) => {
    const actionLabel = t(`adminReports.action.${action}`, { defaultValue: action });
    if (!window.confirm(`${actionLabel}?`)) return;

    setActing(reportId);
    setMessage(null);
    try {
      await adminApi.put(`/admin/reports/${reportId}`, {
        action,
        action_taken: actionLabel
      });
      setMessage({ type: 'success', text: t('adminReports.actionSuccess', { action: t(`adminReports.actionShort.${action}`, { defaultValue: action }) }) });
      fetchReports();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.error || t('adminReports.actionFailed')
      });
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('adminReports.title')}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {t('adminReports.count', { count: total, status: t(`adminReports.status.${tab}`, { defaultValue: tab }) })}
          </p>
        </div>
        <Link
          to={adminRoute('reportsDashboard').path}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 hover:border-gray-500 hover:text-white"
        >
          {t('adminReports.viewDashboard')}
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-6">
        {STATUS_TABS.map(statusKey => (
          <button
            key={statusKey}
            onClick={() => setTab(statusKey)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold
              capitalize transition ${
              tab === statusKey
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
          >
            {t(`adminReports.status.${statusKey}`, { defaultValue: statusKey })}
          </button>
        ))}
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm mb-6 ${
          message.type === 'success'
            ? 'bg-green-900 border border-green-700 text-green-300'
            : 'bg-red-900 border border-red-700 text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-500">{t('adminReports.loading')}</div>
      ) : error ? (
        <AdminErrorState
          title={t('adminReports.loadFailedTitle')}
          message={error?.response?.data?.error || t('adminReports.loadFailedMessage')}
          onRetry={reload}
        />
      ) : reports.length === 0 ? (
        <div className="text-center py-16">
          <Check size={40} className="mx-auto mb-3 text-green-400" />
          <p className="text-gray-400 font-medium">
            {t('adminReports.empty', { status: t(`adminReports.status.${tab}`, { defaultValue: tab }) })}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map(report => (
            <div key={report.id}
              className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-xs font-semibold text-gray-300
                      uppercase tracking-wider bg-gray-700
                      px-2 py-0.5 rounded">
                      {report.target_type}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5
                      rounded-full capitalize ${
                      REASON_COLORS[report.reason] || REASON_COLORS.other
                    }`}>
                      {report.reason}
                    </span>
                    <span className="text-xs text-gray-500">
                      {adminDateTime(report.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">
                    {report.description || t('adminReports.noDescription')}
                  </p>
                  {/* Deep link to the reported content — moderation is unusable
                      without a way to inspect the target. */}
                  {report.target_id && report.target_type === 'job' && (
                    <Link
                      to={`/admin/jobs/${report.target_id}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-400 hover:text-orange-300 transition"
                    >
                      {t('adminReports.viewReportedJob', { defaultValue: 'View reported job' })} →
                    </Link>
                  )}
                  {report.target_id && report.target_type === 'user' && (
                    <Link
                      to={`/admin/users/${report.target_id}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-orange-400 hover:text-orange-300 transition"
                    >
                      {t('adminReports.viewReportedUser', { defaultValue: 'View reported user' })} →
                    </Link>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    {t('adminReports.reportedBy')}{' '}
                    <span className="text-gray-400">
                      {report.reporter_name || t('adminReports.anonymous')} -{' '}
                      {report.reporter_email || ''}
                    </span>
                  </p>
                </div>

                {/* Actions - only for pending */}
                {tab === 'pending' && (
                  <div className="flex flex-col gap-2 shrink-0">
                    {[
                      { action: 'dismiss', label: t('adminReports.dismiss'),
                        cls: 'bg-gray-700 text-gray-300 hover:bg-gray-600' },
                      { action: 'warn_user', label: t('adminReports.actionShort.warn_user'),
                        cls: 'bg-yellow-900 text-yellow-300 hover:bg-yellow-800' },
                      { action: 'remove_content', label: t('adminReports.actionShort.remove_content'),
                        cls: 'bg-red-900 text-red-300 hover:bg-red-800' },
                      { action: 'escalate', label: t('adminReports.actionShort.escalate'),
                        cls: 'bg-orange-900 text-orange-300 hover:bg-orange-800' },
                    ].map(({ action, label, cls }) => (
                      <button
                        key={action}
                        onClick={() => handleAction(report.id, action)}
                        disabled={acting === report.id}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold
                          transition disabled:opacity-50 ${cls}`}
                      >
                        {acting === report.id ? '...' : label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Reviewed state */}
                {tab !== 'pending' && report.action_taken && (
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-gray-500">{t('adminReports.actionTaken')}</p>
                    <p className="text-xs text-gray-300 mt-0.5 font-medium">
                      {report.action_taken}
                    </p>
                    {report.reviewed_by_name && (
                      <p className="text-xs text-gray-600 mt-1">
                        {t('adminReports.by')} {report.reviewed_by_name}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
